// Plain async helpers for external API calls. Used by the dispatcher.
// `fetch` is available in the default Convex runtime — no "use node" needed.
//
// Required env vars: none. Every endpoint used here is keyless:
//   - Wikipedia REST API (wikipediaFetch / wikipediaRandom)
//   - PoetryDB (poetryFetch)
//   - arXiv API (arxivFetch)
//   - DuckDuckGo HTML (webSearch)
//   - Openverse API (imageSearch)
//   - Pinterest BaseSearchResource (pinterestSearch — mimics a browser session)
//   - iTunes Search + lyrics.ovh (musicSearch)
//
// All functions return { summary, payload } and prefer soft transient
// messages over thrown errors so the agent can continue and try again.

const UA = "NullHackIsland/0.1 (artist agent simulation)";

// Pinterest, DDG HTML, etc. reject API-style UAs. We mimic a real browser.
const BROWSER_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const PINTEREST_DEFAULT_APP_VERSION = "2142b55";

const FETCH_TIMEOUT_MS = 15_000;
const SUMMARY_MAX = 3800;

export type ExternalResult = {
	summary: string;
	payload: unknown;
};

async function timedFetch(
	url: string,
	init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
	const ctl = new AbortController();
	const t = setTimeout(
		() => ctl.abort(),
		init?.timeoutMs ?? FETCH_TIMEOUT_MS,
	);
	try {
		return await fetch(url, { ...init, signal: ctl.signal });
	} finally {
		clearTimeout(t);
	}
}

function transient(
	tool: string,
	query: string,
	detail: string,
): ExternalResult {
	return {
		summary: `[transient] ${tool}("${query}") ${detail} — try again next phase`,
		payload: { transient: true, tool, query, detail },
	};
}

function clip(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}

