import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { CohortBirthModal } from "../components/CohortBirthModal";

export const Route = createFileRoute("/island")({ component: Island });

function Island() {
	const cohorts = useQuery(api.cohort.list);
	const [birthOpen, setBirthOpen] = useState(false);
	const [selectedId, setSelectedId] = useState<Id<"cohorts"> | null>(null);

	const cohortId =
		selectedId ?? (cohorts && cohorts.length > 0 ? cohorts[0]._id : null);

	if (cohorts === undefined) {
		return (
			<main className="mx-auto max-w-7xl px-6 py-12">
				<div className="h-32 bg-stone-100 animate-pulse" />
			</main>
		);
	}

	if (cohortId === null) {
		return (
			<main className="mx-auto max-w-3xl px-6 py-24 text-center">
				<h1 className="font-serif text-4xl text-stone-900 mb-4">
					The island is empty.
				</h1>
				<p className="font-serif italic text-stone-500 mb-8">
					A cohort is eight artists and one Commons. They live in parallel and
					convene every four years.
				</p>
				<button
					type="button"
					onClick={() => setBirthOpen(true)}
					className="px-5 py-3 bg-stone-900 text-stone-50 font-mono text-xs uppercase tracking-[0.2em] hover:bg-stone-700"
				>
					Birth a cohort
				</button>
				<CohortBirthModal
					open={birthOpen}
					onClose={(id) => {
						setBirthOpen(false);
						if (id) setSelectedId(id as Id<"cohorts">);
					}}
				/>
			</main>
		);
	}

	return (
		<>
			<IslandView
				cohortId={cohortId}
				cohorts={cohorts}
				onSelectCohort={(id) => setSelectedId(id)}
				onCreate={() => setBirthOpen(true)}
			/>
			<CohortBirthModal
				open={birthOpen}
				onClose={(id) => {
					setBirthOpen(false);
					if (id) setSelectedId(id as Id<"cohorts">);
				}}
			/>
		</>
	);
}

