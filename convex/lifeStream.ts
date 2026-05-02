import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";

// One reactive query that returns the agent's life as a year-by-year stream:
// per year, the room image, the visual inspirations consumed, and the works
// added to the portfolio. The home page binds to this so a visitor can see the
// whole trajectory in one scroll.
//
// Server-side decoration:
//   - room imageStorageId → URL
//   - inspiration image_search / pinterest_search payloads → first image URL
//   - portfolio blob / thumbnail → URL

export type Inspiration = {
	id: string;
	tool: string;
	query: string;
	url: string;
	pageUrl?: string;
};

export type StreamYear = {
	year: number;
	room: {
		_id: string;
		prompt: string;
		imageUrl: string | null;
		status: Doc<"roomVersions">["imageStatus"];
	} | null;
	inspirations: Inspiration[];
	artworks: Array<
		Doc<"portfolioItems"> & {
			blobUrl: string | null;
			thumbnailUrl: string | null;
		}
	>;
};

function pickInspirationUrl(item: Doc<"consumedItems">): {
	url: string;
	pageUrl?: string;
} | null {
	const payload = item.payload as Record<string, unknown> | null;
	if (!payload) return null;

	if (item.tool === "pinterest_search" || item.tool === "image_search") {
		const results = payload.results as unknown[] | undefined;
		if (!Array.isArray(results)) return null;
		for (const r of results) {
			if (!r || typeof r !== "object") continue;
			const rec = r as Record<string, unknown>;
			const img = rec.image_url ?? rec.thumbnail;
			if (typeof img === "string" && img.startsWith("http")) {
				const page =
					typeof rec.pin_url === "string"
						? rec.pin_url
						: typeof rec.page_url === "string"
							? rec.page_url
							: undefined;
				return { url: img, pageUrl: page };
			}
		}
	}
	return null;
}

async function decoratePortfolio(ctx: QueryCtx, items: Doc<"portfolioItems">[]) {
	return Promise.all(
		items.map(async (item) => {
			let blobUrl: string | null = null;
			if (item.payload.kind === "blob") {
				blobUrl = await ctx.storage.getUrl(item.payload.storageId);
			}
			let thumbnailUrl: string | null = null;
			if (item.thumbnailStorageId) {
				thumbnailUrl = await ctx.storage.getUrl(item.thumbnailStorageId);
			}
			return { ...item, blobUrl, thumbnailUrl };
		}),
	);
}

export const byAgent = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }): Promise<StreamYear[]> => {
		const [rooms, consumed, portfolio] = await Promise.all([
			ctx.db
				.query("roomVersions")
				.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
				.take(500),
			ctx.db
				.query("consumedItems")
				.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
				.take(2000),
			ctx.db
				.query("portfolioItems")
				.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
				.take(500),
		]);

		// Bucket by year.
		const yearSet = new Set<number>();
		for (const r of rooms) yearSet.add(r.year);
		for (const c of consumed) yearSet.add(c.year);
		for (const p of portfolio) yearSet.add(p.year);

		const roomByYear = new Map<number, Doc<"roomVersions">>();
		for (const r of rooms) {
			// Prefer the most recent room per year (creation rewrite over starting).
			const prev = roomByYear.get(r.year);
			if (!prev || r._creationTime > prev._creationTime) {
				roomByYear.set(r.year, r);
			}
		}

		const inspByYear = new Map<number, Inspiration[]>();
		for (const c of consumed) {
			const pick = pickInspirationUrl(c);
			if (!pick) continue;
			const arr = inspByYear.get(c.year) ?? [];
			arr.push({
				id: c._id,
				tool: c.tool,
				query: c.query,
				url: pick.url,
				pageUrl: pick.pageUrl,
			});
			inspByYear.set(c.year, arr);
		}

		const artByYear = new Map<number, Doc<"portfolioItems">[]>();
		for (const p of portfolio) {
			const arr = artByYear.get(p.year) ?? [];
			arr.push(p);
			artByYear.set(p.year, arr);
		}

		const years = Array.from(yearSet).sort((a, b) => b - a);
		const out: StreamYear[] = [];
		for (const year of years) {
			const room = roomByYear.get(year) ?? null;
			let roomDecorated: StreamYear["room"] = null;
			if (room) {
				const imageUrl = room.imageStorageId
					? await ctx.storage.getUrl(room.imageStorageId)
					: null;
				roomDecorated = {
					_id: room._id,
					prompt: room.prompt,
					imageUrl,
					status: room.imageStatus,
				};
			}
			const inspirations = (inspByYear.get(year) ?? []).slice(0, 18);
			const artworks = await decoratePortfolio(
				ctx,
				artByYear.get(year) ?? [],
			);
			out.push({ year, room: roomDecorated, inspirations, artworks });
		}
		return out;
	},
});
