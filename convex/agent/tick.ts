import { v } from "convex/values";
import type Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	type ActionCtx,
	internalAction,
	internalQuery,
} from "../_generated/server";
import {
	type AnthropicMessage,
	getAnthropic,
	TICK_MODEL,
} from "../lib/anthropic";
import { anthropicCostUsd } from "../lib/cost";
import {
	consumptionFraming,
	creationFraming,
	nudgeFraming,
	systemPrompt,
} from "./prompts";
import { renderSnapshot } from "./context";
import { toAnthropicTools, toolsForPhase } from "../tools/registry";

const MAX_TOOL_ITERS = 12;
const MAX_NUDGES = 3;
const MAX_TOKENS_PER_TURN = 4096;
// Floor for the per-phase output budget. The agent record carries the real
// limit; this guards against a misconfigured agent with 0 tokens budgeted.
const MIN_OUTPUT_BUDGET_PER_PHASE = 2048;
// Default for agents that predate the maxOutputTokensPerPhase field.
const DEFAULT_OUTPUT_BUDGET_PER_PHASE = 14_000;

function outputBudgetFor(agent: Doc<"agents">): number {
	const cap = agent.maxOutputTokensPerPhase ?? DEFAULT_OUTPUT_BUDGET_PER_PHASE;
	return Math.max(MIN_OUTPUT_BUDGET_PER_PHASE, cap);
}

type PhaseRef =
	| { kind: "consumption"; id: Id<"consumptionPhases"> }
	| { kind: "creation"; id: Id<"creationPhases"> };

export const tickConsumption = internalAction({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const agent = await ctx.runQuery(internal.agent.tick.getAgentForTick, {
			agentId,
		});
		if (!agent || agent.status !== "alive") return;

		const consumptionPhaseId: Id<"consumptionPhases"> = await ctx.runMutation(
			internal.tools.persist.insertConsumptionPhase,
			{
				agentId,
				year: agent.currentYear,
				phaseInYear: agent.currentPhaseInYear,
			},
		);
		const phaseRef: PhaseRef = {
			kind: "consumption",
			id: consumptionPhaseId,
		};

		const snap = await ctx.runQuery(
			internal.agent.context.buildConsumptionContext,
			{ agentId },
		);
		const framing = consumptionFraming({
			year: agent.currentYear,
			phaseInYear: agent.currentPhaseInYear,
		});
		const userMsg = renderSnapshot(snap, framing);

		const tools = toAnthropicTools(toolsForPhase("consumption"));
		const messages: AnthropicMessage[] = [
			{ role: "user", content: userMsg },
		];
		const budget = outputBudgetFor(agent);
		const result = await runLLMLoop(ctx, {
			agentId,
			phaseRef,
			year: agent.currentYear,
			phaseInYear: agent.currentPhaseInYear,
			messages,
			tools,
			system: systemPrompt(budget),
			maxOutputTokensRemaining: budget,
		});

		const reflection = result.finalText.slice(0, 4000);
		await ctx.runMutation(
			internal.tools.persist.completeConsumptionPhase,
			{ consumptionPhaseId, reflection },
		);
		await ctx.runMutation(internal.tools.persist.persistTranscript, {
			agentId,
			phaseRef,
			messages: result.allMessages,
			tokensInput: result.tokensIn,
			tokensOutput: result.tokensOut,
			costUsd: result.costUsd,
		});
		await ctx.runMutation(internal.tools.persist.addAgentCost, {
			agentId,
			deltaUsd: result.costUsd,
		});

		await scheduleNext(ctx, agentId);
	},
});

