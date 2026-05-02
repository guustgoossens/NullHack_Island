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
	tickModelFor,
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
const MAX_NUDGES = 1;
const MAX_TOKENS_PER_TURN = 2048;
// Floor for the per-phase output budget. The agent record carries the real
// limit; this guards against a misconfigured agent with 0 tokens budgeted.
const MIN_OUTPUT_BUDGET_PER_PHASE = 1024;
// Default for agents that predate the maxOutputTokensPerPhase field.
const DEFAULT_OUTPUT_BUDGET_PER_PHASE = 3_500;

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
		// Commons agents never run normal phases — they only wake during gatherings.
		if ((agent.kind ?? "individual") === "commons") return;
		// Barrier-paused at a gathering — wait for the gathering to release us.
		if (agent.gatheringWait) return;

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
			model: tickModelFor(agent),
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
		if ((agent.kind ?? "individual") === "commons") return;
		if (agent.gatheringWait) return;

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

		const model = tickModelFor(agent);

		// First pass.
		let result = await runLLMLoop(ctx, {
			agentId,
			phaseRef,
			year: agent.currentYear,
			phaseInYear: 1,
			messages,
			tools,
			system,
			maxOutputTokensRemaining: remainingBudget,
			model,
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
				phaseInYear: 1,
				messages: result.allMessages,
				tools,
				system,
				resumeFrom: true,
				maxOutputTokensRemaining: remainingBudget,
				model,
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

		// Hard fallback: if the agent still didn't touch every artifact after
		// MAX_NUDGES, just flip the contract flags so the year can advance. We
		// deliberately do *not* fabricate brain entries or portfolio items the
		// agent never wrote — those would pollute the lifetime view with fake
		// "(silence)" content. For room we still insert a noop version pinned to
		// the previous prompt so the year has a room reference.
		const phase = await ctx.runQuery(
			internal.tools.persist.getCreationPhase,
			{ id: creationPhaseId },
		);
		if (phase) {
			const missing = missingArtifacts(phase);
			for (const a of missing) {
				if (a === "room") {
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
						internal.tools.persist.markArtifactTouched,
						{ creationPhaseId, artifact: a },
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
		// One yearly emotion reading by the outside observer.
		await ctx.scheduler.runAfter(0, internal.agent.observer.runEmotionPass, {
			agentId,
			year: agent.currentYear,
			creationPhaseId,
		});

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
	if (agent.currentYear >= 28) return;

	// Cohort barrier: if an individual cohort agent just finished a year-N
	// creation phase where N is a multiple of the cohort's gatheringEveryNYears,
	// pause without advancing the clock. The gathering action will release
	// the agent (advance clock + reschedule) once synthesis completes.
	const justFinishedCreation = agent.currentPhaseInYear === 1;
	if (
		justFinishedCreation &&
		agent.cohortId &&
		(agent.kind ?? "individual") === "individual"
	) {
		const cohort = await ctx.runQuery(internal.cohort.getCohort, {
			cohortId: agent.cohortId,
		});
		const N = agent.currentYear;
		if (
			cohort &&
			cohort.status === "active" &&
			N > 0 &&
			N % cohort.gatheringEveryNYears === 0
		) {
			await ctx.runMutation(internal.cohort.enterGatheringWait, {
				agentId,
				forYear: N,
			});
			await ctx.runMutation(internal.cohort.maybeFireGathering, {
				cohortId: agent.cohortId,
				forYear: N,
			});
			return;
		}
	}

	// Year = 1 consumption phase + 1 creation phase = 2 phases.
	const phaseDelayMs = (agent.secondsPerYear / 2) * 1000;
	const nextPhaseAt = Date.now() + phaseDelayMs;

	// Always advance the clock so currentPhaseInYear points at the *next* phase
	// to run, even if the agent is currently paused. Resume reads this field
	// to bootstrap the next tick — leaving it stale would make resume re-run
	// the just-completed phase.
	await ctx.runMutation(internal.tools.persist.advanceAgentClock, {
		agentId,
		nextPhaseAt,
	});

	const after = await ctx.runQuery(internal.agent.tick.getAgentForTick, {
		agentId,
	});
	if (!after) return;
	// Don't schedule the next tick while paused. Resume will pick it up.
	if (after.status !== "alive") return;

	const isCreation = after.currentPhaseInYear === 1;
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

export type LoopResult = {
	allMessages: AnthropicMessage[];
	finalText: string;
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
};

export async function runLLMLoop(
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
		model: string;
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
			model: args.model,
			max_tokens: turnMax,
			system: args.system,
			tools: args.tools,
			messages,
		});
		tokensIn += resp.usage.input_tokens;
		tokensOut += resp.usage.output_tokens;
		remaining -= resp.usage.output_tokens;
		costUsd += anthropicCostUsd(
			args.model,
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
