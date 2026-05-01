import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";

const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Re-arm any alive agent whose nextPhaseAt is more than 5 min in the past.
 * This catches crashes / dropped scheduler jobs.
 */
export const watchdog = internalAction({
	args: {},
	handler: async (ctx) => {
		const due = await ctx.runQuery(internal.crons.findStuckAgents, {
			cutoff: Date.now() - STUCK_AFTER_MS,
		});
		for (const agent of due) {
			const isCreation = agent.currentPhaseInYear === 4;
			if (isCreation) {
				await ctx.scheduler.runAfter(
					0,
					internal.agent.tick.tickCreation,
					{ agentId: agent._id },
				);
			} else {
				await ctx.scheduler.runAfter(
					0,
					internal.agent.tick.tickConsumption,
					{ agentId: agent._id },
				);
			}
		}
	},
});

export const findStuckAgents = internalQuery({
	args: { cutoff: v.number() },
	handler: async (ctx, { cutoff }) => {
		return await ctx.db
			.query("agents")
			.withIndex("by_status_and_nextPhaseAt", (q) =>
				q.eq("status", "alive").lt("nextPhaseAt", cutoff),
			)
			.take(100);
	},
});

const crons = cronJobs();
crons.interval("agent watchdog", { minutes: 1 }, internal.crons.watchdog, {});
export default crons;
