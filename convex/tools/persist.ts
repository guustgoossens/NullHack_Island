// Shared internal mutations + queries used by the tool dispatcher and the lifecycle.
// Keeping these in one file avoids generating a Convex function per tool helper.

import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
} from "../_generated/server";

// ---------- consumption ----------

export const persistConsumedItem = internalMutation({
	args: {
		agentId: v.id("agents"),
		consumptionPhaseId: v.id("consumptionPhases"),
		year: v.number(),
		phaseInYear: v.number(),
		tool: v.string(),
		query: v.string(),
		summary: v.string(),
		payload: v.any(),
	},
	handler: async (ctx, args): Promise<Id<"consumedItems">> => {
		return await ctx.db.insert("consumedItems", args);
	},
});

export const getConsumedItem = internalQuery({
	args: { id: v.id("consumedItems") },
	handler: async (ctx, { id }): Promise<Doc<"consumedItems"> | null> => {
		return await ctx.db.get(id);
	},
});

// ---------- brain ----------

async function patchCreationFlag(
	ctx: MutationCtx,
	creationPhaseId: Id<"creationPhases">,
	field: "brainTouched" | "roomTouched" | "portfolioTouched",
) {
	await ctx.db.patch(creationPhaseId, { [field]: true });
}

export const brainWrite = internalMutation({
	args: {
		agentId: v.id("agents"),
		creationPhaseId: v.id("creationPhases"),
		year: v.number(),
		path: v.string(),
		content: v.string(),
	},
	handler: async (ctx, args): Promise<{ version: number; created: boolean }> => {
		const existing = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_path", (q) =>
				q.eq("agentId", args.agentId).eq("path", args.path),
			)
			.unique();
		let version: number;
		let created: boolean;
		if (existing) {
			version = existing.currentVersion + 1;
			await ctx.db.patch(existing._id, {
				content: args.content,
				currentVersion: version,
				lastUpdatedYear: args.year,
				deleted: false,
			});
			created = false;
		} else {
			version = 1;
			await ctx.db.insert("brainFiles", {
				agentId: args.agentId,
				path: args.path,
				content: args.content,
				currentVersion: version,
				createdAtYear: args.year,
				lastUpdatedYear: args.year,
				deleted: false,
			});
			created = true;
		}
		await ctx.db.insert("brainFileVersions", {
			agentId: args.agentId,
			path: args.path,
			version,
			content: args.content,
			year: args.year,
			creationPhaseId: args.creationPhaseId,
			op: created ? "create" : "update",
		});
		await patchCreationFlag(ctx, args.creationPhaseId, "brainTouched");
		return { version, created };
	},
});

export const brainDelete = internalMutation({
	args: {
		agentId: v.id("agents"),
		creationPhaseId: v.id("creationPhases"),
		year: v.number(),
		path: v.string(),
	},
	handler: async (ctx, args): Promise<boolean> => {
		const existing = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_path", (q) =>
				q.eq("agentId", args.agentId).eq("path", args.path),
			)
			.unique();
		if (!existing || existing.deleted) return false;
		const version = existing.currentVersion + 1;
		await ctx.db.patch(existing._id, {
			deleted: true,
			currentVersion: version,
			lastUpdatedYear: args.year,
		});
		await ctx.db.insert("brainFileVersions", {
			agentId: args.agentId,
			path: args.path,
			version,
			content: "",
			year: args.year,
			creationPhaseId: args.creationPhaseId,
			op: "delete",
		});
		await patchCreationFlag(ctx, args.creationPhaseId, "brainTouched");
		return true;
	},
});

export const brainRead = internalQuery({
	args: { agentId: v.id("agents"), path: v.string() },
	handler: async (
		ctx,
		{ agentId, path },
	): Promise<{ content: string; year: number } | null> => {
		const f = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_path", (q) =>
				q.eq("agentId", agentId).eq("path", path),
			)
			.unique();
		if (!f || f.deleted) return null;
		return { content: f.content, year: f.lastUpdatedYear };
	},
});

// ---------- room ----------

export const insertRoomVersion = internalMutation({
	args: {
		agentId: v.id("agents"),
		creationPhaseId: v.id("creationPhases"),
		year: v.number(),
		prompt: v.string(),
		origin: v.union(v.literal("rewrite"), v.literal("noop")),
	},
	handler: async (ctx, args): Promise<Id<"roomVersions">> => {
		// Find parent (most recent) version.
		const parents = await ctx.db
			.query("roomVersions")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", args.agentId))
			.order("desc")
			.take(1);
		const parentVersionId = parents[0]?._id;
		const id = await ctx.db.insert("roomVersions", {
			agentId: args.agentId,
			year: args.year,
			prompt: args.prompt,
			parentVersionId,
			creationPhaseId: args.creationPhaseId,
			origin: args.origin,
			imageStatus: "pending",
			createdAt: Date.now(),
		});
		await patchCreationFlag(ctx, args.creationPhaseId, "roomTouched");
		return id;
	},
});

