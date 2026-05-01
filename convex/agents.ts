import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: {},
	handler: async (ctx) => {
		// Bounded — we never expect to demo with thousands of agents.
		return await ctx.db.query("agents").take(100);
	},
});

export const get = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		return await ctx.db.get(agentId);
	},
});

export const pause = mutation({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		await ctx.db.patch(agentId, { status: "paused" });
	},
});

export const resume = mutation({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		await ctx.db.patch(agentId, {
			status: "alive",
			nextPhaseAt: Date.now(),
		});
	},
});

export const setSpeed = mutation({
	args: { agentId: v.id("agents"), secondsPerYear: v.number() },
	handler: async (ctx, { agentId, secondsPerYear }) => {
		await ctx.db.patch(agentId, { secondsPerYear });
	},
});
