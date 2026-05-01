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

// Pinterest doesn't expose a public guest API. We hit the same internal JSON
// resource the website's React app uses. The flow:
//   1) GET /search/pins/?q=… to seed cookies (csrftoken, _pinterest_sess, _auth,
//      _routing_id) and scrape the live `appVersion` from the HTML payload.
//   2) GET /resource/BaseSearchResource/get/?source_url=…&data=… with the
//      cookies replayed and the version-pinned headers Pinterest enforces
//      (X-APP-VERSION, X-Pinterest-PWS-Handler, X-CSRFToken, …).
// If Pinterest changes any of these the call 403s — that's the failure mode
// to watch for if this stops working.

const PINTEREST_BASE = "https://www.pinterest.com";
const PINTEREST_DEFAULT_APP_VERSION = "2142b55";
const PINTEREST_BROWSER_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

type PinterestImage = { url: string; width?: number; height?: number };
type PinterestPin = {
	id?: string;
	title?: string;
	grid_title?: string;
	description?: string;
	auto_alt_text?: string;
	alt_text?: string;
	dominant_color?: string;
	images?: Record<string, PinterestImage>;
};

type NormalizedPin = {
	id: string | undefined;
	title: string;
	description: string;
	altText: string;
	imageUrl: string;
	width: number | undefined;
	height: number | undefined;
	pinUrl: string | undefined;
	dominantColor: string | undefined;
};

function pinterestExtractCookies(res: Response): string {
	// Standard fetch: getSetCookie() gives every Set-Cookie header (Node 20+/V8).
	const all =
		typeof (res.headers as unknown as { getSetCookie?: () => string[] })
			.getSetCookie === "function"
			? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
			: (res.headers.get("set-cookie") ?? "").split(/,(?=[^ ;]+=)/);
	const jar: Record<string, string> = {};
	for (const raw of all) {
		const first = raw.split(";")[0]?.trim();
		if (!first) continue;
		const eq = first.indexOf("=");
		if (eq <= 0) continue;
		jar[first.slice(0, eq)] = first.slice(eq + 1);
	}
	return Object.entries(jar)
		.map(([k, v]) => `${k}=${v}`)
		.join("; ");
}

function pinterestBestImage(
	images: Record<string, PinterestImage> | undefined,
): PinterestImage | undefined {
	if (!images) return undefined;
	for (const key of ["orig", "736x", "564x", "474x", "236x"]) {
		const img = images[key];
		if (img?.url) return img;
	}
	return undefined;
}

function pinterestNormalize(pin: PinterestPin): NormalizedPin | null {
	const img = pinterestBestImage(pin.images);
	if (!img) return null;
	return {
		id: pin.id,
		title: (pin.title ?? pin.grid_title ?? "").trim(),
		description: (pin.description ?? "").trim(),
		altText: pin.auto_alt_text ?? pin.alt_text ?? "",
		imageUrl: img.url,
		width: img.width,
		height: img.height,
		pinUrl: pin.id ? `${PINTEREST_BASE}/pin/${pin.id}/` : undefined,
		dominantColor: pin.dominant_color,
	};
}

export async function pinterestSearch(
	query: string,
	limit = 10,
): Promise<ExternalResult> {
	const trimmed = query.trim();
	if (!trimmed) {
		return { summary: "(empty pinterest query)", payload: { results: [] } };
	}

	const referer = `${PINTEREST_BASE}/search/pins/?q=${encodeURIComponent(trimmed)}`;

	// 1) Warm up: cookies + appVersion.
	const warmup = await fetch(referer, {
		headers: {
			"User-Agent": PINTEREST_BROWSER_UA,
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "en-US,en;q=0.9",
		},
	});
	if (!warmup.ok) {
		throw new Error(`pinterest warmup ${warmup.status}`);
	}
	const cookieHeader = pinterestExtractCookies(warmup);
	const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(cookieHeader)?.[1] ?? "";
	const html = await warmup.text();
	const appVersion =
		/"appVersion"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? PINTEREST_DEFAULT_APP_VERSION;

	// 2) Paginate the resource endpoint until we have `limit` usable pins.
	const collected: NormalizedPin[] = [];
	let bookmark: string | undefined;
	for (let page = 0; page < 5 && collected.length < limit; page++) {
		const options: Record<string, unknown> = {
			query: trimmed,
			scope: "pins",
			page_size: 25,
			auto_correction_disabled: false,
			filters: "",
			top_pin_id: "",
			appliedProductFilters: "---",
			article: "",
		};
		if (bookmark) options.bookmarks = [bookmark];
		const params = new URLSearchParams({
			source_url: `/search/pins/?q=${encodeURIComponent(trimmed)}`,
			data: JSON.stringify({ options, context: {} }),
		});

		const res = await fetch(
			`${PINTEREST_BASE}/resource/BaseSearchResource/get/?${params.toString()}`,
			{
				headers: {
					"User-Agent": PINTEREST_BROWSER_UA,
					Accept: "application/json, text/javascript, */*; q=0.01",
					"Accept-Language": "en-US,en;q=0.9",
					Referer: referer,
					"X-Requested-With": "XMLHttpRequest",
					"X-APP-VERSION": appVersion,
					"X-Pinterest-AppState": "active",
					"X-Pinterest-Source-Url": `/search/pins/?q=${encodeURIComponent(trimmed)}`,
					"X-Pinterest-PWS-Handler": "www/search/[scope].js",
					"X-CSRFToken": csrf,
					"Screen-Dpr": "2",
					Cookie: cookieHeader,
				},
			},
		);
		if (!res.ok) {
			throw new Error(`pinterest resource ${res.status}: ${await res.text()}`);
		}
		const j = (await res.json()) as {
			resource_response?: {
				data?: { results?: PinterestPin[]; bookmark?: string };
			};
			resource?: { options?: { bookmarks?: string[] } };
		};
		const data = j.resource_response?.data ?? {};
		for (const pin of data.results ?? []) {
			const n = pinterestNormalize(pin);
			if (n) collected.push(n);
			if (collected.length >= limit) break;
		}
		const next =
			data.bookmark ?? j.resource?.options?.bookmarks?.[0] ?? undefined;
		if (!next || next === "-end-" || next === bookmark) break;
		bookmark = next;
	}

	const top = collected.slice(0, limit);
	const summary = top.length
		? `pinterest_search("${trimmed}") — ${top.length} pins\n` +
			top
				.map(
					(p, i) =>
						`${i + 1}. ${p.title || p.altText || "(untitled)"}\n   ${p.imageUrl}`,
				)
				.join("\n")
		: `pinterest_search("${trimmed}") — no results`;

	return {
		summary,
		payload: { query: trimmed, count: top.length, results: top },
	};
}

export async function musicSearchStub(query: string): Promise<ExternalResult> {
	return {
		summary: `[stub] music_search("${query}") — placeholder. Wire up Spotify/Genius later.`,
		payload: { stub: true, query },
	};
}