export const setRoomImage = internalMutation({
	args: {
		roomVersionId: v.id("roomVersions"),
		imageStorageId: v.id("_storage"),
	},
	handler: async (ctx, { roomVersionId, imageStorageId }) => {
		await ctx.db.patch(roomVersionId, {
			imageStorageId,
			imageStatus: "ready",
		});
	},
});

export const setRoomFailed = internalMutation({
	args: {
		roomVersionId: v.id("roomVersions"),
		error: v.string(),
	},
	handler: async (ctx, { roomVersionId, error }) => {
		await ctx.db.patch(roomVersionId, {
			imageStatus: "failed",
			imageError: error,
		});
	},
});

export const getRoomVersion = internalQuery({
	args: { id: v.id("roomVersions") },
	handler: async (ctx, { id }): Promise<Doc<"roomVersions"> | null> => {
		return await ctx.db.get(id);
	},
});

// Returns the agent's "starting" room — the year-0 render that anchors the
// camera POV and architecture. Used by the room renderer as the reference
// image for every subsequent redecoration.
export const getStartingRoom = internalQuery({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }): Promise<Doc<"roomVersions"> | null> => {
		const rows = await ctx.db
			.query("roomVersions")
			.withIndex("by_agent_and_year", (q) =>
				q.eq("agentId", agentId).eq("year", 0),
			)
			.take(10);
		// Prefer the row explicitly tagged "starting"; fall back to any year-0
		// row if the tag is missing (e.g. legacy data).
		const starting = rows.find((r) => r.origin === "starting");
		return starting ?? rows[0] ?? null;
	},
});

// ---------- portfolio ----------

