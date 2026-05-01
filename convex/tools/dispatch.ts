import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import {
	arxivFetch,
	type ExternalResult,
	imageSearch,
	musicSearch,
	pinterestSearch,
	poetryFetch,
	webFetch,
	webSearch,
	wikipediaFetch,
	wikipediaRandom,
} from "./external";
import type { Artifact } from "./registry";

export type DispatchResult = {
	toolResult: string;
	artifactsTouched: Artifact[];
	error?: string;
};

const phaseRefValidator = v.union(
	v.object({
		kind: v.literal("consumption"),
		id: v.id("consumptionPhases"),
	}),
	v.object({
		kind: v.literal("creation"),
		id: v.id("creationPhases"),
	}),
);

/**
 * Single entry point for all tool calls. The tick loop calls this for each
 * tool_use block; we route by name.
 *
 * For consume tools: hits external API, persists a consumedItem, returns a
 * formatted summary the LLM can read on the next turn.
 *
 * For create tools: persists the artifact, flips the matching contract flag
 * on the active creationPhase, returns a confirmation. Heavy mediums
 * (image gen) write a "pending" row immediately and schedule the render.
 */
export const dispatchTool = internalAction({
	args: {
		agentId: v.id("agents"),
		phaseRef: phaseRefValidator,
		year: v.number(),
		phaseInYear: v.number(),
		toolName: v.string(),
		toolArgs: v.any(),
	},
	handler: async (ctx, args): Promise<DispatchResult> => {
		try {
			return await runTool(ctx, args);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return {
				toolResult: `ERROR running ${args.toolName}: ${msg}`,
				artifactsTouched: [],
				error: msg,
			};
		}
	},
});