export const tickCreation = internalAction({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const agent = await ctx.runQuery(internal.agent.tick.getAgentForTick, {
			agentId,
		});
		if (!agent || agent.status !== "alive") return;

		const creationPhaseId: Id<"creationPhases"> = await ctx.runMutation(
			internal.tools.persist.insertCreationPhase,
			{ agentId, year: agent.currentYear },
		);
		const phaseRef: PhaseRef = { kind: "creation", id: creationPhaseId };

		const snap = await ctx.runQuery(
			internal.agent.context.buildCreationContext,
			{ agentId },
		);
		const framing = creationFraming({ year: agent.currentYear });
		const userMsg = renderSnapshot(snap, framing);
		const tools = toAnthropicTools(toolsForPhase("creation"));

		const messages: AnthropicMessage[] = [
			{ role: "user", content: userMsg },
		];

		const totalBudget = outputBudgetFor(agent);
		let remainingBudget = totalBudget;
		const system = systemPrompt(totalBudget);

		// First pass.
		let result = await runLLMLoop(ctx, {
			agentId,
			phaseRef,
			year: agent.currentYear,
			phaseInYear: 4,
			messages,
			tools,
			system,
			maxOutputTokensRemaining: remainingBudget,
		});
		remainingBudget = Math.max(0, remainingBudget - result.tokensOut);

		// Three-artifact contract: if any artifact wasn't touched, nudge.
		let nudges = 0;
		while (nudges < MAX_NUDGES && remainingBudget > 0) {
			const phase = await ctx.runQuery(
				internal.tools.persist.getCreationPhase,
				{ id: creationPhaseId },
			);
			if (!phase) break;
			const missing = missingArtifacts(phase);
			if (missing.length === 0) break;

			result.allMessages.push({
				role: "user",
				content: nudgeFraming(missing),
			});
			const next = await runLLMLoop(ctx, {
				agentId,
				phaseRef,
				year: agent.currentYear,
				phaseInYear: 4,
				messages: result.allMessages,
				tools,
				system,
				resumeFrom: true,
				maxOutputTokensRemaining: remainingBudget,
			});
			remainingBudget = Math.max(0, remainingBudget - next.tokensOut);
			result = {
				allMessages: next.allMessages,
				finalText: next.finalText || result.finalText,
				tokensIn: result.tokensIn + next.tokensIn,
				tokensOut: result.tokensOut + next.tokensOut,
				costUsd: result.costUsd + next.costUsd,
			};
			nudges++;
		}

		// Hard fallback: write no-op rows for any artifact still untouched.
		const phase = await ctx.runQuery(
			internal.tools.persist.getCreationPhase,
			{ id: creationPhaseId },
		);
		if (phase) {
			const missing = missingArtifacts(phase);
			for (const a of missing) {
				if (a === "brain") {
					await ctx.runMutation(internal.tools.persist.brainWrite, {
						agentId,
						creationPhaseId,
						year: agent.currentYear,
						path: `journal/y${agent.currentYear}.md`,
						content: `(year ${agent.currentYear} — I had nothing to say this year.)`,
					});
				} else if (a === "room") {
					const currentSnap = await ctx.runQuery(
						internal.agent.context.buildCreationContext,
						{ agentId },
					);
					const currentPrompt =
						currentSnap.currentRoom?.prompt ??
						agent.startingRoomPrompt;
					await ctx.runMutation(
						internal.tools.persist.insertRoomVersion,
						{
							agentId,
							creationPhaseId,
							year: agent.currentYear,
							prompt: currentPrompt,
							origin: "noop",
						},
					);
					// Don't render — the room is unchanged from last year.
				} else {
					await ctx.runMutation(
						internal.tools.persist.insertPortfolioItem,
						{
							agentId,
							creationPhaseId,
							year: agent.currentYear,
							kind: "created",
							medium: "writing",
							title: "(silence)",
							caption: "Nothing made this year.",
							payload: { kind: "text", text: "" },
							citedConsumedItemIds: [],
							status: "ready",
						},
					);
				}
			}
		}

		const reflection = result.finalText.slice(0, 6000);
		await ctx.runMutation(internal.tools.persist.completeCreationPhase, {
			creationPhaseId,
			reflection,
		});
		await ctx.runMutation(internal.tools.persist.persistTranscript, {
			agentId,
			phaseRef,
			messages: result.allMessages,
			tokensInput: result.tokensIn,
			tokensOutput: result.tokensOut,
			costUsd: result.costUsd,
		});
		await ctx.runMutation(internal.tools.persist.addAgentCost, {
			agentId,
			deltaUsd: result.costUsd,
		});

		// Observer pass + personality assessment — fire-and-forget. Both read the
		// same year window of evidence; we run them as separate passes so each
		// can fail without taking the other down.
		await ctx.scheduler.runAfter(0, internal.agent.observer.runObserverPass, {
			agentId,
			year: agent.currentYear,
		});
		await ctx.scheduler.runAfter(
			0,
			internal.agent.assessment.runYearlyAssessment,
			{ agentId, year: agent.currentYear, creationPhaseId },
		);

		await scheduleNext(ctx, agentId);
	},
});

// ----------------- helpers -----------------

export const getAgentForTick = internalQuery({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }): Promise<Doc<"agents"> | null> => {
		return await ctx.db.get(agentId);
	},
});