const portfolioMedium = v.union(
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

export const insertPortfolioItem = internalMutation({
	args: {
		agentId: v.id("agents"),
		creationPhaseId: v.id("creationPhases"),
		year: v.number(),
		kind: v.union(v.literal("curated"), v.literal("created")),
		medium: portfolioMedium,
		title: v.string(),
		caption: v.string(),
		payload: portfolioPayload,
		citedConsumedItemIds: v.array(v.id("consumedItems")),
		status: v.union(
			v.literal("pending"),
			v.literal("ready"),
			v.literal("failed"),
		),
	},
	handler: async (ctx, args): Promise<Id<"portfolioItems">> => {
		const id = await ctx.db.insert("portfolioItems", {
			...args,
			createdAt: Date.now(),
		});
		await patchCreationFlag(ctx, args.creationPhaseId, "portfolioTouched");
		return id;
	},
});

export const setPortfolioBlob = internalMutation({
	args: {
		portfolioItemId: v.id("portfolioItems"),
		storageId: v.id("_storage"),
		mimeType: v.string(),
	},
	handler: async (ctx, { portfolioItemId, storageId, mimeType }) => {
		await ctx.db.patch(portfolioItemId, {
			payload: { kind: "blob", storageId, mimeType },
			status: "ready",
		});
	},
});

export const setPortfolioFailed = internalMutation({
	args: {
		portfolioItemId: v.id("portfolioItems"),
		error: v.string(),
	},
	handler: async (ctx, { portfolioItemId, error }) => {
		await ctx.db.patch(portfolioItemId, {
			status: "failed",
			errorMessage: error,
		});
	},
});

export const getPortfolioItem = internalQuery({
	args: { id: v.id("portfolioItems") },
	handler: async (ctx, { id }): Promise<Doc<"portfolioItems"> | null> => {
		return await ctx.db.get(id);
	},
});

// ---------- phases ----------

export const insertConsumptionPhase = internalMutation({
	args: {
		agentId: v.id("agents"),
		year: v.number(),
		phaseInYear: v.number(),
	},
	handler: async (ctx, args): Promise<Id<"consumptionPhases">> => {
		return await ctx.db.insert("consumptionPhases", {
			...args,
			startedAt: Date.now(),
		});
	},
});

export const completeConsumptionPhase = internalMutation({
	args: {
		consumptionPhaseId: v.id("consumptionPhases"),
		reflection: v.string(),
	},
	handler: async (ctx, { consumptionPhaseId, reflection }) => {
		await ctx.db.patch(consumptionPhaseId, {
			reflection,
			completedAt: Date.now(),
		});
	},
});

export const insertCreationPhase = internalMutation({
	args: { agentId: v.id("agents"), year: v.number() },
	handler: async (ctx, args): Promise<Id<"creationPhases">> => {
		return await ctx.db.insert("creationPhases", {
			...args,
			brainTouched: false,
			roomTouched: false,
			portfolioTouched: false,
			startedAt: Date.now(),
		});
	},
});

export const completeCreationPhase = internalMutation({
	args: {
		creationPhaseId: v.id("creationPhases"),
		reflection: v.string(),
	},
	handler: async (ctx, { creationPhaseId, reflection }) => {
		await ctx.db.patch(creationPhaseId, {
			reflection,
			completedAt: Date.now(),
		});
	},
});

export const getCreationPhase = internalQuery({
	args: { id: v.id("creationPhases") },
	handler: async (ctx, { id }): Promise<Doc<"creationPhases"> | null> => {
		return await ctx.db.get(id);
	},
});

// Force-flip an artifact's "touched" flag without inserting any artifact row.
// Used by the creation-phase fallback when the agent fails to touch an artifact
// after MAX_NUDGES — we want the year to advance, but we don't want to
// fabricate brain entries or portfolio items the agent didn't actually make.
export const markArtifactTouched = internalMutation({
	args: {
		creationPhaseId: v.id("creationPhases"),
		artifact: v.union(
			v.literal("brain"),
			v.literal("room"),
			v.literal("portfolio"),
		),
	},
	handler: async (ctx, { creationPhaseId, artifact }) => {
		const field =
			artifact === "brain"
				? "brainTouched"
				: artifact === "room"
					? "roomTouched"
					: "portfolioTouched";
		await ctx.db.patch(creationPhaseId, { [field]: true });
	},
});

// ---------- agent lifecycle ----------

export const advanceAgentClock = internalMutation({
	args: {
		agentId: v.id("agents"),
		nextPhaseAt: v.number(),
	},
	handler: async (ctx, { agentId, nextPhaseAt }) => {
		const agent = await ctx.db.get(agentId);
		if (!agent) return;
		// Advance phase counter. Year = 1 consumption (phase 0) + 1 creation
		// (phase 1). After phase 1, wrap to phase 0 of next year. Any legacy
		// agents stuck on a higher phaseInYear (the old 0..4 layout) are
		// safely wrapped on their next tick.
		let nextYear = agent.currentYear;
		let nextPhase = agent.currentPhaseInYear + 1;
		if (nextPhase > 1) {
			nextPhase = 0;
			nextYear += 1;
		}
		const status: Doc<"agents">["status"] = nextYear >= 60 ? "dead" : agent.status;
		await ctx.db.patch(agentId, {
			currentYear: nextYear,
			currentPhaseInYear: nextPhase,
			nextPhaseAt,
			status,
		});
	},
});

export const addAgentCost = internalMutation({
	args: { agentId: v.id("agents"), deltaUsd: v.number() },
	handler: async (ctx, { agentId, deltaUsd }) => {
		const agent = await ctx.db.get(agentId);
		if (!agent) return;
		const next = agent.lifetimeCostUsd + deltaUsd;
		const status =
			next > agent.lifetimeCostCapUsd ? "paused" : agent.status;
		await ctx.db.patch(agentId, {
			lifetimeCostUsd: next,
			status,
		});
	},
});

export const persistTranscript = internalMutation({
	args: {
		agentId: v.id("agents"),
		phaseRef: v.union(
			v.object({
				kind: v.literal("consumption"),
				id: v.id("consumptionPhases"),
			}),
			v.object({
				kind: v.literal("creation"),
				id: v.id("creationPhases"),
			}),
		),
		messages: v.any(),
		tokensInput: v.number(),
		tokensOutput: v.number(),
		costUsd: v.number(),
	},
	handler: async (ctx, args) => {
		await ctx.db.insert("phaseTranscripts", args);
	},
});

export const persistToolCall = internalMutation({
	args: {
		agentId: v.id("agents"),
		phaseRef: v.union(
			v.object({
				kind: v.literal("consumption"),
				id: v.id("consumptionPhases"),
			}),
			v.object({
				kind: v.literal("creation"),
				id: v.id("creationPhases"),
			}),
		),
		tool: v.string(),
		args: v.any(),
		result: v.any(),
		durationMs: v.number(),
		costUsd: v.number(),
		error: v.optional(v.string()),
	},
	handler: async (ctx, payload) => {
		await ctx.db.insert("toolCalls", payload);
	},
});

export const insertEraLabel = internalMutation({
	args: {
		agentId: v.id("agents"),
		year: v.number(),
		label: v.string(),
		summary: v.string(),
		confidence: v.number(),
	},
	handler: async (ctx, args) => {
		await ctx.db.insert("eraLabels", args);
	},
});

export const insertEmotionReading = internalMutation({
	args: {
		agentId: v.id("agents"),
		year: v.number(),
		emotions: v.any(),
		salientPull: v.string(),
		dominantEmotion: v.string(),
		creationPhaseId: v.optional(v.id("creationPhases")),
	},
	handler: async (ctx, args) => {
		await ctx.db.insert("emotionalReadings", args);
	},
});
