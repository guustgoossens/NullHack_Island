import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import { generateImage } from "../lib/images";
import { IMAGE_GEN_USD_PER_IMAGE } from "../lib/cost";

// Locked-POV redecoration. Wraps the agent's interior prompt with strong
// language telling the image model to keep the camera, walls, window, floor
// and ceiling identical to the reference image. Only what's *inside* the room
// is allowed to change.
function buildRedecoratePrompt(interior: string): string {
	return `Re-render this exact room with new interior design.

The viewpoint, walls, window, floor, ceiling, room dimensions, lighting direction, and crown molding MUST remain identical to the reference image. Do not move the camera. Do not change the architecture. Do not add or remove walls or windows. Do not crop, zoom, tilt, or pan.

What changes: only the *interior design* — furniture, objects, surfaces, art on the walls, decor, color treatments on existing surfaces, lighting fixtures, plants, what's on the floor.

The new interior is described as:

${interior.trim()}

Return a single photograph of the same room from the same viewpoint, redecorated.`;
}

async function loadStorageBytes(
	ctx: ActionCtx,
	storageId: string,
): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
	const blob = await ctx.storage.get(storageId as Id<"_storage">);
	if (!blob) return null;
	const bytes = await blob.arrayBuffer();
	return { bytes, mimeType: blob.type || "image/png" };
}

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
			// Starting room (year-0) has no reference — that image becomes the POV
			// anchor. Subsequent rooms reference the previous year's image directly
			// so each redecoration builds on the last visible state.
			const isStartingRoom = room.origin === "starting";
			let reference: { bytes: ArrayBuffer; mimeType: string } | null = null;
			if (!isStartingRoom && room.parentVersionId) {
				const parent = await ctx.runQuery(internal.tools.persist.getRoomVersion, {
					id: room.parentVersionId,
				});
				if (parent?.imageStorageId) {
					reference = await loadStorageBytes(ctx, parent.imageStorageId);
				}
			}

			const prompt =
				reference !== null
					? buildRedecoratePrompt(room.prompt)
					: room.prompt;

			const buf = await generateImage(prompt, {
				referenceImage: reference,
			});
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
