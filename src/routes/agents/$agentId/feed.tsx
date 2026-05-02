import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { phaseLabel } from "../../../lib/time";

export const Route = createFileRoute("/agents/$agentId/feed")({
	component: FeedPage,
});

function FeedPage() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const phases = useQuery(api.feed.consumptionPhases, { agentId });

	if (!phases) {
		return (
			<main className="mx-auto max-w-4xl px-6 py-10">
				<div className="h-32 bg-stone-100 animate-pulse" />
			</main>
		);
	}

	const byYear = new Map<number, Doc<"consumptionPhases">[]>();
	phases.forEach((p) => {
		const arr = byYear.get(p.year) ?? [];
		arr.push(p);
		byYear.set(p.year, arr);
	});
	const years = Array.from(byYear.keys()).sort((a, b) => b - a);

	return (
		<main className="mx-auto max-w-4xl px-6 py-10">
			<header className="mb-6">
				<h1 className="font-serif text-2xl text-stone-900 leading-none">
					Everything consumed
				</h1>
			</header>

			{years.length === 0 ? (
				<p className="font-serif italic text-stone-500">
					Nothing consumed yet.
				</p>
			) : (
				<div className="space-y-12">
					{years.map((year) => (
						<YearBlock
							key={year}
							agentId={agentId}
							year={year}
							phases={(byYear.get(year) ?? []).sort(
								(a, b) => a.phaseInYear - b.phaseInYear,
							)}
						/>
					))}
				</div>
			)}
		</main>
	);
}

function YearBlock({
	agentId,
	year,
	phases,
}: {
	agentId: Id<"agents">;
	year: number;
	phases: Doc<"consumptionPhases">[];
}) {
	const items = useQuery(api.feed.byYear, { agentId, year });

	const grouped = useMemo(() => {
		const m = new Map<string, Doc<"consumedItems">[]>();
		(items ?? []).forEach((it) => {
			const key = String(it.consumptionPhaseId);
			const arr = m.get(key) ?? [];
			arr.push(it);
			m.set(key, arr);
		});
		return m;
	}, [items]);

	return (
		<section>
			<div className="flex items-baseline gap-3 mb-6">
				<h2 className="font-serif text-3xl text-stone-900">Year {year}</h2>
				<span className="h-px flex-1 bg-stone-300" />
			</div>
			<div className="space-y-8">
				{phases.map((phase) => {
					const phaseItems = grouped.get(String(phase._id)) ?? [];
					return (
						<div key={phase._id}>
							<div className="flex items-baseline gap-3 mb-3">
								<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
									{phaseLabel(phase.phaseInYear)} · {phaseItems.length} items
								</span>
							</div>
							{phase.reflection && (
								<p className="font-serif italic text-stone-600 mb-4 leading-relaxed border-l-2 border-stone-200 pl-4">
									{phase.reflection}
								</p>
							)}
							<ul className="grid sm:grid-cols-2 gap-3">
								{phaseItems.map((item) => (
									<FeedRow key={item._id} item={item} />
								))}
							</ul>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function FeedRow({ item }: { item: Doc<"consumedItems"> }) {
	return (
		<li className="border border-stone-200 p-3 bg-white">
			<div className="flex items-baseline justify-between gap-2 mb-1">
				<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
					{item.tool}
				</span>
				<span className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-400">
					{item.payload?.url ? "↗" : ""}
				</span>
			</div>
			<p className="font-serif text-sm text-stone-800 leading-snug">
				{item.query}
			</p>
			{item.summary && (
				<p className="font-serif italic text-xs text-stone-600 mt-2 leading-snug line-clamp-3">
					{item.summary}
				</p>
			)}
			{item.payload?.url && typeof item.payload.url === "string" && (
				<a
					href={item.payload.url}
					target="_blank"
					rel="noreferrer"
					className="mt-2 inline-block font-mono text-[10px] underline text-stone-500 break-all"
				>
					{shortUrl(item.payload.url)}
				</a>
			)}
		</li>
	);
}

function shortUrl(u: string): string {
	try {
		const url = new URL(u);
		return url.host + url.pathname.slice(0, 30);
	} catch {
		return u.slice(0, 60);
	}
}