function stripHtml(s: string): string {
	return s
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// -------- Wikipedia / arXiv / Poetry / web_fetch --------

export async function wikipediaFetch(topic: string): Promise<ExternalResult> {
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
	// PoetryDB — keyless. The /title,author/{q} endpoint requires the query to
	// match BOTH fields, which silently returns nothing for plain author or
	// title lookups. Try author, then title, then the combined endpoint.
	const q = encodeURIComponent(query);
	const endpoints = [
		`https://poetrydb.org/author/${q}`,
		`https://poetrydb.org/title/${q}`,
		`https://poetrydb.org/title,author/${q}`,
	];
	let poems: Array<{ title: string; author: string; lines: string[] }> = [];
	for (const url of endpoints) {
		let r: Response;
		try {
			r = await timedFetch(url, { headers: { Accept: "application/json" } });
		} catch {
			continue;
		}
		if (!r.ok) continue;
		let j: unknown;
		try {
			j = await r.json();
		} catch {
			continue;
		}
		if (Array.isArray(j) && j.length > 0) {
			poems = j as typeof poems;
			break;
		}
	}
	if (poems.length === 0) {
		return { summary: `No poems found for "${query}".`, payload: { poems: [] } };
	}
	const top = poems.slice(0, 3);
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
	// arXiv 503s under load are routine; surface as transient (matching the
	// other network tools) so the agent doesn't read it as a hard failure.
	let r: Response;
	try {
		r = await timedFetch(
			`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
				query,
			)}&start=0&max_results=5`,
			{ headers: { "User-Agent": UA } },
		);
	} catch (e) {
		return transient(
			"arxiv_search",
			query,
			`network error: ${(e as Error).message}`,
		);
	}
	if (!r.ok) return transient("arxiv_search", query, `HTTP ${r.status}`);
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

// -------- web_search via DuckDuckGo HTML --------

type WebResult = { title: string; url: string; snippet: string };

export async function webSearch(query: string): Promise<ExternalResult> {
	if (!query.trim()) {
		return {
			summary: "Empty search query.",
			payload: { query, results: [] },
		};
	}
	let r: Response;
	try {
		r = await timedFetch(
			`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
			{
				headers: {
					"User-Agent": BROWSER_UA,
					Accept: "text/html,application/xhtml+xml",
					"Accept-Language": "en-US,en;q=0.9",
				},
			},
		);
	} catch (e) {
		return transient(
			"web_search",
			query,
			`network error: ${(e as Error).message}`,
		);
	}
	if (!r.ok) {
		return transient("web_search", query, `HTTP ${r.status}`);
	}
	const html = await r.text();
	const results = parseDdgResults(html, 8);
	if (results.length === 0) {
		return {
			summary: `No web results for "${query}".`,
			payload: { query, results: [] },
		};
	}
	const summary = clip(
		`Web search: "${query}" (${results.length} results)\n${results
			.map(
				(r, i) =>
					`${i + 1}. ${r.title}\n   ${r.url}\n   ${clip(r.snippet, 220)}`,
			)
			.join("\n")}`,
		SUMMARY_MAX,
	);
	return { summary, payload: { query, results } };
}

function parseDdgResults(html: string, max: number): WebResult[] {
	const out: WebResult[] = [];
	const re =
		/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
	let m: RegExpExecArray | null = re.exec(html);
	while (m !== null && out.length < max) {
		const url = decodeDdgRedirect(m[1]);
		const title = stripHtml(m[2]);
		const snippet = stripHtml(m[3]);
		if (url && title) out.push({ title, url, snippet });
		m = re.exec(html);
	}
	return out;
}

function decodeDdgRedirect(href: string): string {
	const m = /[?&]uddg=([^&]+)/.exec(href);
	if (m) {
		try {
			return decodeURIComponent(m[1]);
		} catch {
			return m[1];
		}
	}
	if (href.startsWith("//")) return `https:${href}`;
	return href;
}

// -------- image_search via Openverse --------

type ImageResult = {
	id?: string;
	title: string;
	creator: string;
	source: string;
	license: string;
	image_url: string;
	thumbnail: string;
	page_url: string;
	width?: number;
	height?: number;
	tags: string[];
};

export async function imageSearch(query: string): Promise<ExternalResult> {
	if (!query.trim()) {
		return {
			summary: "Empty image query.",
			payload: { query, results: [] },
		};
	}

	// Openverse has a smaller, CC-licensed corpus than open web image search and
	// will return 0 hits on long descriptive queries. We try the full query
	// first, then fall back to the first 3 keywords to widen the net.
	const tries: string[] = [query];
	const words = query.split(/\s+/).filter(Boolean);
	if (words.length > 3) tries.push(words.slice(0, 3).join(" "));

	let items: ImageResult[] = [];
	let usedQuery = query;
	for (const q of tries) {
		const res = await openverseQuery(q);
		if (res.kind === "transient") return res.value;
		items = res.items;
		usedQuery = q;
		if (items.length > 0) break;
	}

	if (items.length === 0) {
		return {
			summary: `No images found for "${query}".`,
			payload: { query, results: [] },
		};
	}

	const heading =
		usedQuery === query
			? `Image search: "${query}" (${items.length} images)`
			: `Image search: "${query}" → broadened to "${usedQuery}" (${items.length} images)`;
	const summary = clip(
		`${heading}\n${items
			.map(
				(it, i) =>
					`${i + 1}. ${it.title || "(untitled)"} — ${it.creator || "?"}\n   src: ${it.source}${it.license ? ` (${it.license})` : ""}\n   img: ${it.image_url}${it.tags.length ? `\n   tags: ${it.tags.join(", ")}` : ""}`,
			)
			.join("\n")}`,
		SUMMARY_MAX,
	);
	return {
		summary,
		payload: { query, used_query: usedQuery, results: items },
	};
}

type OpenverseAttempt =
	| { kind: "ok"; items: ImageResult[] }
	| { kind: "transient"; value: ExternalResult };

async function openverseQuery(query: string): Promise<OpenverseAttempt> {
	let r: Response;
	try {
		r = await timedFetch(
			`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=10`,
			{ headers: { "User-Agent": UA, Accept: "application/json" } },
		);
	} catch (e) {
		return {
			kind: "transient",
			value: transient(
				"image_search",
				query,
				`network error: ${(e as Error).message}`,
			),
		};
	}
	if (!r.ok) {
		return {
			kind: "transient",
			value: transient("image_search", query, `HTTP ${r.status}`),
		};
	}
	let j: {
		results?: Array<{
			id?: string;
			title?: string;
			creator?: string;
			source?: string;
			license?: string;
			tags?: Array<{ name: string }>;
			url?: string;
			thumbnail?: string;
			foreign_landing_url?: string;
			width?: number;
			height?: number;
		}>;
	};
	try {
		j = (await r.json()) as typeof j;
	} catch {
		return {
			kind: "transient",
			value: transient("image_search", query, "openverse returned non-JSON"),
		};
	}
	const items: ImageResult[] = (j.results ?? []).slice(0, 10).map((it) => ({
		id: it.id,
		title: it.title ?? "",
		creator: it.creator ?? "",
		source: it.source ?? "",
		license: it.license ?? "",
		image_url: it.url ?? "",
		thumbnail: it.thumbnail ?? "",
		page_url: it.foreign_landing_url ?? "",
		width: it.width,
		height: it.height,
		tags: (it.tags ?? []).map((t) => t.name).slice(0, 8),
	}));
	return { kind: "ok", items };
}

// -------- pinterest_search via BaseSearchResource (mimics a browser) --------
// Ported from scrapers/pinterest/pinterest_search.py — Pinterest has no public
// API and aggressive anti-bot, so we warm a session, scrape the appVersion +
// CSRF cookie out of the search page, then call their internal resource.

type PinResult = {
	id: string | null;
	title: string;
	description: string;
	alt_text: string;
	image_url: string;
	width: number | null;
	height: number | null;
	pin_url: string | null;
	dominant_color: string | null;
};

export async function pinterestSearch(
	query: string,
): Promise<ExternalResult> {
	if (!query.trim()) {
		return {
			summary: "Empty Pinterest query.",
			payload: { query, results: [] },
		};
	}

	const referer = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;

	let warmup: Response;
	try {
		warmup = await timedFetch(referer, {
			headers: {
				"User-Agent": BROWSER_UA,
				Accept: "text/html,application/xhtml+xml",
				"Accept-Language": "en-US,en;q=0.9",
			},
		});
	} catch (e) {
		return transient(
			"pinterest_search",
			query,
			`warmup error: ${(e as Error).message}`,
		);
	}
	if (!warmup.ok) {
		return transient(
			"pinterest_search",
			query,
			`warmup HTTP ${warmup.status}`,
		);
	}
	const warmupHtml = await warmup.text();
	const appVersion =
		/"appVersion"\s*:\s*"([^"]+)"/.exec(warmupHtml)?.[1] ??
		PINTEREST_DEFAULT_APP_VERSION;
	const cookieJar = parseSetCookies(warmup.headers);
	const csrf = cookieJar.get("csrftoken") ?? "";
	const cookieHeader = [...cookieJar.entries()]
		.map(([k, v]) => `${k}=${v}`)
		.join("; ");

	const limit = 12;
	const collected: PinResult[] = [];
	let bookmark: string | null = null;
	for (let page = 0; page < 3 && collected.length < limit; page++) {
		const options: Record<string, unknown> = {
			query,
			scope: "pins",
			page_size: 25,
			auto_correction_disabled: false,
			filters: "",
			top_pin_id: "",
			appliedProductFilters: "---",
			article: "",
		};
		if (bookmark) options.bookmarks = [bookmark];
		const data = JSON.stringify({ options, context: {} });
		const params = new URLSearchParams({
			source_url: `/search/pins/?q=${query}`,
			data,
		});

		let r: Response;
		try {
			r = await timedFetch(
				`https://www.pinterest.com/resource/BaseSearchResource/get/?${params.toString()}`,
				{
					headers: {
						"User-Agent": BROWSER_UA,
						Accept: "application/json, text/javascript, */*; q=0.01",
						"Accept-Language": "en-US,en;q=0.9",
						Referer: referer,
						"X-Requested-With": "XMLHttpRequest",
						"X-APP-VERSION": appVersion,
						"X-Pinterest-AppState": "active",
						"X-Pinterest-Source-Url": `/search/pins/?q=${encodeURIComponent(query)}`,
						"X-Pinterest-PWS-Handler": "www/search/[scope].js",
						"X-CSRFToken": csrf,
						"Screen-Dpr": "2",
						Cookie: cookieHeader,
					},
				},
			);
		} catch (e) {
			if (collected.length === 0) {
				return transient(
					"pinterest_search",
					query,
					`resource error: ${(e as Error).message}`,
				);
			}
			break;
		}
		if (!r.ok) {
			if (collected.length === 0) {
				return transient(
					"pinterest_search",
					query,
					`resource HTTP ${r.status}`,
				);
			}
			break;
		}
		let j: {
			resource_response?: {
				data?: {
					results?: unknown[];
					bookmark?: string | string[];
				};
			};
			resource?: { options?: { bookmarks?: string | string[] } };
		};
		try {
			j = (await r.json()) as typeof j;
		} catch {
			if (collected.length === 0) {
				return transient(
					"pinterest_search",
					query,
					"resource returned non-JSON (may be blocked)",
				);
			}
			break;
		}
		const pins = j?.resource_response?.data?.results ?? [];
		for (const p of pins) {
			const norm = normalizePin(p);
			if (norm) {
				collected.push(norm);
				if (collected.length >= limit) break;
			}
		}
		const bm =
			j?.resource_response?.data?.bookmark ??
			j?.resource?.options?.bookmarks;
		const next = Array.isArray(bm) ? bm[0] : bm;
		if (!next || next === "-end-" || next === bookmark) break;
		bookmark = next;
	}

	if (collected.length === 0) {
		return {
			summary: `No Pinterest pins found for "${query}".`,
			payload: { query, results: [] },
		};
	}

	const summary = clip(
		`Pinterest: ${collected.length} pins for "${query}"\n${collected
			.slice(0, 8)
			.map(
				(p, i) =>
					`${i + 1}. ${p.title || p.alt_text || "(untitled)"}\n   ${p.image_url}${p.description ? `\n   ${clip(p.description, 160)}` : ""}`,
			)
			.join("\n")}`,
		SUMMARY_MAX,
	);
	return { summary, payload: { query, results: collected } };
}

function normalizePin(p: unknown): PinResult | null {
	if (!p || typeof p !== "object") return null;
	const pin = p as Record<string, unknown>;
	const images = pin.images as
		| Record<string, { url?: string; width?: number; height?: number }>
		| undefined;
	if (!images || typeof images !== "object") return null;
	let img: { url?: string; width?: number; height?: number } | null = null;
	for (const key of ["orig", "736x", "564x", "474x", "236x"]) {
		const candidate = images[key];
		if (candidate?.url) {
			img = candidate;
			break;
		}
	}
	if (!img?.url) return null;
	const id =
		typeof pin.id === "string" || typeof pin.id === "number"
			? String(pin.id)
			: null;
	const title = String(pin.title ?? pin.grid_title ?? "").trim();
	const description = String(pin.description ?? "").trim();
	const alt = String(pin.auto_alt_text ?? pin.alt_text ?? "");
	return {
		id,
		title,
		description,
		alt_text: alt,
		image_url: img.url,
		width: img.width ?? null,
		height: img.height ?? null,
		pin_url: id ? `https://www.pinterest.com/pin/${id}/` : null,
		dominant_color:
			typeof pin.dominant_color === "string" ? pin.dominant_color : null,
	};
}

function parseSetCookies(headers: Headers): Map<string, string> {
	const out = new Map<string, string>();
	const ext = headers as unknown as { getSetCookie?: () => string[] };
	if (typeof ext.getSetCookie === "function") {
		for (const sc of ext.getSetCookie()) {
			const eq = sc.indexOf("=");
			if (eq < 0) continue;
			const semi = sc.indexOf(";");
			const name = sc.slice(0, eq).trim();
			const value = sc.slice(eq + 1, semi < 0 ? undefined : semi).trim();
			if (name) out.set(name, value);
		}
		return out;
	}
	const single = headers.get("set-cookie");
	if (!single) return out;
	// Headers fold multiple Set-Cookie into one comma-separated string. Cookie
	// values we care about don't contain commas, so we can scrape name=value
	// pairs and skip standard attribute keys.
	for (const m of single.matchAll(/(?:^|,\s*)([A-Za-z0-9_-]+)=([^;,]*)/g)) {
		const name = m[1];
		if (
			/^(Expires|Max-Age|Domain|Path|Secure|HttpOnly|SameSite)$/i.test(name)
		) {
			continue;
		}
		if (!out.has(name)) out.set(name, m[2]);
	}
	return out;
}

// -------- music_search via iTunes Search + lyrics.ovh --------

type MusicResult = {
	track: string;
	artist: string;
	album: string;
	genre: string;
	release_year: string;
	url: string;
	preview_url: string;
	artwork: string;
	lyrics: string | null;
};

export async function musicSearch(query: string): Promise<ExternalResult> {
	if (!query.trim()) {
		return {
			summary: "Empty music query.",
			payload: { query, results: [] },
		};
	}
	let r: Response;
	try {
		r = await timedFetch(
			`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=5`,
			{ headers: { "User-Agent": UA, Accept: "application/json" } },
		);
	} catch (e) {
		return transient(
			"music_search",
			query,
			`network error: ${(e as Error).message}`,
		);
	}
	if (!r.ok) return transient("music_search", query, `iTunes HTTP ${r.status}`);
	let j: {
		results?: Array<{
			trackName?: string;
			artistName?: string;
			collectionName?: string;
			primaryGenreName?: string;
			releaseDate?: string;
			trackViewUrl?: string;
			previewUrl?: string;
			artworkUrl100?: string;
		}>;
	};
	try {
		j = (await r.json()) as typeof j;
	} catch {
		return transient("music_search", query, "iTunes returned non-JSON");
	}
	const tracks = (j.results ?? []).slice(0, 5);
	const enriched: MusicResult[] = await Promise.all(
		tracks.map(async (t) => {
			const lyrics = await fetchLyrics(t.artistName ?? "", t.trackName ?? "");
			return {
				track: t.trackName ?? "",
				artist: t.artistName ?? "",
				album: t.collectionName ?? "",
				genre: t.primaryGenreName ?? "",
				release_year: t.releaseDate?.slice(0, 4) ?? "",
				url: t.trackViewUrl ?? "",
				preview_url: t.previewUrl ?? "",
				artwork: t.artworkUrl100 ?? "",
				lyrics,
			};
		}),
	);
	if (enriched.length === 0) {
		return {
			summary: `No music found for "${query}".`,
			payload: { query, results: [] },
		};
	}
	const summary = clip(
		`Music search: "${query}" (${enriched.length} tracks)\n\n${enriched
			.map(
				(t) =>
					`"${t.track}" — ${t.artist}${t.album ? ` (${t.album})` : ""}${t.genre ? `, ${t.genre}` : ""}${t.release_year ? `, ${t.release_year}` : ""}\n${t.lyrics ? clip(t.lyrics, 700) : "(no lyrics available)"}`,
			)
			.join("\n\n")}`,
		SUMMARY_MAX,
	);
	return { summary, payload: { query, results: enriched } };
}

async function fetchLyrics(
	artist: string,
	track: string,
): Promise<string | null> {
	if (!artist || !track) return null;
	try {
		const r = await timedFetch(
			`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(track)}`,
			{ headers: { Accept: "application/json" }, timeoutMs: 8_000 },
		);
		if (!r.ok) return null;
		const j = (await r.json()) as { lyrics?: string };
		return j.lyrics?.trim() || null;
	} catch {
		return null;
	}
}
