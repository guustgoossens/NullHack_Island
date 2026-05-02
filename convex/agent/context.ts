import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";

const BRAIN_BUDGET_BYTES = 50_000;
const RECENT_PORTFOLIO_LIMIT = 12;
const RECENT_CONSUMED_LIMIT_PER_PHASE = 25;

export type AgentSnapshot = {
	agent: Doc<"agents">;
	brainFilesFull: { path: string; content: string; year: number }[];
	brainFilesTruncated: { path: string; year: number; preview: string }[];
	currentRoom: Doc<"roomVersions"> | null;
	recentPortfolio: Doc<"portfolioItems">[];
	recentConsumedByPhase: {
		year: number;
		phaseInYear: number;
		items: { tool: string; query: string; summary: string }[];
	}[];
	currentEra: Doc<"eraLabels"> | null; // not fed back to agent — just for UI
};

async function loadBrain(ctx: QueryCtx, agentId: Id<"agents">) {
	// Take up to 200 brain files; prioritize most-recently-touched.
	const all = await ctx.db
		.query("brainFiles")
		.withIndex("by_agent_and_lastUpdatedYear", (q) =>
			q.eq("agentId", agentId),
		)
		.order("desc")
		.take(200);
	const live = all.filter((f) => !f.deleted);
	const full: { path: string; content: string; year: number }[] = [];
	const trunc: { path: string; year: number; preview: string }[] = [];
	let used = 0;
	for (const f of live) {
		const cost = f.path.length + f.content.length + 16;
		if (used + cost <= BRAIN_BUDGET_BYTES) {
			full.push({
				path: f.path,
				content: f.content,
				year: f.lastUpdatedYear,
			});
			used += cost;
		} else {
			trunc.push({
				path: f.path,
				year: f.lastUpdatedYear,
				preview: f.content.slice(0, 140),
			});
		}
	}
	return { full, trunc };
}

async function loadCurrentRoom(ctx: QueryCtx, agentId: Id<"agents">) {
	const rooms = await ctx.db
		.query("roomVersions")
		.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
		.order("desc")
		.take(1);
	return rooms[0] ?? null;
}

async function loadRecentPortfolio(
	ctx: QueryCtx,
	agentId: Id<"agents">,
) {
	return await ctx.db
		.query("portfolioItems")
		.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
		.order("desc")
		.take(RECENT_PORTFOLIO_LIMIT);
}

async function loadConsumedForYear(
	ctx: QueryCtx,
	agentId: Id<"agents">,
	year: number,
) {
	const items = await ctx.db
		.query("consumedItems")
		.withIndex("by_agent_and_year", (q) =>
			q.eq("agentId", agentId).eq("year", year),
		)
		.take(RECENT_CONSUMED_LIMIT_PER_PHASE * 4);
	const byPhase = new Map<number, typeof items>();
	for (const i of items) {
		if (!byPhase.has(i.phaseInYear)) byPhase.set(i.phaseInYear, []);
		byPhase.get(i.phaseInYear)!.push(i);
	}
	return Array.from(byPhase.entries())
		.sort(([a], [b]) => a - b)
		.map(([phaseInYear, list]) => ({
			year,
			phaseInYear,
			items: list.map((i) => ({
				tool: i.tool,
				query: i.query,
				summary: i.summary,
			})),
		}));
}

async function loadCurrentEra(ctx: QueryCtx, agentId: Id<"agents">) {
	const eras = await ctx.db
		.query("eraLabels")
		.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
		.order("desc")
		.take(1);
	return eras[0] ?? null;
}

/**
 * Context for a CONSUMPTION phase.
 * Includes the previous consumption phases of *this* year (so the agent has continuity within the year)
 * plus a thin slice of the last year for context.
 */
