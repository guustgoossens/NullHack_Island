import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { phaseLabel } from "../../../lib/time";

const LIFESPAN = 60;

export const Route = createFileRoute("/agents/$agentId/timeline")({
	component: TimelinePage,
});

function TimelinePage() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const agent = useQuery(api.agents.get, { agentId });
	const eras = useQuery(api.eras.list, { agentId });
	const consumption = useQuery(api.feed.consumptionPhases, { agentId });
	const creation = useQuery(api.feed.creationPhases, { agentId });
	const rooms = useQuery(api.room.history, { agentId });

	const [hoverYear, setHoverYear] = useState<number | null>(null);
	const [pinnedYear, setPinnedYear] = useState<number | null>(null);

	const previewYear = pinnedYear ?? hoverYear ?? agent?.currentYear ?? 0;

	const yearsByEra = useMemo(() => {
		const map = new Map<number, Doc<"eraLabels">>();
		for (const e of eras ?? []) map.set(e.year, e);
		return map;
	}, [eras]);

	const consumptionByYear = useMemo(() => {
		const m = new Map<number, Doc<"consumptionPhases">[]>();
		for (const c of consumption ?? []) {
			const arr = m.get(c.year) ?? [];
			arr.push(c);
			m.set(c.year, arr);
		}
		return m;
	}, [consumption]);

	const creationByYear = useMemo(() => {
		const m = new Map<number, Doc<"creationPhases">>();
		for (const c of creation ?? []) m.set(c.year, c);
		return m;
	}, [creation]);

	const roomsByYear = useMemo(() => {
		const m = new Map<
			number,
			(Doc<"roomVersions"> & { imageUrl: string | null }) | undefined
		>();
		// rooms come desc; keep latest seen per year
		for (const r of rooms ?? []) {
			if (!m.has(r.year)) m.set(r.year, r);
		}
		return m;
	}, [rooms]);

	if (!agent) return null;

	const previewEra = yearsByEra.get(previewYear);
	const previewCreation = creationByYear.get(previewYear);
	const previewRoom = roomsByYear.get(previewYear);
	const previewConsumption = (consumptionByYear.get(previewYear) ?? []).sort(
		(a, b) => a.phaseInYear - b.phaseInYear,
	);

	return (
		<main className="mx-auto max-w-6xl px-6 py-10">
			<header className="mb-6 flex items-baseline justify-between">
				<h1 className="font-serif text-2xl text-stone-900 leading-none">
					Sixty years
				</h1>
				<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
					hover · click to pin
				</span>
			</header>

			<TimelineStrip
				lifespan={LIFESPAN}
				currentYear={agent.currentYear}
				eras={yearsByEra}
				consumptionByYear={consumptionByYear}
				creationByYear={creationByYear}
				hoverYear={hoverYear}
				pinnedYear={pinnedYear}
				onHover={setHoverYear}
				onPin={(y) => setPinnedYear((prev) => (prev === y ? null : y))}
			/>

			<section className="mt-10 grid lg:grid-cols-[2fr_3fr] gap-8">
				<div>
					<div className="aspect-[4/3] bg-stone-100 border border-stone-200 overflow-hidden">
						{previewRoom?.imageUrl ? (
							<img
								src={previewRoom.imageUrl}
								alt={`Year ${previewYear} room`}
								className="w-full h-full object-cover"
							/>
						) : (
							<div className="w-full h-full flex items-center justify-center text-stone-400 font-mono text-[11px] uppercase tracking-[0.2em]">
								{previewRoom
									? previewRoom.imageStatus === "failed"
										? "image failed"
										: "rendering…"
									: "no room yet"}
							</div>
						)}
					</div>
					{previewRoom?.prompt && (
						<p className="mt-3 font-serif italic text-sm text-stone-600 leading-relaxed">
							{previewRoom.prompt}
						</p>
					)}
				</div>

				<div className="space-y-5">
					<div>
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
							year {previewYear}
							{pinnedYear !== null && (
								<button
									type="button"
									onClick={() => setPinnedYear(null)}
									className="ml-3 underline"
								>
									unpin
								</button>
							)}
						</span>
						<h2 className="font-serif text-3xl italic text-stone-900 mt-2 leading-tight">
							{previewEra?.label ?? "—"}
						</h2>
						{previewEra?.summary && (
							<p className="font-serif text-stone-700 mt-3 leading-relaxed">
								{previewEra.summary}
							</p>
						)}
					</div>

					{previewCreation?.reflection && (
						<div className="border-l-2 border-stone-300 pl-4">
							<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
								year reflection
							</span>
							<p className="font-serif italic text-stone-700 mt-2 leading-relaxed">
								{previewCreation.reflection}
							</p>
						</div>
					)}

					{previewConsumption.length > 0 && (
						<div>
							<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
								consumption phases
							</span>
							<ul className="mt-2 space-y-2">
								{previewConsumption.map((p) => (
									<li key={p._id} className="border border-stone-200 px-3 py-2">
										<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
											{phaseLabel(p.phaseInYear)}
										</span>
										{p.reflection && (
											<p className="font-serif text-sm text-stone-700 mt-1 leading-snug">
												{p.reflection}
											</p>
										)}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			</section>
		</main>
	);
}

function TimelineStrip({
	lifespan,
	currentYear,
	eras,
	consumptionByYear,
	creationByYear,
	hoverYear,
	pinnedYear,
	onHover,
	onPin,
}: {
	lifespan: number;
	currentYear: number;
	eras: Map<number, Doc<"eraLabels">>;
	consumptionByYear: Map<number, Doc<"consumptionPhases">[]>;
	creationByYear: Map<number, Doc<"creationPhases">>;
	hoverYear: number | null;
	pinnedYear: number | null;
	onHover: (y: number | null) => void;
	onPin: (y: number) => void;
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: hover-clear is non-essential
		<div
			className="relative border-y border-stone-200 py-6"
			onMouseLeave={() => onHover(null)}
		>
			<div className="flex">
				{Array.from({ length: lifespan }, (_, year) => {
					const isLived = year <= currentYear;
					const isCurrent = year === currentYear;
					const isHover = hoverYear === year;
					const isPinned = pinnedYear === year;
					const era = eras.get(year);
					const consumption = consumptionByYear.get(year) ?? [];
					const creation = creationByYear.get(year);

					return (
						<button
							type="button"
							// biome-ignore lint/suspicious/noArrayIndexKey: year is the stable identity, not a sort index
							key={`y${year}`}
							onMouseEnter={() => onHover(year)}
							onClick={() => onPin(year)}
							className="group flex-1 flex flex-col items-center gap-1 py-1 px-px relative"
						>
							<span
								className={`text-[9px] font-mono ${
									year % 5 === 0 ? "text-stone-500" : "text-transparent"
								} ${isPinned || isHover ? "text-stone-900" : ""}`}
							>
								{year}
							</span>
							<span
								className={`block w-full h-3 ${
									isLived
										? era
											? "bg-stone-700"
											: "bg-stone-400"
										: "bg-stone-200"
								} ${isCurrent ? "ring-1 ring-emerald-500" : ""} ${
									isPinned ? "ring-2 ring-stone-900 ring-offset-1" : ""
								}`}
								title={era?.label ?? `year ${year}`}
							/>
							<div className="flex gap-px w-full">
								<span
									className={`flex-1 h-1 ${
										consumption.length > 0 ? "bg-stone-500" : "bg-stone-200"
									}`}
								/>
							</div>
							<span
								className={`block w-full h-1 ${
									creation ? "bg-amber-500" : "bg-stone-200"
								}`}
							/>
						</button>
					);
				})}
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
				<LegendSwatch className="bg-stone-700" label="era observed" />
				<LegendSwatch className="bg-stone-400" label="lived" />
				<LegendSwatch className="bg-stone-500" label="consumption" />
				<LegendSwatch className="bg-amber-500" label="creation" />
				<LegendSwatch
					className="bg-transparent ring-1 ring-emerald-500"
					label="now"
				/>
			</div>
		</div>
	);
}

function LegendSwatch({
	className,
	label,
}: {
	className: string;
	label: string;
}) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span className={`inline-block w-3 h-3 ${className}`} />
			{label}
		</span>
	);
}
