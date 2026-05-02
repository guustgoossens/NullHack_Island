import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Markdown } from "../../../lib/markdown";

export const Route = createFileRoute("/agents/$agentId/essays")({
	component: EssaysPage,
});

function EssaysPage() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const items = useQuery(api.portfolio.list, { agentId });

	const essays = useMemo(() => {
		const list = (items ?? []).filter((i) => i.medium === "essay");
		return list.sort((a, b) => a.year - b.year);
	}, [items]);

	const [selectedId, setSelectedId] = useState<Id<"portfolioItems"> | null>(
		null,
	);
	const selected =
		essays.find((e) => e._id === selectedId) ?? essays[essays.length - 1] ?? null;

	if (items === undefined) {
		return (
			<main className="mx-auto max-w-4xl px-6 py-10">
				<div className="h-32 bg-stone-100 animate-pulse" />
			</main>
		);
	}

	if (essays.length === 0) {
		return (
			<main className="mx-auto max-w-4xl px-6 py-10">
				<header className="mb-6">
					<h1 className="font-serif text-4xl text-stone-900 leading-tight">
						Essays on Taste
					</h1>
					<p className="font-serif italic text-stone-600 mt-1">
						Written at the close of a life.
					</p>
				</header>
				<p className="font-serif italic text-stone-500">
					This artist has not written their closing essay yet.
				</p>
			</main>
		);
	}

	const hasSidebar = essays.length > 1;

	const article = selected ? (
		<article className="mx-auto w-full max-w-2xl py-4">
			<div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400 mb-3">
				year {selected.year} · closing essay
			</div>
			<h2 className="font-serif text-4xl text-stone-900 leading-tight mb-3">
				{selected.title}
			</h2>
			<p className="font-serif italic text-stone-600 mb-10 text-lg">
				{selected.caption}
			</p>
			<EssayBody item={selected} />
		</article>
	) : null;

	return (
		<main className="mx-auto max-w-6xl px-6 py-10">
			<header className="mb-10 text-center">
				<h1 className="font-serif text-4xl text-stone-900 leading-tight">
					Essays on Taste
				</h1>
				<p className="font-serif italic text-stone-600 mt-1">
					Written at the close of a life.
				</p>
			</header>

			{hasSidebar ? (
				<div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10">
					<aside className="space-y-1">
						{essays.map((e) => {
							const active = selected?._id === e._id;
							return (
								<button
									key={e._id}
									type="button"
									onClick={() => setSelectedId(e._id)}
									className={`w-full text-left px-3 py-2 border font-mono text-[10px] uppercase tracking-[0.18em] ${
										active
											? "bg-stone-900 text-stone-50 border-stone-900"
											: "border-stone-200 text-stone-600 hover:border-stone-900"
									}`}
								>
									<div className="tabular-nums">y{e.year}</div>
									<div
										className={`font-serif normal-case tracking-normal text-[12px] mt-1 italic ${active ? "text-stone-200" : "text-stone-700"} line-clamp-2`}
									>
										{e.title}
									</div>
								</button>
							);
						})}
					</aside>
					{article}
				</div>
			) : (
				article
			)}
		</main>
	);
}

function EssayBody({
	item,
}: {
	item: { payload: { kind: string; text?: string } };
}) {
	const text =
		item.payload.kind === "text" && item.payload.text
			? item.payload.text
			: "";
	if (!text) {
		return (
			<p className="font-serif italic text-stone-500">(empty)</p>
		);
	}
	return (
		<div className="font-serif text-stone-900 leading-relaxed text-[17px] [&_p]:mb-5 [&_h1]:font-serif [&_h2]:font-serif [&_h3]:font-serif [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:mt-8 [&_h2]:mt-7 [&_h3]:mt-6 [&_h1]:mb-3 [&_h2]:mb-3 [&_h3]:mb-2 [&_em]:italic [&_strong]:font-semibold">
			<Markdown source={text} />
		</div>
	);
}
