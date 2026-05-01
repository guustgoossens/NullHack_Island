import { v } from "convex/values";
import { query } from "./_generated/server";
import { PERSONALITY_AXES } from "./lib/personality";

/** All personality score rows for an agent, ordered by year ascending. */
export const list = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const rows = await ctx.db
			.query("personalityScores")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.take(200);
		return rows.sort((a, b) =>
			a.year !== b.year
				? a.year - b.year
				: a._creationTime - b._creationTime,
		);
	},
});

/** The fixed axis definitions, exposed to the frontend so the loadings chart
 *  can label points without duplicating the schema. */
export const axes = query({
	args: {},
	handler: async () => PERSONALITY_AXES,
});
