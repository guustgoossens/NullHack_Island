import type { Doc } from "../../convex/_generated/dataModel";
import { Markdown } from "../lib/markdown";

type DecoratedItem = Doc<"portfolioItems"> & {
	blobUrl: string | null;
	thumbnailUrl: string | null;
};

const THREEJS_HTML = (code: string) => `<!doctype html>
<html><head>
<meta charset="utf-8" />
<style>
  html,body{margin:0;height:100%;background:#0c0a09;color:#e7e5e4;font-family:ui-sans-serif,system-ui,sans-serif;}
  #err{position:fixed;left:0;right:0;bottom:0;padding:8px 12px;background:rgba(127,29,29,0.9);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;white-space:pre-wrap;display:none;}
</style>
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }
</script>
</head><body>
<div id="err"></div>
<script type="module">
window.addEventListener("error", (e) => {
  const el = document.getElementById("err");
  if (el) { el.style.display = "block"; el.textContent = String(e.message || e.error); }
});
try {
${code}
} catch (e) {
  const el = document.getElementById("err");
  if (el) { el.style.display = "block"; el.textContent = String(e); }
}
</script>
</body></html>`;

export function PortfolioRenderInline({
	item,
	height = 300,
}: {
	item: DecoratedItem;
	height?: number;
}) {
	const p = item.payload;
	const style = { height: `${height}px` } as const;

	switch (p.kind) {
		case "blob":
			return (
				<div
					className="bg-stone-100 overflow-hidden flex items-center justify-center"
					style={style}
				>
					{item.blobUrl ? (
						p.mimeType.startsWith("video/") ? (
							<video
								src={item.blobUrl}
								controls
								className="w-full h-full object-contain"
							>
								<track kind="captions" />
							</video>
						) : (
							<img
								src={item.blobUrl}
								alt={item.title}
								className="w-full h-full object-cover"
							/>
						)
					) : (
						<RenderingPill status={item.status} />
					)}
				</div>
			);

		case "html":
			return (
				<iframe
					title={item.title}
					srcDoc={p.html}
					sandbox="allow-scripts"
					style={style}
					className="w-full bg-stone-100 border-0"
				/>
			);

		case "threejs":
			return (
				<iframe
					title={item.title}
					srcDoc={THREEJS_HTML(p.code)}
					sandbox="allow-scripts"
					style={style}
					className="w-full bg-stone-900 border-0"
				/>
			);

		case "text": {
			const isProse =
				item.medium === "poem" ||
				item.medium === "essay" ||
				item.medium === "writing" ||
				item.medium === "found_text";
			return (
				<div
					className="bg-stone-50 border border-stone-200 overflow-y-auto p-4"
					style={style}
				>
					{isProse ? (
						<Markdown source={p.text} />
					) : (
						<pre className="font-mono text-[11px] leading-snug whitespace-pre text-stone-800">
							{p.text}
						</pre>
					)}
				</div>
			);
		}

		case "external": {
			// Pinterest / image_search curations now carry a direct image URL,
			// so we render the pin inline. Anything else (or a convex:// stub
			// fallback) gets the source-tool chip.
			const isImageHost =
				item.medium === "found_image" &&
				p.url.startsWith("http") &&
				/(\.jpg|\.jpeg|\.png|\.webp|\.gif|i\.pinimg\.com|images?\.|\?format=)/i.test(
					p.url,
				);
			if (isImageHost) {
				return (
					<a
						href={p.url}
						target="_blank"
						rel="noreferrer"
						className="block bg-stone-100 overflow-hidden"
						style={style}
					>
						<img
							src={p.url}
							alt={item.title}
							loading="lazy"
							referrerPolicy="no-referrer"
							className="w-full h-full object-cover"
						/>
					</a>
				);
			}
			return (
				<a
					href={p.url}
					target="_blank"
					rel="noreferrer"
					className="flex items-center justify-center bg-stone-100 hover:bg-stone-200 transition-colors text-stone-600"
					style={style}
				>
					<span className="font-mono text-[10px] uppercase tracking-[0.18em]">
						{p.sourceTool} ↗
					</span>
				</a>
			);
		}

		default:
			return (
				<div
					className="flex items-center justify-center bg-stone-100"
					style={style}
				>
					<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
						unknown medium
					</span>
				</div>
			);
	}
}

function RenderingPill({
	status,
}: {
	status: Doc<"portfolioItems">["status"];
}) {
	return (
		<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
			{status === "failed" ? "render failed" : "rendering…"}
		</span>
	);
}
