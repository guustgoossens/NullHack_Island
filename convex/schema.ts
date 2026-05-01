import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const phaseRef = v.union(
	v.object({
		kind: v.literal("consumption"),
		id: v.id("consumptionPhases"),
	}),
	v.object({
		kind: v.literal("creation"),
		id: v.id("creationPhases"),
	}),
);

const portfolioPayload = v.union(
	v.object({
		kind: v.literal("blob"),
		storageId: v.id("_storage"),
		mimeType: v.string(),
	}),
	v.object({
		kind: v.literal("html"),
		html: v.string(),
	}),
	v.object({
		kind: v.literal("threejs"),
		code: v.string(),
	}),
	v.object({
		kind: v.literal("text"),
		text: v.string(),
	}),
	v.object({
		kind: v.literal("external"),
		url: v.string(),
		sourceTool: v.string(),
	}),
);

export default defineSchema({
	agents: defineTable({
		name: v.string(),
		birthSeed: v.string(),
		startingRoomPrompt: v.string(),
		status: v.union(
			v.literal("alive"),
			v.literal("paused"),
			v.literal("dead"),
		),

		// Sim time. Phase 0..3 = consumption, 4 = creation.
		currentYear: v.number(),
		currentPhaseInYear: v.number(),

		// Real-time pacing.
		secondsPerYear: v.number(),
		nextPhaseAt: v.number(),

		// Cost guardrails.
		lifetimeCostUsd: v.number(),
		lifetimeCostCapUsd: v.number(),

		bornAt: v.number(),
	})
		.index("by_status_and_nextPhaseAt", ["status", "nextPhaseAt"])
		.index("by_status", ["status"]),

	consumptionPhases: defineTable({
		agentId: v.id("agents"),
		year: v.number(),
		phaseInYear: v.number(), // 0..3
		reflection: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
	})
		.index("by_agent_and_year_and_phaseInYear", [
			"agentId",
			"year",
			"phaseInYear",
		])
		.index("by_agent_and_year", ["agentId", "year"]),

	creationPhases: defineTable({
		agentId: v.id("agents"),
		year: v.number(),
		reflection: v.optional(v.string()),
		brainTouched: v.boolean(),
		roomTouched: v.boolean(),
		portfolioTouched: v.boolean(),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
	}).index("by_agent_and_year", ["agentId", "year"]),

	consumedItems: defineTable({
		agentId: v.id("agents"),
		consumptionPhaseId: v.id("consumptionPhases"),
		year: v.number(),
		phaseInYear: v.number(),
		tool: v.string(),
		query: v.string(),
		summary: v.string(), // compact text the LLM sees later
		payload: v.any(), // raw tool result, tool-specific
		thumbnailStorageId: v.optional(v.id("_storage")),
	})
		.index("by_agent_and_year", ["agentId", "year"])
		.index("by_phase", ["consumptionPhaseId"]),

	// Brain — tree as slash-delimited paths. Frontend builds the tree from a flat list.
	brainFiles: defineTable({
		agentId: v.id("agents"),
		path: v.string(),
		content: v.string(),
		currentVersion: v.number(),
		createdAtYear: v.number(),
		lastUpdatedYear: v.number(),
		deleted: v.boolean(),
	})
		.index("by_agent_and_path", ["agentId", "path"])
		.index("by_agent_and_lastUpdatedYear", ["agentId", "lastUpdatedYear"]),

	brainFileVersions: defineTable({
		agentId: v.id("agents"),
		path: v.string(),
		version: v.number(),
		content: v.string(),
		year: v.number(),
		creationPhaseId: v.id("creationPhases"),
		op: v.union(
			v.literal("create"),
			v.literal("update"),
			v.literal("delete"),
		),
	})
		.index("by_agent_and_path_and_version", ["agentId", "path", "version"])
		.index("by_agent_and_year", ["agentId", "year"]),

	roomVersions: defineTable({
		agentId: v.id("agents"),
		year: v.number(),
		prompt: v.string(),
		imageStorageId: v.optional(v.id("_storage")),
		parentVersionId: v.optional(v.id("roomVersions")),
		creationPhaseId: v.optional(v.id("creationPhases")),
		// "starting" = birth-time room (no creation phase yet)
		// "rewrite" = agent rewrote the prompt
		// "noop"    = creation phase ended without a real change (contract fallback)
		origin: v.union(
			v.literal("starting"),
			v.literal("rewrite"),
			v.literal("noop"),
		),
		// Generation status — image gen is async-ish, may be queued/failed.
		imageStatus: v.union(
			v.literal("pending"),
			v.literal("ready"),
			v.literal("failed"),
		),
		imageError: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_agent_and_year", ["agentId", "year"]),

	portfolioItems: defineTable({
		agentId: v.id("agents"),
		year: v.number(),
		creationPhaseId: v.optional(v.id("creationPhases")),
		kind: v.union(v.literal("curated"), v.literal("created")),
		medium: v.union(
			v.literal("image"),
			v.literal("manim"),
			v.literal("html"),
			v.literal("threejs"),
			v.literal("ascii"),
			v.literal("poem"),
			v.literal("essay"),
			v.literal("writing"),
			v.literal("found_image"),
			v.literal("found_music"),
			v.literal("found_text"),
		),
		title: v.string(),
		caption: v.string(),
		payload: portfolioPayload,
		thumbnailStorageId: v.optional(v.id("_storage")),
		citedConsumedItemIds: v.array(v.id("consumedItems")),
		// Same status concept as room — heavy mediums (image/manim) generate async.
		status: v.union(
			v.literal("pending"),
			v.literal("ready"),
			v.literal("failed"),
		),
		errorMessage: v.optional(v.string()),
		createdAt: v.number(),
	})
		.index("by_agent_and_year", ["agentId", "year"])
		.index("by_agent_and_medium", ["agentId", "medium"]),

	// Observer-pass output. Never fed back to the agent.
	eraLabels: defineTable({
		agentId: v.id("agents"),
		year: v.number(),
		label: v.string(),
		summary: v.string(),
		confidence: v.number(),
	}).index("by_agent_and_year", ["agentId", "year"]),

	// Full Anthropic message log per phase, for replay / debug.
	phaseTranscripts: defineTable({
		agentId: v.id("agents"),
		phaseRef,
		messages: v.any(),
		tokensInput: v.number(),
		tokensOutput: v.number(),
		costUsd: v.number(),
	}).index("by_agent", ["agentId"]),

	toolCalls: defineTable({
		agentId: v.id("agents"),
		phaseRef,
		tool: v.string(),
		args: v.any(),
		result: v.any(),
		durationMs: v.number(),
		costUsd: v.number(),
		error: v.optional(v.string()),
	}).index("by_agent", ["agentId"]),
});
