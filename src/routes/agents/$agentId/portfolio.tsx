import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { PortfolioRenderInline } from "../../../components/PortfolioRender";

type DecoratedItem = Doc<"portfolioItems"> & {
	blobUrl: string | null;
	thumbnailUrl: string | null;
};

export const Route = createFileRoute("/agents/$agentId/portfolio")({
	component: PortfolioPage,
});

function PortfolioPage() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const items = useQuery(api.portfolio.list, { agentId });
	const [filter, setFilter] = useState<string | null>(null);
	const [open, setOpen] = useState<DecoratedItem | null>(null);

	const mediums = useMemo(() => {
		const m = new Map<string, number>();
		for (const it of items ?? []) m.set(it.medium, (m.get(it.medium) ?? 0) + 1);
		return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
	}, [items]);

	const visible = filter
		? (items ?? []).filter((i) => i.medium === filter)
		: (items ?? []);

	return (
		<main className="mx-auto max-w-6xl px-6 py-10">
			<header className="flex items-baseline justify-between mb-6">
				<div>
					<h1 className="font-serif text-4xl text-stone-900 leading-tight">
						Portfolio
					</h1>
					<p className="font-serif italic text-stone-600 mt-1">
						Everything kept, everything made.
					</p>
				</div>
				<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
					{items?.length ?? 0} works
				</span>
			</header>

			<nav className="flex flex-wrap gap-2 mb-8">
				<FilterChip
					active={filter === null}
					onClick={() => setFilter(null)}
					label={`all · ${items?.length ?? 0}`}
				/>
				{mediums.map(([m, count]) => (
					<FilterChip
						key={m}
						active={filter === m}
						onClick={() => setFilter(m)}
						label={`${m} · ${count}`}
					/>
				))}
			</nav>

			{items === undefined ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{["a", "b", "c"].map((k) => (
						<div key={k} className="aspect-[4/3] bg-stone-100 animate-pulse" />
					))}
				</div>
			) : visible.length === 0 ? (
				<p className="font-serif italic text-stone-500">Nothing here yet.</p>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{visible.map((item) => (
						<button
							type="button"
							key={item._id}
							onClick={() => setOpen(item)}
							className="text-left border border-stone-200 bg-white hover:border-stone-400 transition-colors"
						>
							<PortfolioRenderInline item={item} height={220} />
							<div className="p-4">
								<div className="flex items-baseline justify-between gap-3 mb-1">
									<h3 className="font-serif text-base text-stone-900 leading-tight line-clamp-1">
										{item.title}
									</h3>
									<span className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-400">
										y{item.year} · {item.medium}
									</span>
								</div>
								<p className="font-serif italic text-sm text-stone-600 leading-snug line-clamp-2">
									{item.caption}
								</p>
							</div>
						</button>
					))}
				</div>
			)}

			{open && <PortfolioModal item={open} onClose={() => setOpen(null)} />}
		</main>
	);
}

function FilterChip({
	active,
	onClick,
	label,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] border transition-colors ${
				active
					? "bg-stone-900 text-stone-50 border-stone-900"
					: "border-stone-300 text-stone-600 hover:border-stone-900"
			}`}
		>
			{label}
		</button>
	);
}

function PortfolioModal({
	item,
	onClose,
}: {
	item: DecoratedItem;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dlg = dialogRef.current;
		if (dlg && !dlg.open) dlg.showModal();
	}, []);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: dialog handles Escape natively, click on backdrop closes
		<dialog
			ref={dialogRef}
			onClose={onClose}
			onClick={(e) => {
				if (e.target === dialogRef.current) onClose();
			}}
			className="backdrop:bg-stone-900/70 bg-stone-50 border border-stone-200 max-w-5xl w-[90vw] max-h-[90vh] p-0 overflow-hidden"
		>
			<div className="flex flex-col max-h-[90vh]">
				<div className="flex-1 overflow-hidden">
					<PortfolioRenderInline item={item} height={600} />
				</div>
				<div className="p-5 border-t border-stone-200">
					<div className="flex items-baseline justify-between gap-4 mb-1">
						<h2 className="font-serif text-2xl text-stone-900 leading-tight">
							{item.title}
						</h2>
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
							year {item.year} · {item.medium} · {item.kind}
						</span>
					</div>
					<p className="font-serif italic text-stone-700 leading-relaxed">
						{item.caption}
					</p>
					<button
						type="button"
						onClick={onClose}
						className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] underline text-stone-600"
					>
						close
					</button>
				</div>
			</div>
		</dialog>
	);
}
