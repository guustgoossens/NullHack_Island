import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";

const DEFAULT_SECONDS_PER_YEAR = 120;
const DEFAULT_LIFETIME_COST_CAP_USD = 50;

export const birth = mutation({
	args: {
		name: v.string(),
		birthSeed: v.string(),
		startingRoomPrompt: v.string(),
		secondsPerYear: v.optional(v.number()),
		lifetimeCostCapUsd: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const secondsPerYear = args.secondsPerYear ?? DEFAULT_SECONDS_PER_YEAR;

		// First phase fires after one slice (year/5 phases).
		const phaseDelayMs = (secondsPerYear / 5) * 1000;

		const agentId: Id<"agents"> = await ctx.db.insert("agents", {
			name: args.name,
			birthSeed: args.birthSeed,
			startingRoomPrompt: args.startingRoomPrompt,
			status: "alive",
			currentYear: 0,
			currentPhaseInYear: 0,
			secondsPerYear,
			nextPhaseAt: now + phaseDelayMs,
			lifetimeCostUsd: 0,
			lifetimeCostCapUsd:
				args.lifetimeCostCapUsd ?? DEFAULT_LIFETIME_COST_CAP_USD,
			bornAt: now,
		});

		// Seed the starting room. Image generation is scheduled separately.
		const roomVersionId = await ctx.db.insert("roomVersions", {
			agentId,
			year: 0,
			prompt: args.startingRoomPrompt,
			origin: "starting",
			imageStatus: "pending",
			createdAt: now,
		});

		await ctx.scheduler.runAfter(0, internal.tools.render.renderRoomImage, {
			roomVersionId,
		});

		// First consumption phase.
		await ctx.scheduler.runAfter(phaseDelayMs, internal.agent.tick.tickConsumption, {
			agentId,
		});

		return agentId;
	},
});