function IslandView({
	cohortId,
	cohorts,
	onSelectCohort,
	onCreate,
}: {
	cohortId: Id<"cohorts">;
	cohorts: Doc<"cohorts">[];
	onSelectCohort: (id: Id<"cohorts">) => void;
	onCreate: () => void;
}) {
	const data = useQuery(api.cohort.islandView, { cohortId });
	const setSpeed = useMutation(api.cohort.setCohortSpeed);
	const [scrubYear, setScrubYear] = useState<number | null>(null);
	const scrub = useQuery(
		api.cohort.stateAtYear,
		scrubYear !== null ? { cohortId, year: scrubYear } : "skip",
	);

	if (data === undefined) {
		return (
			<main className="mx-auto max-w-7xl px-6 py-12">
				<div className="h-[80vh] bg-stone-100 animate-pulse" />
			</main>
		);
	}
	if (data === null) {
		return (
			<main className="mx-auto max-w-3xl px-6 py-24 text-center">
				<p className="font-serif italic text-stone-500">
					This cohort no longer exists.
				</p>
			</main>
		);
	}

	const { cohort, agents, latestRoomImageUrls, latestEras, gatherings } = data;

	// Order: 8 individuals first (in cohort.individualIds order) + commons last.
	const individuals = cohort.individualIds
		.map((id) => agents.find((a) => a._id === id))
		.filter((a): a is Doc<"agents"> => Boolean(a));
	const commons = agents.find((a) => a._id === cohort.commonsId) ?? null;

	const minYear = Math.min(...individuals.map((a) => a.currentYear), 0);
	const maxYear = Math.max(...individuals.map((a) => a.currentYear), 0);
	const liveMode = scrubYear === null;
	const speed = individuals[0]?.secondsPerYear ?? 15;

	const activeGathering = liveMode
		? gatherings.find(
				(g) => g.status === "running" || g.status === "synthesizing",
			)
		: undefined;

	// In scrub mode, replace the live image/era maps with year-K state.
	const imgFor = (id?: Id<"agents">): string | null => {
		if (!id) return null;
		if (liveMode) return latestRoomImageUrls[id] ?? null;
		return scrub?.roomImageUrls[id] ?? null;
	};
	const eraFor = (id?: Id<"agents">): Doc<"eraLabels"> | null => {
		if (!id) return null;
		if (liveMode) return latestEras[id] ?? null;
		return scrub?.eras[id] ?? null;
	};
	const yearLabelFor = (a: Doc<"agents">): number => {
		if (liveMode) return a.currentYear;
		if (scrub) return scrub.ages[a._id] ?? scrubYear ?? 0;
		return scrubYear ?? 0;
	};

	return (
		<main className="px-6 py-6 pb-32">
			<div className="mx-auto max-w-7xl flex flex-wrap items-baseline justify-between gap-3 mb-6">
				<div className="flex items-baseline gap-4">
					<h1 className="font-serif text-3xl text-stone-900 tracking-tight">
						{cohort.name}
					</h1>
					{cohorts.length > 1 && (
						<select
							value={cohortId}
							onChange={(e) =>
								onSelectCohort(e.target.value as Id<"cohorts">)
							}
							className="font-mono text-xs px-2 py-1 border border-stone-300 bg-white"
						>
							{cohorts.map((c) => (
								<option key={c._id} value={c._id}>
									{c.name}
								</option>
							))}
						</select>
					)}
					<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
						y{minYear === maxYear ? minYear : `${minYear}–${maxYear}`}
						{" · "}gathering every {cohort.gatheringEveryNYears}y
					</span>
				</div>
				<div className="flex items-center gap-3">
					{activeGathering && (
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700 animate-pulse">
							● gathering — y{activeGathering.year} ·{" "}
							{activeGathering.status}
						</span>
					)}
					<button
						type="button"
						onClick={onCreate}
						className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] border border-stone-300 hover:bg-stone-100"
					>
						+ new cohort
					</button>
				</div>
			</div>

			<div className="mx-auto max-w-7xl grid grid-cols-3 gap-4 aspect-[3/2.6]">
				{[0, 1, 2, 3].map((i) => (
					<Cell
						key={i}
						agent={individuals[i]}
						imageUrl={imgFor(individuals[i]?._id)}
						era={eraFor(individuals[i]?._id)}
						displayYear={
							individuals[i]
								? yearLabelFor(individuals[i] as Doc<"agents">)
								: 0
						}
						hideRuntimeBadges={!liveMode}
					/>
				))}
				<CommonsCell
					agent={commons}
					imageUrl={imgFor(commons?._id)}
					gatheringCount={
						liveMode
							? gatherings.length
							: gatherings.filter(
									(g) =>
										scrubYear !== null && g.year <= scrubYear,
								).length
					}
					activeGathering={activeGathering ?? null}
					displayYear={commons ? yearLabelFor(commons) : 0}
				/>
				{[4, 5, 6, 7].map((i) => (
					<Cell
						key={i}
						agent={individuals[i]}
						imageUrl={imgFor(individuals[i]?._id)}
						era={eraFor(individuals[i]?._id)}
						displayYear={
							individuals[i]
								? yearLabelFor(individuals[i] as Doc<"agents">)
								: 0
						}
						hideRuntimeBadges={!liveMode}
					/>
				))}
			</div>

			{activeGathering && (
				<GatheringStrip gatheringId={activeGathering._id} agents={agents} />
			)}

			{!activeGathering && gatherings.length > 0 && (
				<RecentGathering
					gathering={gatherings[0]}
					agents={agents}
				/>
			)}

			<BottomBar
				liveMode={liveMode}
				scrubYear={scrubYear}
				maxYear={maxYear}
				gatheringEveryN={cohort.gatheringEveryNYears}
				gatheringYears={gatherings.map((g) => g.year)}
				speed={speed}
				onScrub={(y) => setScrubYear(y)}
				onLive={() => setScrubYear(null)}
				onSpeed={(s) =>
					void setSpeed({ cohortId, secondsPerYear: s })
				}
			/>
		</main>
	);
}

function Cell({
	agent,
	imageUrl,
	era,
}: {
	agent: Doc<"agents"> | undefined;
	imageUrl: string | null;
	era: Doc<"eraLabels"> | null;
}) {
	if (!agent) {
		return <div className="bg-stone-100 border border-stone-200" />;
	}
	const waiting = Boolean(agent.gatheringWait);
	return (
		<Link
			to="/agents/$agentId"
			params={{ agentId: agent._id }}
			className="group relative bg-stone-100 border border-stone-200 overflow-hidden block hover:border-stone-500 transition-colors"
		>
			{imageUrl ? (
				<img
					src={imageUrl}
					alt={`${agent.name}'s room`}
					className="w-full h-full object-cover"
				/>
			) : (
				<div className="w-full h-full flex items-center justify-center text-stone-400 font-mono text-[10px] uppercase tracking-[0.2em]">
					rendering…
				</div>
			)}
			<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-900/85 via-stone-900/60 to-transparent p-3">
				<div className="flex items-baseline justify-between gap-2">
					<div className="font-serif text-xl text-stone-50 leading-none truncate">
						{agent.name}
					</div>
					<div className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-300">
						y{agent.currentYear}
					</div>
				</div>
				{era && (
					<div className="mt-1 font-serif italic text-stone-200 text-xs truncate">
						{era.label}
					</div>
				)}
			</div>
			{waiting && (
				<div className="absolute top-2 right-2 px-2 py-1 bg-amber-500/90 text-stone-900 font-mono text-[9px] uppercase tracking-[0.18em]">
					waiting
				</div>
			)}
			{agent.genesisStatus === "pending" && (
				<div className="absolute top-2 left-2 px-2 py-1 bg-stone-50/90 text-stone-700 font-mono text-[9px] uppercase tracking-[0.18em]">
					being born
				</div>
			)}
		</Link>
	);
}

