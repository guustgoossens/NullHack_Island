import { v } from "convex/values";
import type Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import { getAnthropic, OBSERVER_MODEL } from "../lib/anthropic";
import { anthropicCostUsd } from "../lib/cost";

const OBSERVER_SYSTEM = `You are an outside observer watching someone live their life. You read what they consumed, what they made, and what they wrote in their private notes. Name the chapter they are currently in.

A chapter label is a short, specific phrase that captures what is dominant in them right now — it can be a subject, a feeling, a medium, a place, a person, a movement, anything. Whatever best summarises them. Be specific. Avoid generic words. Do not project labels they have not earned from the evidence in front of you.

Output strict JSON: {"label": "<short label>", "summary": "<one or two sentences on what defines this chapter for them>", "confidence": <0.0 to 1.0>}

They never see this label. You are not writing for them.`;

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
		lines.push(`## Brain files touched (${data.brain.length})`);
		for (const b of data.brain.slice(0, 30)) {
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
