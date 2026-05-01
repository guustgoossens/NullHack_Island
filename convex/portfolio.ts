import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";

async function decoratePortfolioItem(
	ctx: QueryCtx,
	item: Doc<"portfolioItems">,
) {
	let blobUrl: string | null = null;
	if (item.payload.kind === "blob") {
		blobUrl = await ctx.storage.getUrl(item.payload.storageId);
	}
	let thumbnailUrl: string | null = null;
	if (item.thumbnailStorageId) {
		thumbnailUrl = await ctx.storage.getUrl(item.thumbnailStorageId);
	}
	return { ...item, blobUrl, thumbnailUrl };
}

export const list = query({
	args: {
		agentId: v.id("agents"),
		medium: v.optional(v.string()),
	},
	handler: async (ctx, { agentId, medium }) => {
		const rows = medium
			? await ctx.db
					.query("portfolioItems")
					.withIndex("by_agent_and_medium", (q) =>
						q.eq("agentId", agentId).eq("medium", medium as Doc<"portfolioItems">["medium"]),
					)
					.order("desc")
					.take(200)
			: await ctx.db
					.query("portfolioItems")
					.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
					.order("desc")
					.take(200);
		return await Promise.all(rows.map((r) => decoratePortfolioItem(ctx, r)));
	},
});

export const getItem = query({
	args: { id: v.id("portfolioItems") },
	handler: async (ctx, { id }) => {
		const item = await ctx.db.get(id);
		if (!item) return null;
		return await decoratePortfolioItem(ctx, item);
	},
});
