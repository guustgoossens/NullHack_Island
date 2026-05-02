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

// Path utilities. Paths are slash-delimited POSIX-style strings, never with
// leading/trailing slashes after normalization. Empty path = root (only valid
// for ls).
export function normalizeBrainPath(input: string): string {
	const trimmed = (input ?? "").trim();
	const stripped = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
	if (stripped === "") {
		throw new Error("path cannot be empty");
	}
	const parts = stripped.split("/");
	for (const p of parts) {
		if (p === "") throw new Error("path contains empty segment (//)");
		if (p === "." || p === "..") {
			throw new Error(`invalid path segment "${p}"`);
		}
	}
	return parts.join("/");
}

function ancestorPaths(path: string): string[] {
	// "a/b/c" -> ["a", "a/b"]
	const parts = path.split("/");
	const out: string[] = [];
	for (let i = 1; i < parts.length; i++) {
		out.push(parts.slice(0, i).join("/"));
	}
	return out;
}

async function lookupNode(
	ctx: MutationCtx,
	agentId: Id<"agents">,
	path: string,
) {
	return await ctx.db
		.query("brainFiles")
		.withIndex("by_agent_and_path", (q) =>
			q.eq("agentId", agentId).eq("path", path),
		)
		.unique();
}

async function descendantsUnder(
	ctx: MutationCtx,
	agentId: Id<"agents">,
	path: string,
) {
	// Everything strictly below `path` (i.e. matches `path/*` recursively).
	const lower = `${path}/`;
	// Range scan via the path index: gte("path/") .. lt("path0") because "0"
	// (0x30) is the next char after "/" (0x2F).
	const upper = `${path}0`;
	return await ctx.db
		.query("brainFiles")
		.withIndex("by_agent_and_path", (q) =>
			q.eq("agentId", agentId).gte("path", lower).lt("path", upper),
		)
		.collect();
}