function missingArtifacts(
	phase: Doc<"creationPhases">,
): ("brain" | "room" | "portfolio")[] {
	const out: ("brain" | "room" | "portfolio")[] = [];
	if (!phase.brainTouched) out.push("brain");
	if (!phase.roomTouched) out.push("room");
	if (!phase.portfolioTouched) out.push("portfolio");
	return out;
}

async function scheduleNext(ctx: ActionCtx, agentId: Id<"agents">) {
	const agent = await ctx.runQuery(internal.agent.tick.getAgentForTick, {
		agentId,
	});
	if (!agent) return;
	if (agent.status !== "alive") return;
	if (agent.currentYear >= 60) return;

	const phaseDelayMs = (agent.secondsPerYear / 5) * 1000;
	const nextPhaseAt = Date.now() + phaseDelayMs;

	await ctx.runMutation(internal.tools.persist.advanceAgentClock, {
		agentId,
		nextPhaseAt,
	});

	const after = await ctx.runQuery(internal.agent.tick.getAgentForTick, {
		agentId,
	});
	if (!after || after.status !== "alive") return;

	const isCreation = after.currentPhaseInYear === 4;
	if (isCreation) {
		await ctx.scheduler.runAt(
			nextPhaseAt,
			internal.agent.tick.tickCreation,
			{ agentId },
		);
	} else {
		await ctx.scheduler.runAt(
			nextPhaseAt,
			internal.agent.tick.tickConsumption,
			{ agentId },
		);
	}
}

type LoopResult = {
	allMessages: AnthropicMessage[];
	finalText: string;
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
};

async function runLLMLoop(
	ctx: ActionCtx,
	args: {
		agentId: Id<"agents">;
		phaseRef: PhaseRef;
		year: number;
		phaseInYear: number;
		messages: AnthropicMessage[];
		tools: Anthropic.Messages.Tool[];
		system: string;
		resumeFrom?: boolean; // when nudging, the messages are already the running transcript
		// Output-token ceiling for this loop. We shrink max_tokens per turn so
		// the model stays inside the budget across all tool iterations.
		maxOutputTokensRemaining: number;
	},
): Promise<LoopResult> {
	const anthropic = getAnthropic();
	const messages = args.resumeFrom ? args.messages : [...args.messages];
	let tokensIn = 0;
	let tokensOut = 0;
	let costUsd = 0;
	let finalText = "";
	let remaining = args.maxOutputTokensRemaining;

	for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
		if (remaining <= 0) break;
		const turnMax = Math.max(256, Math.min(MAX_TOKENS_PER_TURN, remaining));
		const resp = await anthropic.messages.create({
			model: TICK_MODEL,
			max_tokens: turnMax,
			system: args.system,
			tools: args.tools,
			messages,
		});
		tokensIn += resp.usage.input_tokens;
		tokensOut += resp.usage.output_tokens;
		remaining -= resp.usage.output_tokens;
		costUsd += anthropicCostUsd(
			TICK_MODEL,
			resp.usage.input_tokens,
			resp.usage.output_tokens,
		);

		messages.push({ role: "assistant", content: resp.content });

		// Capture the latest text block as the running reflection.
		const textBlocks = resp.content.filter(
			(b): b is Anthropic.Messages.TextBlock => b.type === "text",
		);
		if (textBlocks.length > 0) {
			finalText = textBlocks.map((b) => b.text).join("\n").trim();
		}

		if (resp.stop_reason === "end_turn") break;
		if (resp.stop_reason !== "tool_use") break;

		const toolUses = resp.content.filter(
			(b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
		);
		if (toolUses.length === 0) break;

		const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
		for (const tu of toolUses) {
			const start = Date.now();
			const result = await ctx.runAction(
				internal.tools.dispatch.dispatchTool,
				{
					agentId: args.agentId,
					phaseRef: args.phaseRef,
					year: args.year,
					phaseInYear: args.phaseInYear,
					toolName: tu.name,
					toolArgs: tu.input as Record<string, unknown>,
				},
			);
			await ctx.runMutation(internal.tools.persist.persistToolCall, {
				agentId: args.agentId,
				phaseRef: args.phaseRef,
				tool: tu.name,
				args: tu.input,
				result: result.toolResult,
				durationMs: Date.now() - start,
				costUsd: 0,
				error: result.error,
			});
			toolResults.push({
				type: "tool_result",
				tool_use_id: tu.id,
				content: result.toolResult,
				is_error: Boolean(result.error),
			});
		}
		messages.push({ role: "user", content: toolResults });
	}

	return {
		allMessages: messages,
		finalText,
		tokensIn,
		tokensOut,
		costUsd,
	};
}
