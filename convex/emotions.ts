import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { EMOTIONS } from "./lib/emotions";

/** All emotional readings for an agent, ordered by year. */
export const list = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const rows = await ctx.db
			.query("emotionalReadings")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.take(200);
		return rows.sort((a, b) =>
			a.year !== b.year
				? a.year - b.year
				: a._creationTime - b._creationTime,
		);
	},
});

/** The fixed emotion definitions, exposed to the frontend. */
export const definitions = query({
	args: {},
	handler: async () => EMOTIONS,
});

/**
 * Wipe all emotional readings — for clearing stale per-phase rows from the
 * earlier version of the observer. Call once from the Convex dashboard:
 *   internal.emotions.wipeAll({})
 */
export const wipeAll = internalMutation({
	args: {},
	handler: async (ctx) => {
		let deleted = 0;
		while (true) {
			const batch = await ctx.db.query("emotionalReadings").take(100);
			if (batch.length === 0) break;
			for (const row of batch) {
				await ctx.db.delete(row._id);
				deleted++;
			}
			if (batch.length < 100) break;
		}
		return { deleted };
	},
});
