import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Returns all live brain files for an agent. The frontend builds the tree
 * from the slash-delimited paths.
 */
export const tree = query({
	args: { agentId: v.id("agents"), includeDeleted: v.optional(v.boolean()) },
	handler: async (ctx, { agentId, includeDeleted }) => {
		const all = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_path", (q) => q.eq("agentId", agentId))
			.take(1000);
		const live = includeDeleted ? all : all.filter((f) => !f.deleted);
		return live.map((f) => ({
			_id: f._id,
			path: f.path,
			kind: (f.kind ?? "file") as "file" | "folder",
			currentVersion: f.currentVersion,
			createdAtYear: f.createdAtYear,
			lastUpdatedYear: f.lastUpdatedYear,
			deleted: f.deleted,
		}));
	},
});

export const getFile = query({
	args: { agentId: v.id("agents"), path: v.string() },
	handler: async (ctx, { agentId, path }) => {
		return await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_path", (q) =>
				q.eq("agentId", agentId).eq("path", path),
			)
			.unique();
	},
});

export const fileHistory = query({
	args: { agentId: v.id("agents"), path: v.string() },
	handler: async (ctx, { agentId, path }) => {
		return await ctx.db
			.query("brainFileVersions")
			.withIndex("by_agent_and_path_and_version", (q) =>
				q.eq("agentId", agentId).eq("path", path),
			)
			.order("desc")
			.take(60);
	},
});