function CommonsCell({
	agent,
	imageUrl,
	gatheringCount,
	activeGathering,
}: {
	agent: Doc<"agents"> | null;
	imageUrl: string | null;
	gatheringCount: number;
	activeGathering: Doc<"gatherings"> | null;
}) {
	if (!agent) {
		return <div className="bg-stone-100 border border-stone-200" />;
	}
	return (
		<Link
			to="/agents/$agentId"
			params={{ agentId: agent._id }}
			className={`relative bg-stone-100 border-2 ${activeGathering ? "border-amber-500" : "border-stone-900"} overflow-hidden block`}
		>
			{imageUrl ? (
				<img
					src={imageUrl}
					alt="Commons"
					className="w-full h-full object-cover"
				/>
			) : (
				<div className="w-full h-full flex items-center justify-center text-stone-500 font-serif italic">
					Commons
				</div>
			)}
			<div className="absolute inset-x-0 top-0 bg-gradient-to-b from-stone-900/85 to-transparent p-3">
				<div className="flex items-baseline justify-between gap-2">
					<div className="font-serif text-base text-stone-50 leading-none italic truncate">
						{agent.name}
					</div>
					<div className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-300">
						{gatheringCount} gathering{gatheringCount === 1 ? "" : "s"}
					</div>
				</div>
			</div>
			{activeGathering && (
				<div className="absolute inset-x-0 bottom-0 bg-amber-500/95 p-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-stone-900 animate-pulse">
					{activeGathering.status === "running"
						? `gathering · y${activeGathering.year}`
						: `synthesizing · y${activeGathering.year}`}
				</div>
			)}
		</Link>
	);
}