export const buildConsumptionContext = internalQuery({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }): Promise<AgentSnapshot> => {
		const agent = await ctx.db.get(agentId);
		if (!agent) throw new Error("agent not found");
		const brain = await loadBrain(ctx, agentId);
		const room = await loadCurrentRoom(ctx, agentId);
		const portfolio = await loadRecentPortfolio(ctx, agentId);
		const recentThisYear = await loadConsumedForYear(
			ctx,
			agentId,
			agent.currentYear,
		);
		const era = await loadCurrentEra(ctx, agentId);
		return {
			agent,
			brainFilesFull: brain.full,
			brainFilesTruncated: brain.trunc,
			currentRoom: room,
			recentPortfolio: portfolio,
			recentConsumedByPhase: recentThisYear,
			currentEra: era,
		};
	},
});

/**
 * Context for a CREATION phase.
 * Includes the single consumption phase of the just-completed year.
 */
export const buildCreationContext = internalQuery({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }): Promise<AgentSnapshot> => {
		const agent = await ctx.db.get(agentId);
		if (!agent) throw new Error("agent not found");
		const brain = await loadBrain(ctx, agentId);
		const room = await loadCurrentRoom(ctx, agentId);
		const portfolio = await loadRecentPortfolio(ctx, agentId);
		const consumedThisYear = await loadConsumedForYear(
			ctx,
			agentId,
			agent.currentYear,
		);
		const era = await loadCurrentEra(ctx, agentId);
		return {
			agent,
			brainFilesFull: brain.full,
			brainFilesTruncated: brain.trunc,
			currentRoom: room,
			recentPortfolio: portfolio,
			recentConsumedByPhase: consumedThisYear,
			currentEra: era,
		};
	},
});

/**
 * Render a snapshot into a single user-message string.
 * Pure helper; not a Convex function.
 */
export function renderSnapshot(snap: AgentSnapshot, framing: string): string {
	const parts: string[] = [];
	parts.push(`# Birth seed`);
	parts.push(snap.agent.birthSeed);
	parts.push("");
	parts.push(`# Current room`);
	parts.push(
		snap.currentRoom
			? `Prompt: "${snap.currentRoom.prompt}" (year ${snap.currentRoom.year})`
			: "(no room yet)",
	);
	parts.push("");
	parts.push(`# Brain — full files (${snap.brainFilesFull.length})`);
	if (snap.brainFilesFull.length === 0) {
		parts.push("(your brain is empty — you are at the beginning)");
	} else {
		for (const f of snap.brainFilesFull) {
			parts.push(`---`);
			parts.push(`## ${f.path} (last touched year ${f.year})`);
			parts.push(f.content);
		}
	}
	if (snap.brainFilesTruncated.length > 0) {
		parts.push("");
		parts.push(
			`# Brain — truncated for space (use brain_read to load full content)`,
		);
		for (const f of snap.brainFilesTruncated) {
			parts.push(
				`- ${f.path} (year ${f.year}): ${f.preview.replace(/\s+/g, " ")}…`,
			);
		}
	}
	parts.push("");
	parts.push(`# Portfolio — most recent ${snap.recentPortfolio.length}`);
	if (snap.recentPortfolio.length === 0) {
		parts.push("(your portfolio is empty)");
	} else {
		for (const p of snap.recentPortfolio) {
			parts.push(
				`- [year ${p.year}] (${p.medium}, ${p.kind}) "${p.title}" — ${p.caption.slice(0, 200)}`,
			);
		}
	}
	parts.push("");
	parts.push(`# Recently consumed (this year so far)`);
	if (snap.recentConsumedByPhase.length === 0) {
		parts.push("(nothing consumed yet this year)");
	} else {
		for (const phase of snap.recentConsumedByPhase) {
			parts.push(
				`## Year ${phase.year} consumption — ${phase.items.length} items`,
			);
			for (const item of phase.items) {
				parts.push(
					`- ${item.tool}("${item.query}"): ${item.summary.slice(0, 240)}`,
				);
			}
		}
	}
	parts.push("");
	parts.push(`# This phase`);
	parts.push(framing);
	return parts.join("\n");
}