async function runTool(
	ctx: ActionCtx,
	args: {
		agentId: Id<"agents">;
		phaseRef:
			| { kind: "consumption"; id: Id<"consumptionPhases"> }
			| { kind: "creation"; id: Id<"creationPhases"> };
		year: number;
		phaseInYear: number;
		toolName: string;
		toolArgs: Record<string, unknown>;
	},
): Promise<DispatchResult> {
	const { toolName, toolArgs, agentId, phaseRef, year, phaseInYear } = args;

	// ---------------- CONSUME ----------------
	if (phaseRef.kind === "consumption") {
		const consumptionPhaseId = phaseRef.id;
		const persistConsumed = async (
			tool: string,
			query: string,
			res: ExternalResult,
		) => {
			const id: Id<"consumedItems"> = await ctx.runMutation(
				internal.tools.persist.persistConsumedItem,
				{
					agentId,
					consumptionPhaseId,
					year,
					phaseInYear,
					tool,
					query,
					summary: res.summary,
					payload: res.payload,
				},
			);
			return id;
		};

		switch (toolName) {
			case "wikipedia": {
				const topic = String(toolArgs.topic ?? "");
				const res = await wikipediaFetch(topic);
				const id = await persistConsumed("wikipedia", topic, res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "wikipedia_random": {
				const res = await wikipediaRandom();
				const id = await persistConsumed("wikipedia_random", "", res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "web_search": {
				const query = String(toolArgs.query ?? "");
				const res = await webSearch(query);
				const id = await persistConsumed("web_search", query, res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "web_fetch": {
				const url = String(toolArgs.url ?? "");
				const res = await webFetch(url);
				const id = await persistConsumed("web_fetch", url, res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "image_search": {
				const query = String(toolArgs.query ?? "");
				const res = await imageSearch(query);
				const id = await persistConsumed("image_search", query, res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "pinterest_search": {
				const query = String(toolArgs.query ?? "");
				const res = await pinterestSearch(query);
				const id = await persistConsumed("pinterest_search", query, res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "music_search": {
				const query = String(toolArgs.query ?? "");
				const res = await musicSearch(query);
				const id = await persistConsumed("music_search", query, res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "poetry_search": {
				const query = String(toolArgs.query ?? "");
				const res = await poetryFetch(query);
				const id = await persistConsumed("poetry_search", query, res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "arxiv_search": {
				const query = String(toolArgs.query ?? "");
				const res = await arxivFetch(query);
				const id = await persistConsumed("arxiv_search", query, res);
				return {
					toolResult: `[consumedItemId=${id}]\n${res.summary}`,
					artifactsTouched: [],
				};
			}
			case "brain_read": {
				const path = String(toolArgs.path ?? "");
				const file = await ctx.runQuery(
					internal.tools.persist.brainRead,
					{ agentId, path },
				);
				if (!file)
					return {
						toolResult: `Brain file "${path}" does not exist.`,
						artifactsTouched: [],
					};
				return {
					toolResult: `# ${path} (last touched year ${file.year})\n${file.content}`,
					artifactsTouched: [],
				};
			}
			default:
				return {
					toolResult: `Tool "${toolName}" is not available in a consumption phase.`,
					artifactsTouched: [],
					error: "tool_not_available_in_consumption",
				};
		}
	}

	// ---------------- CREATE ----------------
	const creationPhaseId = phaseRef.id;

	switch (toolName) {
		case "brain_read": {
			const path = String(toolArgs.path ?? "");
			const file = await ctx.runQuery(internal.tools.persist.brainRead, {
				agentId,
				path,
			});
			if (!file)
				return {
					toolResult: `Brain file "${path}" does not exist.`,
					artifactsTouched: [],
				};
			return {
				toolResult: `# ${path} (last touched year ${file.year})\n${file.content}`,
				artifactsTouched: [],
			};
		}
		case "brain_write": {
			const path = String(toolArgs.path ?? "");
			const content = String(toolArgs.content ?? "");
			const r = await ctx.runMutation(internal.tools.persist.brainWrite, {
				agentId,
				creationPhaseId,
				year,
				path,
				content,
			});
			return {
				toolResult: `Brain ${r.created ? "created" : "updated"}: ${path} (v${r.version}).`,
				artifactsTouched: ["brain"],
			};
		}
		case "brain_delete": {
			const path = String(toolArgs.path ?? "");
			const ok = await ctx.runMutation(internal.tools.persist.brainDelete, {
				agentId,
				creationPhaseId,
				year,
				path,
			});
			return {
				toolResult: ok
					? `Brain deleted: ${path}.`
					: `Brain file "${path}" did not exist.`,
				artifactsTouched: ok ? ["brain"] : [],
			};
		}
		case "room_rewrite": {
			const prompt = String(toolArgs.prompt ?? "");
			const roomVersionId: Id<"roomVersions"> = await ctx.runMutation(
				internal.tools.persist.insertRoomVersion,
				{
					agentId,
					creationPhaseId,
					year,
					prompt,
					origin: "rewrite",
				},
			);
			await ctx.scheduler.runAfter(
				0,
				internal.tools.render.renderRoomImage,
				{ roomVersionId },
			);
			return {
				toolResult: `Room prompt rewritten. Image generation queued (will appear shortly).`,
				artifactsTouched: ["room"],
			};
		}
		case "portfolio_curate": {
			const consumedItemIdRaw = String(toolArgs.consumedItemId ?? "");
			const title = String(toolArgs.title ?? "untitled");
			const caption = String(toolArgs.caption ?? "");
			// Optional: which result inside the consumed item to pin. Defaults
			// to the first usable image. The agent rarely supplies this; the
			// summary it gets back lists items in order, so index 0 ≈ "the one
			// I named first in my reflection."
			const resultIndexRaw = toolArgs.resultIndex;
			const consumedItemId = consumedItemIdRaw as Id<"consumedItems">;
			const item = await ctx.runQuery(
				internal.tools.persist.getConsumedItem,
				{ id: consumedItemId },
			);
			if (!item) {
				return {
					toolResult: `consumedItemId "${consumedItemIdRaw}" not found.`,
					artifactsTouched: [],
					error: "not_found",
				};
			}
			const medium = mediumForTool(item.tool);
			const idx = Number.isFinite(Number(resultIndexRaw))
				? Math.max(0, Math.floor(Number(resultIndexRaw)))
				: 0;
			const payload = curatedPayload(item, idx);
			const id: Id<"portfolioItems"> = await ctx.runMutation(
				internal.tools.persist.insertPortfolioItem,
				{
					agentId,
					creationPhaseId,
					year,
					kind: "curated",
					medium,
					title,
					caption,
					payload,
					citedConsumedItemIds: [consumedItemId],
					status: "ready",
				},
			);
			return {
				toolResult:
					payload.kind === "external" && payload.url.startsWith("convex://")
						? `Curated ${item.tool} item "${item.query}" into portfolio (id=${id}).`
						: `Curated ${item.tool} item "${item.query}" into portfolio with direct media link (id=${id}).`,
				artifactsTouched: ["portfolio"],
			};
		}
		case "portfolio_create_image": {
			const prompt = String(toolArgs.prompt ?? "");
			const title = String(toolArgs.title ?? "untitled");
			const caption = String(toolArgs.caption ?? "");
			// Pending row first; render finalises the payload via setPortfolioBlob.
			const id: Id<"portfolioItems"> = await ctx.runMutation(
				internal.tools.persist.insertPortfolioItem,
				{
					agentId,
					creationPhaseId,
					year,
					kind: "created",
					medium: "image",
					title,
					caption,
					payload: {
						kind: "external",
						url: "pending://image",
						sourceTool: "portfolio_create_image",
					},
					citedConsumedItemIds: [],
					status: "pending",
				},
			);
			await ctx.scheduler.runAfter(
				0,
				internal.tools.render.renderPortfolioImage,
				{ portfolioItemId: id, prompt },
			);
			return {
				toolResult: `Image queued for portfolio: "${title}". (id=${id})`,
				artifactsTouched: ["portfolio"],
			};
		}
		case "portfolio_create_ascii":
		case "portfolio_create_poem": {
			const title = String(toolArgs.title ?? "untitled");
			const text = String(toolArgs.text ?? "");
			const caption = String(toolArgs.caption ?? "");
			const medium = toolName === "portfolio_create_poem" ? "poem" : "ascii";
			const id: Id<"portfolioItems"> = await ctx.runMutation(
				internal.tools.persist.insertPortfolioItem,
				{
					agentId,
					creationPhaseId,
					year,
					kind: "created",
					medium,
					title,
					caption,
					payload: { kind: "text", text },
					citedConsumedItemIds: [],
					status: "ready",
				},
			);
			return {
				toolResult: `Added ${medium} to portfolio: "${title}". (id=${id})`,
				artifactsTouched: ["portfolio"],
			};
		}
		case "portfolio_create_writing": {
			const title = String(toolArgs.title ?? "untitled");
			const markdown = String(toolArgs.markdown ?? "");
			const caption = String(toolArgs.caption ?? "");
			const id: Id<"portfolioItems"> = await ctx.runMutation(
				internal.tools.persist.insertPortfolioItem,
				{
					agentId,
					creationPhaseId,
					year,
					kind: "created",
					medium: "writing",
					title,
					caption,
					payload: { kind: "text", text: markdown },
					citedConsumedItemIds: [],
					status: "ready",
				},
			);
			return {
				toolResult: `Added writing to portfolio: "${title}". (id=${id})`,
				artifactsTouched: ["portfolio"],
			};
		}
		case "portfolio_create_html": {
			const title = String(toolArgs.title ?? "untitled");
			const html = String(toolArgs.html ?? "");
			const caption = String(toolArgs.caption ?? "");
			const id: Id<"portfolioItems"> = await ctx.runMutation(
				internal.tools.persist.insertPortfolioItem,
				{
					agentId,
					creationPhaseId,
					year,
					kind: "created",
					medium: "html",
					title,
					caption,
					payload: { kind: "html", html },
					citedConsumedItemIds: [],
					status: "ready", // sandboxed screenshot rendering is a v2 stub
				},
			);
			return {
				toolResult: `Added HTML artwork to portfolio: "${title}". (id=${id}, no thumbnail yet — sandbox renderer not wired up.)`,
				artifactsTouched: ["portfolio"],
			};
		}
		case "portfolio_create_threejs": {
			const title = String(toolArgs.title ?? "untitled");
			const code = String(toolArgs.code ?? "");
			const caption = String(toolArgs.caption ?? "");
			const id: Id<"portfolioItems"> = await ctx.runMutation(
				internal.tools.persist.insertPortfolioItem,
				{
					agentId,
					creationPhaseId,
					year,
					kind: "created",
					medium: "threejs",
					title,
					caption,
					payload: { kind: "threejs", code },
					citedConsumedItemIds: [],
					status: "ready",
				},
			);
			return {
				toolResult: `Added Three.js scene to portfolio: "${title}". (id=${id}, no thumbnail yet.)`,
				artifactsTouched: ["portfolio"],
			};
		}
		case "portfolio_create_manim": {
			const title = String(toolArgs.title ?? "untitled");
			const code = String(toolArgs.code ?? "");
			const caption = String(toolArgs.caption ?? "");
			// Manim renderer is a v2 stub; we still record the source so the
			// portfolio shows the artifact existed and the contract is satisfied.
			const id: Id<"portfolioItems"> = await ctx.runMutation(
				internal.tools.persist.insertPortfolioItem,
				{
					agentId,
					creationPhaseId,
					year,
					kind: "created",
					medium: "manim",
					title,
					caption,
					payload: { kind: "text", text: code },
					citedConsumedItemIds: [],
					status: "pending",
				},
			);
			return {
				toolResult: `Manim source recorded (id=${id}). Render pipeline not wired yet — code is saved.`,
				artifactsTouched: ["portfolio"],
			};
		}
		default:
			return {
				toolResult: `Tool "${toolName}" is not available in a creation phase.`,
				artifactsTouched: [],
				error: "tool_not_available_in_creation",
			};
	}
}

function mediumForTool(
	tool: string,
):
	| "found_image"
	| "found_music"
	| "found_text" {
	if (tool === "image_search" || tool === "pinterest_search") return "found_image";
	if (tool === "music_search") return "found_music";
	return "found_text";
}

function stringifyConsumedRef(id: Id<"consumedItems">): string {
	return `convex://consumedItem/${id}`;
}

type PortfolioPayload =
	| {
			kind: "external";
			url: string;
			sourceTool: string;
	  }
	| {
			kind: "text";
			text: string;
	  };

/**
 * Build a portfolio payload from a consumed item. For Pinterest / image search
 * we surface the actual image URL so the gallery shows the pin inline; for
 * everything else we fall back to a convex:// reference the UI can resolve.
 */
function curatedPayload(
	item: {
		tool: string;
		summary: string;
		payload: unknown;
		_id: Id<"consumedItems">;
	},
	resultIndex: number,
): PortfolioPayload {
	if (item.tool === "pinterest_search") {
		const url = pickPinterestUrl(item.payload, resultIndex);
		if (url) {
			return { kind: "external", url, sourceTool: "pinterest_search" };
		}
	}
	if (item.tool === "image_search") {
		const url = pickImageSearchUrl(item.payload, resultIndex);
		if (url) {
			return { kind: "external", url, sourceTool: "image_search" };
		}
	}
	if (item.tool === "web_fetch" || item.tool === "wikipedia") {
		const url = pickPageUrl(item.payload);
		if (url) {
			return { kind: "external", url, sourceTool: item.tool };
		}
	}
	return {
		kind: "external",
		url: stringifyConsumedRef(item._id),
		sourceTool: item.tool,
	};
}

function pickPinterestUrl(payload: unknown, idx: number): string | null {
	const results = (payload as { results?: unknown[] } | null)?.results;
	if (!Array.isArray(results) || results.length === 0) return null;
	const r = results[Math.min(idx, results.length - 1)] as
		| { image_url?: unknown; pin_url?: unknown }
		| null;
	if (typeof r?.image_url === "string" && r.image_url.startsWith("http")) {
		return r.image_url;
	}
	if (typeof r?.pin_url === "string" && r.pin_url.startsWith("http")) {
		return r.pin_url;
	}
	return null;
}

function pickImageSearchUrl(payload: unknown, idx: number): string | null {
	const results = (payload as { results?: unknown[] } | null)?.results;
	if (!Array.isArray(results) || results.length === 0) return null;
	const r = results[Math.min(idx, results.length - 1)] as
		| { image_url?: unknown; thumbnail?: unknown; page_url?: unknown }
		| null;
	if (typeof r?.image_url === "string" && r.image_url.startsWith("http")) {
		return r.image_url;
	}
	if (typeof r?.thumbnail === "string" && r.thumbnail.startsWith("http")) {
		return r.thumbnail;
	}
	if (typeof r?.page_url === "string" && r.page_url.startsWith("http")) {
		return r.page_url;
	}
	return null;
}

function pickPageUrl(payload: unknown): string | null {
	const url = (payload as { url?: unknown } | null)?.url;
	if (typeof url === "string" && url.startsWith("http")) return url;
	return null;
}
