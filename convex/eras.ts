import { v } from "convex/values";
import { query } from "./_generated/server";

export const list = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		return await ctx.db
			.query("eraLabels")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(80);
	},
});

export const current = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const rows = await ctx.db
			.query("eraLabels")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(1);
		return rows[0] ?? null;
	},
});
