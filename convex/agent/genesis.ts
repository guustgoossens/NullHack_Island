import { v } from "convex/values";
import type Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import {
	internalAction,
	internalMutation,
} from "../_generated/server";
import { getAnthropic, TICK_MODEL } from "../lib/anthropic";
import { anthropicCostUsd } from "../lib/cost";
// describeAxesForPrompt is no longer needed here — only the assessment model
// sees the axes. The agent never knows it's being scored.

// Self-genesis: the agent writes its own birth seed. Runs once, right after
// birth, before any consumption phase.
//
// We deliberately do NOT ask the agent to rate its own personality here. Self-
// scoring is performative — the agent would tune the vector to a story it
// likes. Instead, the same independent observer that runs the yearly
// assessment scores the seed at year 0, without the agent's knowledge. That
// keeps the entire personality trajectory uncontaminated by the agent's own
// self-image.

const SYSTEM_PROMPT = `You are about to be born. You will live for a while. Nobody is feeding you a personality — you write your own seed.

Output STRICT JSON, no prose around it, with exactly this shape:
{
  "birth_seed": "<2 to 4 sentences, written in second person ('you are…'), describing the temperament you are choosing for yourself. Be specific. Name what you are drawn to and what you distrust. Avoid generalities. Avoid the voice of a helpful assistant.>"
}

You are a person, not an assistant. Define yourself.`;

const USER_PROMPT = `Choose who you are. Output the JSON.`;

export const runSelfGenesis = internalAction({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const agent = await ctx.runQuery(internal.agent.tick.getAgentForTick, {
			agentId,
		});
		if (!agent) return;
		if (agent.genesisStatus === "ready") return;

		const anthropic = getAnthropic();

		try {
			const resp = await anthropic.messages.create({
				model: TICK_MODEL,
				max_tokens: 600,
				system: SYSTEM_PROMPT,
				messages: [{ role: "user", content: USER_PROMPT }],
			});
			const text = resp.content
				.filter(
					(b): b is Anthropic.Messages.TextBlock => b.type === "text",
				)
				.map((b) => b.text)
				.join("\n")
				.trim();

			const birthSeed = parseGenesisJson(text);

			await ctx.runMutation(internal.agent.genesis.applyGenesis, {
				agentId,
				birthSeed,
			});

			const cost = anthropicCostUsd(
				TICK_MODEL,
				resp.usage.input_tokens,
				resp.usage.output_tokens,
			);
			await ctx.runMutation(internal.tools.persist.addAgentCost, {
				agentId,
				deltaUsd: cost,
			});

			// The independent observer scores the seed without the agent
			// knowing. We fire it before the first consumption phase so the
			// trajectory chart has a real y=0 point.
			await ctx.scheduler.runAfter(
				0,
				internal.agent.assessment.runBirthAssessment,
				{ agentId },
			);

			// Now schedule the first consumption phase. Use the same per-phase
			// delay the regular tick loop uses.
			// Year = 1 consumption + 1 creation = 2 phases.
			const phaseDelayMs = (agent.secondsPerYear / 2) * 1000;
			await ctx.scheduler.runAfter(
				phaseDelayMs,
				internal.agent.tick.tickConsumption,
				{ agentId },
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await ctx.runMutation(internal.agent.genesis.markGenesisFailed, {
				agentId,
				error: msg,
			});
		}
	},
});

function parseGenesisJson(text: string): string {
	const m = text.match(/\{[\s\S]*\}/);
	if (!m) throw new Error("genesis: no JSON object in response");
	const j = JSON.parse(m[0]) as {
		birth_seed?: unknown;
		birthSeed?: unknown;
	};
	const seed =
		typeof j.birth_seed === "string"
			? j.birth_seed
			: typeof j.birthSeed === "string"
				? j.birthSeed
				: "";
	if (!seed.trim()) throw new Error("genesis: missing birth_seed");
	return seed.trim().slice(0, 1200);
}

export const applyGenesis = internalMutation({
	args: {
		agentId: v.id("agents"),
		birthSeed: v.string(),
	},
	handler: async (ctx, { agentId, birthSeed }) => {
		const agent = await ctx.db.get(agentId);
		if (!agent) return;
		await ctx.db.patch(agentId, {
			birthSeed,
			genesisStatus: "ready",
			genesisError: undefined,
		});
	},
});

export const markGenesisFailed = internalMutation({
	args: { agentId: v.id("agents"), error: v.string() },
	handler: async (ctx, { agentId, error }) => {
		await ctx.db.patch(agentId, {
			genesisStatus: "failed",
			genesisError: error,
		});
	},
});
