import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { generateImage } from "../lib/images";
import { IMAGE_GEN_USD_PER_IMAGE } from "../lib/cost";

/** Generate an image for a roomVersion row. Idempotent: only acts on pending rows. */
export const renderRoomImage = internalAction({
	args: { roomVersionId: v.id("roomVersions") },
	handler: async (ctx, { roomVersionId }) => {
		const room = await ctx.runQuery(internal.tools.persist.getRoomVersion, {
			id: roomVersionId,
		});
		if (!room) return;
		if (room.imageStatus !== "pending") return;
		try {
			const buf = await generateImage(room.prompt);
			const blob = new Blob([buf], { type: "image/png" });
			const storageId = await ctx.storage.store(blob);
			await ctx.runMutation(internal.tools.persist.setRoomImage, {
				roomVersionId,
				imageStorageId: storageId,
			});
			await ctx.runMutation(internal.tools.persist.addAgentCost, {
				agentId: room.agentId,
				deltaUsd: IMAGE_GEN_USD_PER_IMAGE,
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await ctx.runMutation(internal.tools.persist.setRoomFailed, {
				roomVersionId,
				error: msg,
			});
		}
	},
});

export const renderPortfolioImage = internalAction({
	args: {
		portfolioItemId: v.id("portfolioItems"),
		prompt: v.string(),
	},
	handler: async (ctx, { portfolioItemId, prompt }) => {
		const item = await ctx.runQuery(internal.tools.persist.getPortfolioItem, {
			id: portfolioItemId,
		});
		if (!item) return;
		if (item.status !== "pending") return;
		try {
			const buf = await generateImage(prompt);
			const blob = new Blob([buf], { type: "image/png" });
			const storageId = await ctx.storage.store(blob);
			await ctx.runMutation(internal.tools.persist.setPortfolioBlob, {
				portfolioItemId,
				storageId,
				mimeType: "image/png",
			});
			await ctx.runMutation(internal.tools.persist.addAgentCost, {
				agentId: item.agentId,
				deltaUsd: IMAGE_GEN_USD_PER_IMAGE,
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await ctx.runMutation(internal.tools.persist.setPortfolioFailed, {
				portfolioItemId,
				error: msg,
			});
		}
	},
});
