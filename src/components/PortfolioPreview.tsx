import type { Doc } from "../../convex/_generated/dataModel";
import { PortfolioRenderInline } from "./PortfolioRender";

type DecoratedItem = Doc<"portfolioItems"> & {
	blobUrl: string | null;
	thumbnailUrl: string | null;
};

export function PortfolioPreview({ item }: { item: DecoratedItem }) {
	return (
		<figure className="border border-stone-200 bg-white">
			<PortfolioRenderInline item={item} height={180} />
			<figcaption className="p-3">
				<div className="flex items-baseline justify-between gap-2 mb-1">
					<h3 className="font-serif text-sm text-stone-900 leading-snug line-clamp-1">
						{item.title}
					</h3>
					<span className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-400">
						{item.medium}
					</span>
				</div>
				{item.caption && (
					<p className="font-serif italic text-xs text-stone-600 line-clamp-2 leading-snug">
						{item.caption}
					</p>
				)}
			</figcaption>
		</figure>
	);
}