function GatheringStrip({
	gatheringId,
	agents,
}: {
	gatheringId: Id<"gatherings">;
	agents: Doc<"agents">[];
}) {
	const detail = useQuery(api.cohort.gatheringDetail, { gatheringId });
	const nameOf = useMemo(() => {
		const m = new Map(agents.map((a) => [a._id, a.name] as const));
		return (id: Id<"agents">) => m.get(id) ?? "?";
	}, [agents]);
	if (!detail) return null;
	const { breakouts } = detail;
	const sorted = [...breakouts].sort((a, b) => a.round - b.round);
	return (
		<div className="mx-auto max-w-7xl mt-6 border border-amber-300 bg-amber-50">
			<div className="px-4 py-2 border-b border-amber-200 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-900">
				live gathering · year {detail.gathering.year}
			</div>
			<div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-x divide-amber-200">
				{[1, 2, 3].map((round) => {
					const ofRound = sorted.filter((b) => b.round === round);
					return (
						<div key={round} className="p-3 max-h-64 overflow-y-auto">
							<div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700 mb-2">
								round {round} ·{" "}
								{round === 1
									? "pairs"
									: round === 2
										? "fours"
										: "all eight"}
							</div>
							{ofRound.length === 0 && (
								<div className="font-serif italic text-amber-600 text-xs">
									(waiting…)
								</div>
							)}
							{ofRound.map((b) => (
								<div key={b._id} className="mb-3">
									<div className="font-mono text-[9px] uppercase tracking-[0.18em] text-amber-600 mb-1">
										{b.participantIds.map(nameOf).join(" · ")}
									</div>
									<div className="space-y-1">
										{b.transcript.map((u, i) => (
											<div key={i} className="text-xs leading-snug">
												<span className="font-mono text-amber-800">
													{nameOf(u.agentId)}:
												</span>{" "}
												<span className="font-serif text-stone-800">
													{u.text}
												</span>
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function RecentGathering({
	gathering,
	agents,
}: {
	gathering: Doc<"gatherings">;
	agents: Doc<"agents">[];
}) {
	const detail = useQuery(api.cohort.gatheringDetail, {
		gatheringId: gathering._id,
	});
	const nameOf = useMemo(() => {
		const m = new Map(agents.map((a) => [a._id, a.name] as const));
		return (id: Id<"agents">) => m.get(id) ?? "?";
	}, [agents]);
	if (!detail) return null;
	const totalUtterances = detail.breakouts.reduce(
		(n, b) => n + b.transcript.length,
		0,
	);
	return (
		<div className="mx-auto max-w-7xl mt-6 border border-stone-200 bg-white">
			<div className="px-4 py-2 border-b border-stone-200 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500 flex items-baseline justify-between">
				<span>
					last gathering · year {gathering.year} ·{" "}
					{detail.breakouts.length} rooms · {totalUtterances} utterances
				</span>
				<span className="text-stone-400">{gathering.status}</span>
			</div>
			<div className="p-3 max-h-48 overflow-y-auto space-y-2">
				{detail.breakouts
					.sort((a, b) => a.round - b.round)
					.map((b) => (
						<div key={b._id}>
							<span className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-400">
								r{b.round} {b.participantIds.map(nameOf).join(" · ")}
							</span>
							<div className="font-serif italic text-stone-600 text-xs mt-0.5 line-clamp-2">
								{b.transcript[0]?.text ?? "(quiet)"}
							</div>
						</div>
					))}
			</div>
		</div>
	);
}

function BottomBar({
	liveMode,
	scrubYear,
	maxYear,
	gatheringEveryN,
	gatheringYears,
	speed,
	onScrub,
	onLive,
	onSpeed,
}: {
	liveMode: boolean;
	scrubYear: number | null;
	maxYear: number;
	gatheringEveryN: number;
	gatheringYears: number[];
	speed: number;
	onScrub: (y: number) => void;
	onLive: () => void;
	onSpeed: (s: number) => void;
}) {
	const yearMax = Math.max(maxYear, 60);
	const displayYear = scrubYear ?? maxYear;
	const gatheringYearSet = new Set(gatheringYears);
	return (
		<div className="fixed bottom-0 inset-x-0 bg-stone-900 text-stone-50 z-20 border-t border-stone-700">
			<div className="mx-auto max-w-7xl px-6 py-3 flex flex-wrap items-center gap-6">
				<div className="flex items-center gap-2 min-w-[120px]">
					<button
						type="button"
						onClick={onLive}
						className={`px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${liveMode ? "bg-stone-50 text-stone-900" : "border border-stone-600 text-stone-300 hover:bg-stone-800"}`}
					>
						{liveMode ? "● live" : "live"}
					</button>
					<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400 tabular-nums">
						y{displayYear}
					</span>
				</div>

				<div className="flex-1 min-w-[280px]">
					<div className="relative">
						<input
							type="range"
							min={0}
							max={yearMax}
							step={1}
							value={displayYear}
							onChange={(e) => onScrub(Number(e.target.value))}
							className="w-full accent-stone-50"
						/>
						<div className="relative h-2 -mt-1 pointer-events-none">
							{Array.from({ length: yearMax + 1 }).map((_, y) => {
								if (y % gatheringEveryN !== 0 || y === 0) return null;
								const left = `${(y / yearMax) * 100}%`;
								const completed = gatheringYearSet.has(y);
								return (
									<div
										key={y}
										className={`absolute top-0 w-px h-2 ${completed ? "bg-amber-400" : "bg-stone-600"}`}
										style={{ left }}
									/>
								);
							})}
						</div>
					</div>
				</div>

				<div className="flex items-center gap-2 min-w-[200px]">
					<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
						speed
					</span>
					<input
						type="range"
						min={5}
						max={120}
						step={5}
						value={speed}
						onChange={(e) => onSpeed(Number(e.target.value))}
						className="flex-1 accent-stone-50"
					/>
					<span className="font-mono text-[10px] tabular-nums text-stone-300 w-10 text-right">
						{speed}s/y
					</span>
				</div>
			</div>
		</div>
	);
}

function url(
	map: Record<string, string | null>,
	id: Id<"agents"> | undefined,
): string | null {
	if (!id) return null;
	return map[id] ?? null;
}

function era(
	map: Record<string, Doc<"eraLabels"> | null>,
	id: Id<"agents"> | undefined,
): Doc<"eraLabels"> | null {
	if (!id) return null;
	return map[id] ?? null;
}