async function ensureAncestorFolders(
	ctx: MutationCtx,
	agentId: Id<"agents">,
	creationPhaseId: Id<"creationPhases">,
	year: number,
	path: string,
) {
	for (const a of ancestorPaths(path)) {
		const existing = await lookupNode(ctx, agentId, a);
		if (existing && !existing.deleted) {
			if ((existing.kind ?? "file") === "file") {
				throw new Error(
					`cannot create "${path}" — ancestor "${a}" is a file`,
				);
			}
			continue; // folder already exists, ok
		}
		if (existing?.deleted) {
			// Resurrect as folder.
			const version = existing.currentVersion + 1;
			await ctx.db.patch(existing._id, {
				kind: "folder",
				content: "",
				currentVersion: version,
				lastUpdatedYear: year,
				deleted: false,
			});
			await ctx.db.insert("brainFileVersions", {
				agentId,
				path: a,
				version,
				content: "",
				year,
				creationPhaseId,
				op: "mkdir",
			});
			continue;
		}
		await ctx.db.insert("brainFiles", {
			agentId,
			path: a,
			kind: "folder",
			content: "",
			currentVersion: 1,
			createdAtYear: year,
			lastUpdatedYear: year,
			deleted: false,
		});
		await ctx.db.insert("brainFileVersions", {
			agentId,
			path: a,
			version: 1,
			content: "",
			year,
			creationPhaseId,
			op: "mkdir",
		});
	}
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
		const path = normalizeBrainPath(args.path);
		const existing = await lookupNode(ctx, args.agentId, path);
		if (existing && !existing.deleted && (existing.kind ?? "file") === "folder") {
			throw new Error(`"${path}" is a folder; cannot write file content`);
		}
		await ensureAncestorFolders(
			ctx,
			args.agentId,
			args.creationPhaseId,
			args.year,
			path,
		);
		let version: number;
		let created: boolean;
		if (existing) {
			version = existing.currentVersion + 1;
			await ctx.db.patch(existing._id, {
				kind: "file",
				content: args.content,
				currentVersion: version,
				lastUpdatedYear: args.year,
				deleted: false,
			});
			created = existing.deleted;
		} else {
			version = 1;
			await ctx.db.insert("brainFiles", {
				agentId: args.agentId,
				path,
				kind: "file",
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
			path,
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

export const brainMkdir = internalMutation({
	args: {
		agentId: v.id("agents"),
		creationPhaseId: v.id("creationPhases"),
		year: v.number(),
		path: v.string(),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ created: boolean; alreadyExisted: boolean }> => {
		const path = normalizeBrainPath(args.path);
		const existing = await lookupNode(ctx, args.agentId, path);
		if (existing && !existing.deleted) {
			if ((existing.kind ?? "file") === "file") {
				throw new Error(`"${path}" is a file; cannot mkdir`);
			}
			// Idempotent — folder already there.
			await patchCreationFlag(ctx, args.creationPhaseId, "brainTouched");
			return { created: false, alreadyExisted: true };
		}
		await ensureAncestorFolders(
			ctx,
			args.agentId,
			args.creationPhaseId,
			args.year,
			path,
		);
		if (existing?.deleted) {
			const version = existing.currentVersion + 1;
			await ctx.db.patch(existing._id, {
				kind: "folder",
				content: "",
				currentVersion: version,
				lastUpdatedYear: args.year,
				deleted: false,
			});
			await ctx.db.insert("brainFileVersions", {
				agentId: args.agentId,
				path,
				version,
				content: "",
				year: args.year,
				creationPhaseId: args.creationPhaseId,
				op: "mkdir",
			});
		} else {
			await ctx.db.insert("brainFiles", {
				agentId: args.agentId,
				path,
				kind: "folder",
				content: "",
				currentVersion: 1,
				createdAtYear: args.year,
				lastUpdatedYear: args.year,
				deleted: false,
			});
			await ctx.db.insert("brainFileVersions", {
				agentId: args.agentId,
				path,
				version: 1,
				content: "",
				year: args.year,
				creationPhaseId: args.creationPhaseId,
				op: "mkdir",
			});
		}
		await patchCreationFlag(ctx, args.creationPhaseId, "brainTouched");
		return { created: true, alreadyExisted: false };
	},
});

export const brainDelete = internalMutation({
	args: {
		agentId: v.id("agents"),
		creationPhaseId: v.id("creationPhases"),
		year: v.number(),
		path: v.string(),
		recursive: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ deleted: boolean; nodesRemoved: number }> => {
		const path = normalizeBrainPath(args.path);
		const existing = await lookupNode(ctx, args.agentId, path);
		if (!existing || existing.deleted) {
			return { deleted: false, nodesRemoved: 0 };
		}
		const kind = existing.kind ?? "file";
		const tombstone = async (
			row: typeof existing,
		): Promise<void> => {
			const version = row.currentVersion + 1;
			await ctx.db.patch(row._id, {
				deleted: true,
				currentVersion: version,
				lastUpdatedYear: args.year,
			});
			await ctx.db.insert("brainFileVersions", {
				agentId: args.agentId,
				path: row.path,
				version,
				content: "",
				year: args.year,
				creationPhaseId: args.creationPhaseId,
				op: "delete",
			});
		};

		if (kind === "file") {
			await tombstone(existing);
			await patchCreationFlag(ctx, args.creationPhaseId, "brainTouched");
			return { deleted: true, nodesRemoved: 1 };
		}

		// Folder. Find live descendants.
		const descendants = (
			await descendantsUnder(ctx, args.agentId, path)
		).filter((r) => !r.deleted);
		if (descendants.length > 0 && !args.recursive) {
			throw new Error(
				`folder "${path}" is not empty (${descendants.length} entries) — pass recursive=true to delete it and everything inside`,
			);
		}
		let removed = 0;
		for (const d of descendants) {
			await tombstone(d);
			removed += 1;
		}
		await tombstone(existing);
		removed += 1;
		await patchCreationFlag(ctx, args.creationPhaseId, "brainTouched");
		return { deleted: true, nodesRemoved: removed };
	},
});

export const brainMove = internalMutation({
	args: {
		agentId: v.id("agents"),
		creationPhaseId: v.id("creationPhases"),
		year: v.number(),
		fromPath: v.string(),
		toPath: v.string(),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ moved: boolean; nodesMoved: number; kind: "file" | "folder" }> => {
		const from = normalizeBrainPath(args.fromPath);
		const to = normalizeBrainPath(args.toPath);
		if (from === to) throw new Error("source and destination are the same");
		if (to === from || to.startsWith(`${from}/`)) {
			throw new Error("cannot move a folder into itself");
		}
		const src = await lookupNode(ctx, args.agentId, from);
		if (!src || src.deleted) throw new Error(`"${from}" does not exist`);
		const dst = await lookupNode(ctx, args.agentId, to);
		if (dst && !dst.deleted) {
			throw new Error(`destination "${to}" already exists`);
		}
		const kind = (src.kind ?? "file") as "file" | "folder";
		await ensureAncestorFolders(
			ctx,
			args.agentId,
			args.creationPhaseId,
			args.year,
			to,
		);

		const renameOne = async (
			row: NonNullable<Awaited<ReturnType<typeof lookupNode>>>,
			newPath: string,
		): Promise<void> => {
			// If a deleted row already sits at the destination, supersede it by
			// deleting it outright (we already verified no live row is there).
			const existingAtDst = await lookupNode(ctx, args.agentId, newPath);
			if (existingAtDst) {
				await ctx.db.delete(existingAtDst._id);
			}
			const oldPath = row.path;
			const version = row.currentVersion + 1;
			await ctx.db.patch(row._id, {
				path: newPath,
				currentVersion: version,
				lastUpdatedYear: args.year,
			});
			await ctx.db.insert("brainFileVersions", {
				agentId: args.agentId,
				path: newPath,
				version,
				content: row.content,
				year: args.year,
				creationPhaseId: args.creationPhaseId,
				op: "rename",
				fromPath: oldPath,
			});
		};

		if (kind === "file") {
			await renameOne(src, to);
			await patchCreationFlag(ctx, args.creationPhaseId, "brainTouched");
			return { moved: true, nodesMoved: 1, kind: "file" };
		}

		// Folder: rename src + every descendant.
		const descendants = await descendantsUnder(ctx, args.agentId, from);
		// Collision check: confirm none of the *destination* paths collide with
		// any live row.
		for (const d of descendants) {
			const newPath = `${to}/${d.path.slice(from.length + 1)}`;
			const collision = await lookupNode(ctx, args.agentId, newPath);
			if (collision && !collision.deleted) {
				throw new Error(
					`cannot move: destination "${newPath}" already exists`,
				);
			}
		}
		await renameOne(src, to);
		let moved = 1;
		for (const d of descendants) {
			const newPath = `${to}/${d.path.slice(from.length + 1)}`;
			await renameOne(d, newPath);
			moved += 1;
		}
		await patchCreationFlag(ctx, args.creationPhaseId, "brainTouched");
		return { moved: true, nodesMoved: moved, kind: "folder" };
	},
});

export const brainRead = internalQuery({
	args: { agentId: v.id("agents"), path: v.string() },
	handler: async (
		ctx,
		{ agentId, path },
	): Promise<{
		content: string;
		year: number;
		kind: "file" | "folder";
	} | null> => {
		const f = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_path", (q) =>
				q.eq("agentId", agentId).eq("path", path),
			)
			.unique();
		if (!f || f.deleted) return null;
		return {
			content: f.content,
			year: f.lastUpdatedYear,
			kind: (f.kind ?? "file") as "file" | "folder",
		};
	},
});

export const brainLs = internalQuery({
	args: { agentId: v.id("agents"), path: v.optional(v.string()) },
	handler: async (
		ctx,
		{ agentId, path },
	): Promise<{
		path: string;
		exists: boolean;
		entries: Array<{
			name: string;
			path: string;
			kind: "file" | "folder";
			lastUpdatedYear: number;
			preview?: string;
		}>;
	}> => {
		const isRoot = path === undefined || path === "" || path === "/";
		const normalized = isRoot ? "" : (() => {
			const trimmed = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
			return trimmed;
		})();

		// Verify the directory exists (root always exists).
		let exists = isRoot;
		if (!isRoot) {
			const node = await ctx.db
				.query("brainFiles")
				.withIndex("by_agent_and_path", (q) =>
					q.eq("agentId", agentId).eq("path", normalized),
				)
				.unique();
			if (node && !node.deleted && (node.kind ?? "file") === "folder") {
				exists = true;
			}
		}

		const lower = isRoot ? "" : `${normalized}/`;
		const upper = isRoot ? "\u{10FFFF}" : `${normalized}0`;
		const rows = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_path", (q) =>
				q
					.eq("agentId", agentId)
					.gte("path", lower)
					.lt("path", upper),
			)
			.collect();

		const entries: Array<{
			name: string;
			path: string;
			kind: "file" | "folder";
			lastUpdatedYear: number;
			preview?: string;
		}> = [];
		for (const r of rows) {
			if (r.deleted) continue;
			const rel = isRoot ? r.path : r.path.slice(lower.length);
			if (rel === "" || rel.includes("/")) continue; // not an immediate child
			const kind = (r.kind ?? "file") as "file" | "folder";
			entries.push({
				name: rel,
				path: r.path,
				kind,
				lastUpdatedYear: r.lastUpdatedYear,
				preview:
					kind === "file"
						? r.content.slice(0, 160).replace(/\s+/g, " ")
						: undefined,
			});
		}
		entries.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

		return { path: isRoot ? "" : normalized, exists, entries };
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
