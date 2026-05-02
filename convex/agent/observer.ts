import { v } from "convex/values";
import type Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import {
	internalAction,
	internalQuery,
} from "../_generated/server";
import { getAnthropic, OBSERVER_MODEL } from "../lib/anthropic";
import { anthropicCostUsd } from "../lib/cost";
import {
	clampEmotions,
	describeEmotionsForPrompt,
	EMOTION_KEYS,
	type EmotionScores,
	pickDominant,
} from "../lib/emotions";

const OBSERVER_SYSTEM = `You are an outside observer watching someone live their life. You read what they consumed, what they made, and what they wrote in their private notes. Name the chapter they are currently in.

A chapter label is a short, specific phrase that captures what is dominant in them right now — it can be a subject, a feeling, a medium, a place, a person, a movement, anything. Whatever best summarises them. Be specific. Avoid generic words. Do not project labels they have not earned from the evidence in front of you.

Output strict JSON: {"label": "<short label>", "summary": "<one or two sentences on what defines this chapter for them>", "confidence": <0.0 to 1.0>}

They never see this label. You are not writing for them.`;

const EMOTION_SYSTEM = `You are an outside observer reading someone at the close of a year of their life. You see what they pulled in, what they made, what they wrote in their private notes, and how they redecorated their room. You feel them.

Score the emotional weather of this year on eight axes, each 0.0..1.0. These are NOT exclusive — joy and grief can both be high (bittersweet), fear and anger can co-exist, ego can sit beside tenderness. Use the full range. All zeros is a failure. All sevens is a failure. Lean into what is actually present.

The eight axes:
{{EMOTIONS}}

Also pick the single emotion that colors this year most ("dominantEmotion") and write one short sentence ("salientPull") naming what they are pulled toward right now — the obsession, the wound, the longing, the discovery. Concrete. In your voice, not theirs.

Output STRICT JSON, no prose, no markdown:
{
  "emotions": { "joy": 0.0, "grief": 0.0, "anger": 0.0, "fear": 0.0, "optimism": 0.0, "ego": 0.0, "intelligence": 0.0, "tenderness": 0.0 },
  "dominantEmotion": "<one of the keys above>",
  "salientPull": "<one sentence, ≤140 chars>"
}

They never see this. You are not writing for them.`;

// ---------------- Era label pass (per year, after creation) ----------------

export const collectYearForObserver = internalQuery({
	args: { agentId: v.id("agents"), year: v.number() },
	handler: async (ctx, { agentId, year }) => {
		const fromYear = Math.max(0, year - 2);
		const consumed = await ctx.db
			.query("consumedItems")
			.withIndex("by_agent_and_year", (q) =>
				q.eq("agentId", agentId).gte("year", fromYear),
			)
			.take(120);
		const portfolio = await ctx.db
			.query("portfolioItems")
			.withIndex("by_agent_and_year", (q) =>
				q.eq("agentId", agentId).gte("year", fromYear),
			)
			.take(60);
		const brain = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_lastUpdatedYear", (q) =>
				q.eq("agentId", agentId).gte("lastUpdatedYear", fromYear),
			)
			.take(40);
		return { consumed, portfolio, brain };
	},
});

export const runObserverPass = internalAction({
	args: { agentId: v.id("agents"), year: v.number() },
	handler: async (ctx, { agentId, year }) => {
		const data = await ctx.runQuery(
			internal.agent.observer.collectYearForObserver,
			{ agentId, year },
		);
		const lines: string[] = [];
		lines.push(`# Years ${Math.max(0, year - 2)}–${year}`);
		lines.push(`## Consumed (${data.consumed.length})`);
		for (const c of data.consumed.slice(0, 80)) {
			lines.push(
				`- y${c.year} p${c.phaseInYear} ${c.tool}("${c.query}"): ${c.summary.slice(0, 200)}`,
			);
		}
		lines.push(`## Portfolio (${data.portfolio.length})`);
		for (const p of data.portfolio.slice(0, 40)) {
			lines.push(
				`- y${p.year} ${p.medium}/${p.kind} "${p.title}" — ${p.caption.slice(0, 200)}`,
			);
		}
		const brainFiles = data.brain.filter(
			(b) => (b.kind ?? "file") === "file",
		);
		lines.push(`## Brain files touched (${brainFiles.length})`);
		for (const b of brainFiles.slice(0, 30)) {
			lines.push(
				`- y${b.lastUpdatedYear} ${b.path}: ${b.content.slice(0, 200).replace(/\s+/g, " ")}`,
			);
		}

		const anthropic = getAnthropic();
		const resp = await anthropic.messages.create({
			model: OBSERVER_MODEL,
			max_tokens: 400,
			system: OBSERVER_SYSTEM,
			messages: [{ role: "user", content: lines.join("\n") }],
		});

		const text = resp.content
			.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
			.map((b) => b.text)
			.join("\n")
			.trim();

		let label = "(unlabeled)";
		let summary = "";
		let confidence = 0;
		try {
			const m = text.match(/\{[\s\S]*\}/);
			const j = m ? JSON.parse(m[0]) : null;
			if (j) {
				label = String(j.label ?? label);
				summary = String(j.summary ?? "");
				confidence = Number(j.confidence ?? 0);
			}
		} catch {
			summary = text.slice(0, 400);
		}

		await ctx.runMutation(internal.tools.persist.insertEraLabel, {
			agentId,
			year,
			label,
			summary,
			confidence: Number.isFinite(confidence) ? confidence : 0,
		});

		const cost = anthropicCostUsd(
			OBSERVER_MODEL,
			resp.usage.input_tokens,
			resp.usage.output_tokens,
		);
		await ctx.runMutation(internal.tools.persist.addAgentCost, {
			agentId,
			deltaUsd: cost,
		});
	},
});

