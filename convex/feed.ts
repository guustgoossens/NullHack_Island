import { v } from "convex/values";
import { query } from "./_generated/server";

export const byYear = query({
	args: { agentId: v.id("agents"), year: v.number() },
	handler: async (ctx, { agentId, year }) => {
		const items = await ctx.db
			.query("consumedItems")
			.withIndex("by_agent_and_year", (q) =>
				q.eq("agentId", agentId).eq("year", year),
			)
			.take(500);
		return items;
	},
});

export const byPhase = query({
	args: { consumptionPhaseId: v.id("consumptionPhases") },
	handler: async (ctx, { consumptionPhaseId }) => {
		return await ctx.db
			.query("consumedItems")
			.withIndex("by_phase", (q) =>
				q.eq("consumptionPhaseId", consumptionPhaseId),
			)
			.take(200);
		},
});

export const consumptionPhases = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		return await ctx.db
			.query("consumptionPhases")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(300);
	},
});

export const creationPhases = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		return await ctx.db
			.query("creationPhases")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(80);
	},
});
