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
		// Empty until the self-genesis pass writes one. UI should treat empty as "still cooking".
		birthSeed: v.string(),
		startingRoomPrompt: v.string(),
		// Self-genesis lifecycle. Until "ready", the tick scheduler holds off so
		// the agent's first phase has its own seed in context. Optional so that
		// agents born before this field existed remain valid (they're treated
		// as already-ready by the runtime).
		genesisStatus: v.optional(
			v.union(
				v.literal("pending"),
				v.literal("ready"),
				v.literal("failed"),
			),
		),
		genesisError: v.optional(v.string()),
		status: v.union(
			v.literal("alive"),
			v.literal("paused"),
			v.literal("dead"),
		),

		// Sim time. Phase 0 = consumption, 1 = creation. (Legacy rows may carry
		// values from the old four-seasons layout, 0..3 consumption + 4 creation;
		// the scheduler safely wraps anything > 1 to phase 0 of next year.)
		currentYear: v.number(),
		currentPhaseInYear: v.number(),

		// Real-time pacing.
		secondsPerYear: v.number(),
		nextPhaseAt: v.number(),

		// Anthropic model the agent itself runs on (tick + genesis). Optional
		// for backwards compatibility — falls back to DEFAULT_AGENT_MODEL.
		// Observer/assessment uses a fixed model and ignores this field.
		model: v.optional(v.string()),

		// Cost / output guardrails.
		lifetimeCostUsd: v.number(),
		lifetimeCostCapUsd: v.number(),
		// Hard ceiling on output tokens an agent may emit per phase across all
		// tool-loop turns. Caps runaway loops independently of the cost cap.
		// Optional for backwards compatibility — code falls back to a default.
		maxOutputTokensPerPhase: v.optional(v.number()),

		bornAt: v.number(),
	})
		.index("by_status_and_nextPhaseAt", ["status", "nextPhaseAt"])
		.index("by_status", ["status"]),

	consumptionPhases: defineTable({
		agentId: v.id("agents"),
		year: v.number(),
		phaseInYear: v.number(), // always 0 going forward; legacy rows may be 0..3
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

	// Brain — tree as slash-delimited paths. Files and folders share the same
	// table; `kind` discriminates. Folders are markers (no content) so the
	// agent can create empty buckets and so the tree query knows about them
	// even when nothing is inside yet.
	brainFiles: defineTable({
		agentId: v.id("agents"),
		path: v.string(),
		// Optional for backwards compat — undefined rows are treated as files.
		kind: v.optional(v.union(v.literal("file"), v.literal("folder"))),
		content: v.string(), // "" for folders
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
			v.literal("rename"),
			v.literal("mkdir"),
		),
		// For "rename" rows: where the node lived before this op.
		fromPath: v.optional(v.string()),
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

	// 8-axis personality vector, one row per assessment. Schema is permissive
	// (the scores object) — axis keys live in convex/lib/personality.ts and are
	// validated in code, so adding/removing axes doesn't require a migration.
	personalityScores: defineTable({
		agentId: v.id("agents"),
		year: v.number(),
		origin: v.union(v.literal("birth"), v.literal("yearly")),
		// Map of axis key -> score (1..10).
		scores: v.any(),
		rationale: v.optional(v.string()),
		creationPhaseId: v.optional(v.id("creationPhases")),
	}).index("by_agent_and_year", ["agentId", "year"]),
});
