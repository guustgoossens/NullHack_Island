import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { DEFAULT_AGENT_MODEL, isAgentModel } from "./lib/anthropic";
import { BLANK_ROOM_PROMPT } from "./lib/personality";

// 0 means "schedule the next phase immediately when the current one finishes."
// Set higher only if you want artificial wall-clock pacing for viewing.
const DEFAULT_SECONDS_PER_YEAR = 0;
const DEFAULT_LIFETIME_COST_CAP_USD = 50;
// Hard ceiling on agent-generated tokens per phase (across all tool-loop
// turns). Tight on purpose — the system prompt tells the agent to be brief,
// and a smaller cap keeps inference latency under control.
const DEFAULT_MAX_OUTPUT_TOKENS_PER_PHASE = 3_500;

export const birth = mutation({
	args: {
		name: v.string(),
		secondsPerYear: v.optional(v.number()),
		lifetimeCostCapUsd: v.optional(v.number()),
		maxOutputTokensPerPhase: v.optional(v.number()),
		model: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const secondsPerYear = args.secondsPerYear ?? DEFAULT_SECONDS_PER_YEAR;
		const model =
			args.model && isAgentModel(args.model)
				? args.model
				: DEFAULT_AGENT_MODEL;

		const agentId: Id<"agents"> = await ctx.db.insert("agents", {
			name: args.name,
			// Empty until self-genesis writes one. The agent owns its own seed.
			birthSeed: "",
			startingRoomPrompt: BLANK_ROOM_PROMPT,
			genesisStatus: "pending",
			status: "alive",
			currentYear: 0,
			currentPhaseInYear: 0,
			secondsPerYear,
			// Real first phase is scheduled by self-genesis once it finishes;
			// keep nextPhaseAt in the future as a placeholder.
			nextPhaseAt: now + 60 * 60 * 1000,
			model,
			lifetimeCostUsd: 0,
			lifetimeCostCapUsd:
				args.lifetimeCostCapUsd ?? DEFAULT_LIFETIME_COST_CAP_USD,
			maxOutputTokensPerPhase:
				args.maxOutputTokensPerPhase ?? DEFAULT_MAX_OUTPUT_TOKENS_PER_PHASE,
			bornAt: now,
		});

		// Seed the starting room with the hardcoded blank-canvas prompt and
		// kick off image generation so the gallery has something to show even
		// before the agent has lived a year.
		const roomVersionId = await ctx.db.insert("roomVersions", {
			agentId,
			year: 0,
			prompt: BLANK_ROOM_PROMPT,
			origin: "starting",
			imageStatus: "pending",
			createdAt: now,
		});

		await ctx.scheduler.runAfter(0, internal.tools.render.renderRoomImage, {
			roomVersionId,
		});

		// Self-genesis: the agent picks its own seed + initial personality
		// vector. The first consumption phase is scheduled by genesis itself
		// once those land.
		await ctx.scheduler.runAfter(0, internal.agent.genesis.runSelfGenesis, {
			agentId,
		});

		return agentId;
	},
});
