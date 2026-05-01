import { v } from "convex/values";
import { query } from "./_generated/server";

async function withImageUrl<T extends { imageStorageId?: string | undefined }>(
	ctx: { storage: { getUrl: (id: string) => Promise<string | null> } },
	row: T,
): Promise<T & { imageUrl: string | null }> {
	const url = row.imageStorageId
		? await ctx.storage.getUrl(row.imageStorageId)
		: null;
	return { ...row, imageUrl: url };
}

export const current = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const rows = await ctx.db
			.query("roomVersions")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(1);
		const row = rows[0];
		if (!row) return null;
		return await withImageUrl(ctx, row);
	},
});

export const history = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const rows = await ctx.db
			.query("roomVersions")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(80);
		return await Promise.all(rows.map((r) => withImageUrl(ctx, r)));
	},
});
