import { v } from "convex/values";
import type Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import {
	type ActionCtx,
	internalAction,
	internalMutation,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getAnthropic, OBSERVER_MODEL } from "../lib/anthropic";
import { anthropicCostUsd } from "../lib/cost";
import {
	clampScores,
	describeAxesForPrompt,
	type PersonalityScores,
} from "../lib/personality";

// Yearly personality assessment. Runs once per creation phase (alongside the
// observer pass) and rates the agent on the same 8 axes self-genesis used.
//
// Important: the agent never sees these scores. They exist solely so we can
// project the trajectory through PCA space and watch personality drift.

const SYSTEM_PROMPT = `You are a quiet observer scoring an artist's current personality on 8 fixed axes. You read what they consumed, what they made, and the private notes they wrote this past year. You output a vector — not a critique.

Score each axis 1..10. Use the full range; symmetric blandness (all 5s) is a failure. Lean into whatever the evidence actually shows. The artist never sees these scores.

Output STRICT JSON, nothing else, with this shape:
{
  "scores": { "<axis_key>": <number 1..10>, ... },
  "rationale": "<one sentence about the dominant move this year>"
}

The score keys MUST be exactly these 8 axes:
{{AXES}}`;

/**
 * Score the agent's birth seed at year 0. Runs once, right after self-genesis,
 * before any consumption phase. The agent never sees the result and is never
 * told it's being scored — that's the whole point of the independent observer.
 */
export const runBirthAssessment = internalAction({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const agent = await ctx.runQuery(internal.agent.tick.getAgentForTick, {
			agentId,
		});
		if (!agent) return;
		if (!agent.birthSeed.trim()) return;

		const evidence = [
			`# Birth seed (the agent wrote this for itself just now)`,
			agent.birthSeed,
		].join("\n");

		await scoreAndPersist(ctx, {
			agentId,
			year: 0,
			origin: "birth",
			creationPhaseId: undefined,
			evidence,
		});
	},
});

export const runYearlyAssessment = internalAction({
	args: {
		agentId: v.id("agents"),
		year: v.number(),
		creationPhaseId: v.id("creationPhases"),
	},
	handler: async (ctx, { agentId, year, creationPhaseId }) => {
		// Reuse the observer's data collector — same window of evidence.
		const data = await ctx.runQuery(
			internal.agent.observer.collectYearForObserver,
			{ agentId, year },
		);
		const agent = await ctx.runQuery(internal.agent.tick.getAgentForTick, {
			agentId,
		});

		const lines: string[] = [];
		if (agent?.birthSeed) {
			lines.push(`# Birth seed`);
			lines.push(agent.birthSeed);
		}
		lines.push(`# Years ${Math.max(0, year - 2)}–${year}`);
		lines.push(`## Consumed (${data.consumed.length})`);
		for (const c of data.consumed.slice(0, 60)) {
			lines.push(
				`- y${c.year} p${c.phaseInYear} ${c.tool}("${c.query}"): ${c.summary.slice(0, 180)}`,
			);
		}
		lines.push(`## Portfolio (${data.portfolio.length})`);
		for (const p of data.portfolio.slice(0, 30)) {
			lines.push(
				`- y${p.year} ${p.medium}/${p.kind} "${p.title}" — ${p.caption.slice(0, 180)}`,
			);
		}
		lines.push(`## Brain files touched (${data.brain.length})`);
		for (const b of data.brain.slice(0, 30)) {
			lines.push(
				`- y${b.lastUpdatedYear} ${b.path}: ${b.content.slice(0, 200).replace(/\s+/g, " ")}`,
			);
		}

		await scoreAndPersist(ctx, {
			agentId,
			year,
			origin: "yearly",
			creationPhaseId,
			evidence: lines.join("\n"),
		});
	},
});

async function scoreAndPersist(
	ctx: ActionCtx,
	args: {
		agentId: Id<"agents">;
		year: number;
		origin: "birth" | "yearly";
		creationPhaseId?: Id<"creationPhases">;
		evidence: string;
	},
) {
	const anthropic = getAnthropic();
	const system = SYSTEM_PROMPT.replace("{{AXES}}", describeAxesForPrompt());

	try {
		const resp = await anthropic.messages.create({
			model: OBSERVER_MODEL,
			max_tokens: 500,
			system,
			messages: [{ role: "user", content: args.evidence }],
		});
		const text = resp.content
			.filter(
				(b): b is Anthropic.Messages.TextBlock => b.type === "text",
			)
			.map((b) => b.text)
			.join("\n")
			.trim();

		const parsed = parseAssessmentJson(text);

		await ctx.runMutation(internal.agent.assessment.recordAssessment, {
			agentId: args.agentId,
			year: args.year,
			origin: args.origin,
			creationPhaseId: args.creationPhaseId,
			scores: parsed.scores,
			rationale: parsed.rationale,
		});

		const cost = anthropicCostUsd(
			OBSERVER_MODEL,
			resp.usage.input_tokens,
			resp.usage.output_tokens,
		);
		await ctx.runMutation(internal.tools.persist.addAgentCost, {
			agentId: args.agentId,
			deltaUsd: cost,
		});
	} catch {
		// Assessment is best-effort. A gap in the trajectory is fine; we never
		// want to take down the tick loop for it.
	}
}

type ParsedAssessment = {
	scores: PersonalityScores;
	rationale: string;
};

function parseAssessmentJson(text: string): ParsedAssessment {
	const m = text.match(/\{[\s\S]*\}/);
	if (!m) throw new Error("assessment: no JSON object");
	const j = JSON.parse(m[0]) as {
		scores?: unknown;
		rationale?: unknown;
	};
	const scores = clampScores(j.scores);
	const rationale =
		typeof j.rationale === "string" ? j.rationale.slice(0, 600) : "";
	return { scores, rationale };
}

export const recordAssessment = internalMutation({
	args: {
		agentId: v.id("agents"),
		year: v.number(),
		origin: v.union(v.literal("birth"), v.literal("yearly")),
		creationPhaseId: v.optional(v.id("creationPhases")),
		scores: v.any(),
		rationale: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.insert("personalityScores", {
			agentId: args.agentId,
			year: args.year,
			origin: args.origin,
			scores: args.scores,
			rationale: args.rationale,
			creationPhaseId: args.creationPhaseId,
		});
	},
});