// ---------------- Emotion pass (one per year, after creation) -------------

export const runEmotionPass = internalAction({
	args: {
		agentId: v.id("agents"),
		year: v.number(),
		creationPhaseId: v.optional(v.id("creationPhases")),
	},
	handler: async (ctx, args) => {
		const data = await ctx.runQuery(
			internal.agent.observer.collectYearForObserver,
			{ agentId: args.agentId, year: args.year },
		);

		// Filter the 3-year window down to *this year only* — the emotion read
		// is meant to capture the year that just closed, not a rolling average.
		const consumed = data.consumed.filter((c) => c.year === args.year);
		const portfolio = data.portfolio.filter((p) => p.year === args.year);
		const brain = data.brain.filter((b) => b.lastUpdatedYear === args.year);

		const lines: string[] = [];
		lines.push(`# Year ${args.year}`);
		if (consumed.length > 0) {
			lines.push(`## What they pulled in (${consumed.length})`);
			for (const c of consumed.slice(0, 60)) {
				lines.push(
					`- ${c.tool}("${c.query}"): ${c.summary.slice(0, 220)}`,
				);
			}
		}
		if (portfolio.length > 0) {
			lines.push(`## What they made (${portfolio.length})`);
			for (const p of portfolio.slice(0, 30)) {
				lines.push(
					`- ${p.medium}/${p.kind} "${p.title}" — ${p.caption.slice(0, 220)}`,
				);
			}
		}
		if (brain.length > 0) {
			lines.push(`## Brain files they touched (${brain.length})`);
			for (const b of brain.slice(0, 20)) {
				lines.push(
					`- ${b.path}: ${b.content.slice(0, 220).replace(/\s+/g, " ")}`,
				);
			}
		}

		// Nothing to read — skip rather than burn tokens on a phantom reading.
		if (lines.length <= 1) return;

		const anthropic = getAnthropic();
		const system = EMOTION_SYSTEM.replace(
			"{{EMOTIONS}}",
			describeEmotionsForPrompt(),
		);

		try {
			const resp = await anthropic.messages.create({
				model: OBSERVER_MODEL,
				max_tokens: 350,
				system,
				messages: [{ role: "user", content: lines.join("\n") }],
			});
			const text = resp.content
				.filter(
					(b): b is Anthropic.Messages.TextBlock => b.type === "text",
				)
				.map((b) => b.text)
				.join("\n")
				.trim();

			const parsed = parseEmotionJson(text);

			await ctx.runMutation(internal.tools.persist.insertEmotionReading, {
				agentId: args.agentId,
				year: args.year,
				emotions: parsed.emotions,
				salientPull: parsed.salientPull,
				dominantEmotion: parsed.dominantEmotion,
				creationPhaseId: args.creationPhaseId,
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
			// Best-effort. A skipped reading is fine; never take down the tick loop.
		}
	},
});

type ParsedEmotion = {
	emotions: EmotionScores;
	salientPull: string;
	dominantEmotion: string;
};

function parseEmotionJson(text: string): ParsedEmotion {
	const m = text.match(/\{[\s\S]*\}/);
	if (!m) throw new Error("emotion: no JSON object");
	const j = JSON.parse(m[0]) as {
		emotions?: unknown;
		salientPull?: unknown;
		dominantEmotion?: unknown;
	};
	const emotions = clampEmotions(j.emotions);
	const rawDom =
		typeof j.dominantEmotion === "string" ? j.dominantEmotion : "";
	const dominantEmotion = EMOTION_KEYS.includes(rawDom)
		? rawDom
		: pickDominant(emotions);
	const salientPull =
		typeof j.salientPull === "string" ? j.salientPull.slice(0, 200) : "";
	return { emotions, dominantEmotion, salientPull };
}
