// Plain async helpers for external API calls. Used by the dispatcher.
// `fetch` is available in the default Convex runtime — no "use node" needed.

const UA = "NullHackIsland/0.1 (artist agent simulation)";

export type ExternalResult = {
	summary: string;
	payload: unknown;
};

export async function wikipediaFetch(
	topic: string,
): Promise<ExternalResult> {
	// REST summary endpoint — short, clean, returns description + extract.
	const t = encodeURIComponent(topic.replace(/\s+/g, "_"));
	const r = await fetch(
		`https://en.wikipedia.org/api/rest_v1/page/summary/${t}`,
		{ headers: { "User-Agent": UA, Accept: "application/json" } },
	);
	if (!r.ok) {
		throw new Error(`wikipedia ${r.status}: ${await r.text()}`);
	}
	const j = (await r.json()) as {
		title?: string;
		description?: string;
		extract?: string;
		content_urls?: { desktop?: { page?: string } };
	};
	const summary = `Wikipedia: ${j.title ?? topic}${
		j.description ? ` (${j.description})` : ""
	}\n${j.extract ?? "(no extract)"}`;
	return {
		summary,
		payload: {
			title: j.title,
			description: j.description,
			extract: j.extract,
			url: j.content_urls?.desktop?.page,
		},
	};
}

export async function wikipediaRandom(): Promise<ExternalResult> {
	const r = await fetch(
		"https://en.wikipedia.org/api/rest_v1/page/random/summary",
		{ headers: { "User-Agent": UA, Accept: "application/json" } },
	);
	if (!r.ok) throw new Error(`wikipedia random ${r.status}`);
	const j = (await r.json()) as {
		title?: string;
		description?: string;
		extract?: string;
		content_urls?: { desktop?: { page?: string } };
	};
	const summary = `Random Wikipedia: ${j.title}${
		j.description ? ` (${j.description})` : ""
	}\n${j.extract ?? ""}`;
	return {
		summary,
		payload: {
			title: j.title,
			description: j.description,
			extract: j.extract,
			url: j.content_urls?.desktop?.page,
		},
	};
}

export async function poetryFetch(query: string): Promise<ExternalResult> {
	// PoetryDB — keyless. Try author OR title match. https://poetrydb.org/
	const r = await fetch(
		`https://poetrydb.org/title,author/${encodeURIComponent(query)}`,
		{ headers: { Accept: "application/json" } },
	);
	if (!r.ok) {
		// PoetryDB returns 404 for no match; treat as empty.
		return { summary: `No poems found for "${query}".`, payload: { poems: [] } };
	}
	const j = (await r.json()) as
		| { status: number; reason: string }
		| Array<{ title: string; author: string; lines: string[] }>;
	if (!Array.isArray(j)) {
		return { summary: `No poems found for "${query}".`, payload: { poems: [] } };
	}
	const top = j.slice(0, 3);
	const summary = top
		.map(
			(p) =>
				`"${p.title}" by ${p.author}\n${p.lines.slice(0, 12).join("\n")}${
					p.lines.length > 12 ? "\n..." : ""
				}`,
		)
		.join("\n\n");
	return { summary: summary || "(empty)", payload: { poems: top } };
}

export async function arxivFetch(query: string): Promise<ExternalResult> {
	// arXiv API — keyless XML. We extract <entry><title> + <summary>.
	const r = await fetch(
		`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
			query,
		)}&start=0&max_results=5`,
		{ headers: { "User-Agent": UA } },
	);
	if (!r.ok) throw new Error(`arxiv ${r.status}`);
	const xml = await r.text();
	const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(
		(m) => m[1],
	);
	const parsed = entries.slice(0, 5).map((e) => {
		const title = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1]?.trim() ?? "";
		const summary =
			/<summary>([\s\S]*?)<\/summary>/.exec(e)?.[1]?.trim() ?? "";
		const id = /<id>([\s\S]*?)<\/id>/.exec(e)?.[1]?.trim() ?? "";
		return { title, summary, id };
	});
	const summaryText = parsed
		.map((p) => `- ${p.title}\n  ${p.summary.slice(0, 240)}\n  ${p.id}`)
		.join("\n\n");
	return {
		summary: summaryText || "(no results)",
		payload: { results: parsed },
	};
}

export async function webFetch(url: string): Promise<ExternalResult> {
	// Naive fetch + crude HTML-to-text. Good enough for v0; replace with Playwright later.
	const r = await fetch(url, { headers: { "User-Agent": UA } });
	if (!r.ok) throw new Error(`fetch ${r.status} for ${url}`);
	const html = await r.text();
	const text = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const trimmed = text.slice(0, 6000);
	return {
		summary: `${url}\n${trimmed}${text.length > trimmed.length ? "…" : ""}`,
		payload: { url, text: trimmed },
	};
}

// -------- stubs (Playwright/Puppeteer-backed in a future iteration) --------

export async function webSearchStub(query: string): Promise<ExternalResult> {
	return {
		summary: `[stub] web_search("${query}") — wire up Playwright/SerpAPI here. Returning a placeholder so the agent loop runs end-to-end.`,
		payload: { stub: true, query },
	};
}

export async function imageSearchStub(query: string): Promise<ExternalResult> {
	return {
		summary: `[stub] image_search("${query}") — placeholder.`,
		payload: { stub: true, query },
	};
}

export async function pinterestSearchStub(
	query: string,
): Promise<ExternalResult> {
	return {
		summary: `[stub] pinterest_search("${query}") — placeholder.`,
		payload: { stub: true, query },
	};
}

export async function musicSearchStub(query: string): Promise<ExternalResult> {
	return {
		summary: `[stub] music_search("${query}") — placeholder. Wire up Spotify/Genius later.`,
		payload: { stub: true, query },
	};
}
