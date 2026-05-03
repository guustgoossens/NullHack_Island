import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { CohortBirthModal } from "../components/CohortBirthModal";

export const Route = createFileRoute("/island")({ component: Island });

type EmotionDef = {
	key: string;
	label: string;
	axis?: { dim: "x" | "y" | "z"; sign: -1 | 1 };
	hex: string;
};

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
	const [emotionOverlay, setEmotionOverlay] = useState(false);
	const [conversationsOpen, setConversationsOpen] = useState(false);
	const scrub = useQuery(
		api.cohort.stateAtYear,
		scrubYear !== null ? { cohortId, year: scrubYear } : "skip",
	);
	// Fetch emotion data once per cohort; pick per-year readings client-side so
	// scrubbing doesn't re-fire queries.
	const emotionDefs = useQuery(
		api.emotions.definitions,
		emotionOverlay ? {} : "skip",
	);
	const allEmotions = useQuery(
		api.cohort.cohortAllEmotions,
		emotionOverlay ? { cohortId } : "skip",
	);

	// Latest-only flat map for the commons aurora ring (it always reads "now",
	// regardless of scrub) — kept stable to avoid re-renders. Must be declared
	// before any early return so hook order stays consistent across renders.
	const cohortLatestEmotions = useMemo(() => {
		if (!allEmotions) return null;
		const out: Record<string, Doc<"emotionalReadings"> | null> = {};
		for (const id of Object.keys(allEmotions)) {
			const list = allEmotions[id];
			out[id] = list && list.length > 0 ? list[list.length - 1] : null;
		}
		return out;
	}, [allEmotions]);

	const individualsForEffect = data?.agents
		? data.cohort.individualIds
				.map((id) => data.agents.find((a) => a._id === id))
				.filter((a): a is Doc<"agents"> => Boolean(a))
		: [];
	const maxYearForEffect = individualsForEffect.length
		? Math.max(...individualsForEffect.map((a) => a.currentYear), 0)
		: 0;
	const speedForEffect = individualsForEffect[0]?.secondsPerYear ?? 15;

	// Roll the scrub cursor forward at `speed` seconds/year so scrubbing back
	// behaves like a paused playback that auto-resumes. When it catches up to
	// the live edge, drop back into live mode. Declared before any early return
	// so hook order stays stable across renders.
	useEffect(() => {
		if (scrubYear === null) return;
		if (maxYearForEffect <= 0) return;
		const id = window.setTimeout(() => {
			setScrubYear((y) => {
				if (y === null) return null;
				const next = y + 1;
				return next > maxYearForEffect ? 0 : next;
			});
		}, Math.max(1, speedForEffect) * 1000);
		return () => window.clearTimeout(id);
	}, [scrubYear, maxYearForEffect, speedForEffect]);

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
	const maxYear = maxYearForEffect;
	const liveMode = scrubYear === null;
	const speed = speedForEffect;

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

	// Pick the most recent emotional reading at-or-before the given year from
	// the cached per-cohort emotion list. Pure client-side; no extra fetches.
	const emotionFor = (
		agentId: Id<"agents"> | undefined,
		atYear: number,
	): Doc<"emotionalReadings"> | null => {
		if (!agentId || !allEmotions) return null;
		const list = allEmotions[agentId];
		if (!list || list.length === 0) return null;
		// list is sorted ascending by year; scan from the end for the first
		// row whose year <= atYear.
		for (let j = list.length - 1; j >= 0; j--) {
			if (list[j].year <= atYear) return list[j];
		}
		return null;
	};

	const renderCell = (i: number) => {
		const a = individuals[i];
		const yearForCell = a ? yearLabelFor(a as Doc<"agents">) : 0;
		return (
			<Cell
				key={i}
				agent={a}
				imageUrl={imgFor(a?._id)}
				era={eraFor(a?._id)}
				displayYear={yearForCell}
				hideRuntimeBadges={!liveMode}
				emotionOverlay={emotionOverlay}
				emotionReading={emotionFor(a?._id, yearForCell)}
				emotionDefs={emotionDefs ?? null}
			/>
		);
	};

	const agentColors: Record<string, string> = {};
	{
		const palette = [
			"#c84a3a",
			"#7ea96a",
			"#f4c95d",
			"#5b6f8a",
			"#7a4ea3",
			"#3a6e8f",
			"#d99aa8",
			"#3d3d3d",
		];
		individuals.forEach((a, i) => {
			agentColors[a._id] = palette[i] ?? "#1c1917";
		});
	}

	return (
		<main className="flex flex-col h-[calc(100vh-65px)] overflow-hidden">
			<header className="px-6 py-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-200 bg-stone-50/60 shrink-0">
				<div className="flex items-baseline gap-4 min-w-0">
					<h1 className="font-serif text-2xl text-stone-900 tracking-tight truncate">
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
					<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400 hidden md:inline">
						y{minYear === maxYear ? minYear : `${minYear}–${maxYear}`}
						{" · "}gathering every {cohort.gatheringEveryNYears}y
					</span>
				</div>
				<div className="flex items-center gap-3">
					{activeGathering && (
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700 animate-pulse">
							● gathering · y{activeGathering.year} ·{" "}
							{activeGathering.status}
						</span>
					)}
					<button
						type="button"
						onClick={() => setEmotionOverlay((v) => !v)}
						className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] border ${emotionOverlay ? "bg-stone-900 text-stone-50 border-stone-900" : "border-stone-300 hover:bg-stone-100"}`}
					>
						{emotionOverlay ? "● emotions" : "emotions"}
					</button>
					<button
						type="button"
						onClick={onCreate}
						className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] border border-stone-300 hover:bg-stone-100"
					>
						+ new cohort
					</button>
				</div>
			</header>

			<div className="flex-1 min-h-0 flex items-center justify-center p-4 pb-20">
				<div
					className="grid grid-cols-3 grid-rows-3 gap-3"
					style={{
						width: "min(100%, calc(100vh - 180px))",
						height: "min(100%, calc(100vh - 180px))",
						aspectRatio: "1 / 1",
					}}
				>
					{[0, 1, 2, 3].map(renderCell)}
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
						emotionOverlay={emotionOverlay}
						individuals={individuals}
						cohortEmotions={cohortLatestEmotions}
						emotionDefs={emotionDefs ?? null}
						agentColors={agentColors}
						onOpenConversations={() => setConversationsOpen(true)}
					/>
					{[4, 5, 6, 7].map(renderCell)}
				</div>
			</div>

			{liveMode && activeGathering && (
				<GatheringFloatingPanel
					gatheringId={activeGathering._id}
					agents={agents}
				/>
			)}

			{conversationsOpen && (
				<ConversationsModal
					commonsName={commons?.name ?? cohort.name}
					gatherings={gatherings}
					agents={agents}
					onClose={() => setConversationsOpen(false)}
				/>
			)}

			<PrefetchYears
				cohortId={cohortId}
				baseYear={scrubYear ?? maxYear}
				maxYear={maxYear}
			/>

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
	displayYear,
	hideRuntimeBadges = false,
	emotionOverlay = false,
	emotionReading = null,
	emotionDefs = null,
}: {
	agent: Doc<"agents"> | undefined;
	imageUrl: string | null;
	era: Doc<"eraLabels"> | null;
	displayYear: number;
	hideRuntimeBadges?: boolean;
	emotionOverlay?: boolean;
	emotionReading?: Doc<"emotionalReadings"> | null;
	emotionDefs?: EmotionDef[] | null;
}) {
	if (!agent) {
		return <div className="bg-stone-100 border border-stone-200" />;
	}
	const waiting = !hideRuntimeBadges && Boolean(agent.gatheringWait);
	const beingBorn =
		!hideRuntimeBadges && agent.genesisStatus === "pending";
	return (
		<Link
			to="/agents/$agentId"
			params={{ agentId: agent._id }}
			className="group relative bg-stone-100 border border-stone-200 overflow-hidden block hover:border-stone-500 transition-colors"
		>
			{emotionOverlay ? (
				<EmotionRadarFill
					reading={emotionReading}
					definitions={emotionDefs}
				/>
			) : imageUrl ? (
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
			<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-900/85 via-stone-900/40 to-transparent px-3 py-2">
				<div className="flex items-baseline justify-between gap-2">
					<div className="font-serif text-lg text-stone-50 leading-tight truncate">
						{agent.name}
					</div>
					<div className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-300 tabular-nums">
						y{displayYear}
					</div>
				</div>
				{era && (
					<div className="mt-0.5 font-serif italic text-stone-200/90 text-[11px] truncate">
						{era.label}
					</div>
				)}
			</div>
			{waiting && (
				<div className="absolute top-2 right-2 px-2 py-1 bg-amber-500/90 text-stone-900 font-mono text-[9px] uppercase tracking-[0.18em]">
					waiting
				</div>
			)}
			{beingBorn && (
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
	displayYear,
	emotionOverlay = false,
	individuals = [],
	cohortEmotions = null,
	emotionDefs = null,
	agentColors = {},
	onOpenConversations,
}: {
	agent: Doc<"agents"> | null;
	imageUrl: string | null;
	gatheringCount: number;
	activeGathering: Doc<"gatherings"> | null;
	displayYear: number;
	emotionOverlay?: boolean;
	individuals?: Doc<"agents">[];
	cohortEmotions?: Record<string, Doc<"emotionalReadings"> | null> | null;
	emotionDefs?: EmotionDef[] | null;
	agentColors?: Record<string, string>;
	onOpenConversations?: () => void;
}) {
	if (!agent) {
		return <div className="bg-stone-100 border border-stone-200" />;
	}
	return (
		<button
			type="button"
			onClick={onOpenConversations}
			className={`relative bg-stone-100 border-2 ${activeGathering ? "border-amber-500" : "border-stone-900"} overflow-hidden block w-full h-full text-left hover:border-stone-700 transition-colors cursor-pointer`}
		>
			{emotionOverlay ? (
				<EightVectorOverview
					individuals={individuals}
					cohortEmotions={cohortEmotions}
					definitions={emotionDefs}
					agentColors={agentColors}
				/>
			) : imageUrl ? (
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
			<div className="absolute inset-x-0 top-0 bg-gradient-to-b from-stone-900/85 to-transparent px-3 py-2">
				<div className="flex items-baseline justify-between gap-2">
					<div className="font-serif text-base text-stone-50 leading-tight italic truncate">
						{agent.name}
					</div>
					<div className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-300 tabular-nums">
						y{displayYear} · {gatheringCount}×
					</div>
				</div>
			</div>
			{activeGathering && (
				<div className="absolute inset-x-0 bottom-0 bg-amber-500/95 px-2 py-1.5 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-stone-900 animate-pulse">
					{activeGathering.status === "running"
						? `gathering · y${activeGathering.year}`
						: `synthesizing · y${activeGathering.year}`}
				</div>
			)}
		</button>
	);
}

// Live gathering panel that floats over the right edge above the bottom bar
// so it doesn't push the grid out of place.
function GatheringFloatingPanel({
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
	const sorted = [...detail.breakouts].sort((a, b) => a.round - b.round);
	const latest = sorted[sorted.length - 1];
	return (
		<div className="fixed right-4 bottom-20 z-30 w-[360px] max-w-[calc(100vw-2rem)] border border-amber-300 bg-amber-50/95 shadow-xl backdrop-blur-sm">
			<div className="px-3 py-2 border-b border-amber-200 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-900 flex items-baseline justify-between">
				<span>● gathering · y{detail.gathering.year}</span>
				<span className="text-amber-700">
					round {latest?.round ?? "?"} ·{" "}
					{latest?.round === 1
						? "pairs"
						: latest?.round === 2
							? "fours"
							: "all eight"}
				</span>
			</div>
			<div className="p-3 max-h-64 overflow-y-auto">
				{!latest && (
					<div className="font-serif italic text-amber-600 text-xs">
						(waiting…)
					</div>
				)}
				{latest && (
					<div className="space-y-2">
						<div className="font-mono text-[9px] uppercase tracking-[0.18em] text-amber-600">
							{latest.participantIds.map(nameOf).join(" · ")}
						</div>
						<div className="space-y-1">
							{latest.transcript.map((u, i) => (
								<div key={i} className="text-xs leading-snug">
									<span className="font-mono text-amber-800">
										{nameOf(u.agentId)}:
									</span>{" "}
									<span className="font-serif text-stone-800">
										{u.text}
									</span>
								</div>
							))}
							{latest.transcript.length === 0 && (
								<div className="font-serif italic text-amber-600 text-xs">
									(silent…)
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function ConversationsModal({
	commonsName,
	gatherings,
	agents,
	onClose,
}: {
	commonsName: string;
	gatherings: Doc<"gatherings">[];
	agents: Doc<"agents">[];
	onClose: () => void;
}) {
	const sorted = useMemo(
		() => [...gatherings].sort((a, b) => a.year - b.year),
		[gatherings],
	);
	const [selectedId, setSelectedId] = useState<Id<"gatherings"> | null>(
		sorted[sorted.length - 1]?._id ?? null,
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const selected = sorted.find((g) => g._id === selectedId) ?? null;

	return (
		<div
			className="fixed inset-0 z-40 bg-stone-900/70 backdrop-blur-sm flex items-center justify-center p-4"
			onClick={onClose}
		>
			<div
				className="bg-stone-50 border border-stone-300 shadow-xl w-full max-w-5xl h-[80vh] flex flex-col"
				onClick={(e) => e.stopPropagation()}
			>
				<header className="px-5 py-3 border-b border-stone-200 flex items-baseline justify-between gap-3 shrink-0">
					<div className="flex items-baseline gap-3 min-w-0">
						<h2 className="font-serif text-xl text-stone-900 italic truncate">
							{commonsName}
						</h2>
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
							gatherings · {sorted.length}
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500 hover:text-stone-900"
					>
						close ✕
					</button>
				</header>

				{sorted.length === 0 ? (
					<div className="flex-1 flex items-center justify-center font-serif italic text-stone-500">
						No gatherings yet.
					</div>
				) : (
					<div className="flex-1 min-h-0 grid grid-cols-[200px_1fr]">
						<aside className="border-r border-stone-200 overflow-y-auto bg-stone-100/50">
							{sorted.map((g) => (
								<button
									key={g._id}
									type="button"
									onClick={() => setSelectedId(g._id)}
									className={`w-full text-left px-4 py-3 border-b border-stone-200 font-mono text-[11px] tracking-[0.1em] uppercase ${
										selectedId === g._id
											? "bg-stone-900 text-stone-50"
											: "text-stone-700 hover:bg-stone-200/70"
									}`}
								>
									<div className="tabular-nums">y{g.year}</div>
									<div
										className={`text-[9px] mt-0.5 ${
											selectedId === g._id
												? "text-stone-300"
												: "text-stone-500"
										}`}
									>
										{g.status}
									</div>
								</button>
							))}
						</aside>
						<section className="overflow-y-auto">
							{selected && (
								<GatheringTranscriptView
									gatheringId={selected._id}
									agents={agents}
								/>
							)}
						</section>
					</div>
				)}
			</div>
		</div>
	);
}

function GatheringTranscriptView({
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

	if (!detail) {
		return (
			<div className="p-6 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
				loading…
			</div>
		);
	}

	const sorted = [...detail.breakouts].sort((a, b) => a.round - b.round);
	const roundLabel = (round: number) =>
		round === 1 ? "pairs" : round === 2 ? "fours" : "all eight";

	return (
		<div className="p-6 space-y-6">
			<div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500 flex items-center gap-3">
				<span>y{detail.gathering.year}</span>
				<span>·</span>
				<span>{detail.gathering.status}</span>
				{detail.gathering.costUsd !== undefined && (
					<>
						<span>·</span>
						<span>${detail.gathering.costUsd.toFixed(3)}</span>
					</>
				)}
			</div>
			{sorted.length === 0 && (
				<div className="font-serif italic text-stone-500">
					(no breakouts yet)
				</div>
			)}
			{sorted.map((b) => (
				<div key={b._id} className="space-y-2">
					<div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-700 border-b border-stone-200 pb-1 flex items-baseline justify-between">
						<span>
							round {b.round} · {roundLabel(b.round)}
						</span>
						<span className="text-stone-500">
							{b.participantIds.map(nameOf).join(" · ")}
						</span>
					</div>
					<div className="space-y-1.5 pl-1">
						{b.transcript.length === 0 && (
							<div className="font-serif italic text-stone-400 text-sm">
								(silent…)
							</div>
						)}
						{b.transcript.map((u, i) => (
							<div key={i} className="text-sm leading-relaxed">
								<span className="font-mono text-[11px] text-stone-700">
									{nameOf(u.agentId)}:
								</span>{" "}
								<span className="font-serif text-stone-900">
									{u.text}
								</span>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

// Hidden prefetcher: subscribes to the next 4 years of stateAtYear so that
// scrubbing forward hits Convex's client cache instead of waiting on a
// round-trip. Subscriptions are kept alive as long as this component renders.
function PrefetchYears({
	cohortId,
	baseYear,
	maxYear,
}: {
	cohortId: Id<"cohorts">;
	baseYear: number;
	maxYear: number;
}) {
	const cap = Math.max(maxYear, baseYear);
	const years = [1, 2, 3, 4]
		.map((d) => baseYear + d)
		.filter((y) => y <= cap);
	return (
		<>
			{years.map((y) => (
				<PrefetchOne key={y} cohortId={cohortId} year={y} />
			))}
		</>
	);
}

function PrefetchOne({
	cohortId,
	year,
}: {
	cohortId: Id<"cohorts">;
	year: number;
}) {
	useQuery(api.cohort.stateAtYear, { cohortId, year });
	return null;
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
	const yearMax = Math.max(maxYear, 28);
	const displayYear = scrubYear ?? maxYear;
	const gatheringYearSet = new Set(gatheringYears);
	const handleScrub = (y: number) => {
		if (y >= maxYear) onLive();
		else onScrub(y);
	};
	return (
		<div className="fixed bottom-0 inset-x-0 bg-stone-900 text-stone-50 z-20 border-t border-stone-700">
			<div className="mx-auto max-w-7xl px-6 py-2.5 flex flex-wrap items-center gap-6">
				<div className="flex items-center gap-2 min-w-[120px]">
					<button
						type="button"
						onClick={onLive}
						title={liveMode ? "rolling with live time" : "snap to now"}
						className={`px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${liveMode ? "bg-stone-50 text-stone-900 animate-pulse" : "border border-stone-600 text-stone-300 hover:bg-stone-800"}`}
					>
						{liveMode ? "● live" : "↦ live"}
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
							onChange={(e) => handleScrub(Number(e.target.value))}
							className="w-full accent-stone-50"
						/>
						{maxYear < yearMax && (
							<div
								className="absolute top-1/2 -translate-y-1/2 h-1 bg-stone-50/10 pointer-events-none"
								style={{
									left: `${(maxYear / yearMax) * 100}%`,
									right: 0,
								}}
							/>
						)}
						<div
							className="absolute top-0 bottom-0 w-px bg-stone-50/40 pointer-events-none"
							style={{ left: `${(maxYear / yearMax) * 100}%` }}
							aria-hidden
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

// ---------- Emotion overlay visuals ----------
// Mirrors the radar + vector-room visuals from
// src/routes/agents/$agentId/personality.tsx, compacted to fit grid cells.

function EmotionRadarFill({
	reading,
	definitions,
}: {
	reading: Doc<"emotionalReadings"> | null;
	definitions: EmotionDef[] | null;
}) {
	if (!definitions) {
		return (
			<div className="w-full h-full flex items-center justify-center bg-stone-50 text-stone-400 font-mono text-[9px] uppercase tracking-[0.18em]">
				loading…
			</div>
		);
	}
	if (!reading) {
		return (
			<div className="w-full h-full flex items-center justify-center bg-stone-50 text-stone-400 font-mono text-[9px] uppercase tracking-[0.18em]">
				no reading
			</div>
		);
	}
	const e = (reading.emotions ?? {}) as Record<string, number>;
	const W = 200;
	const H = 200;
	const cx = W / 2;
	const cy = H / 2;
	const r = 78;
	const n = definitions.length;
	const points = definitions.map((d, i) => {
		const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
		const v = Math.max(0, Math.min(1, e[d.key] ?? 0));
		return {
			def: d,
			value: v,
			px: cx + Math.cos(angle) * r * v,
			py: cy + Math.sin(angle) * r * v,
			ax: cx + Math.cos(angle) * r,
			ay: cy + Math.sin(angle) * r,
			angle,
		};
	});
	const grid = [0.33, 0.66, 1].map((g) =>
		definitions
			.map((_, i) => {
				const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
				return `${(cx + Math.cos(angle) * r * g).toFixed(2)},${(cy + Math.sin(angle) * r * g).toFixed(2)}`;
			})
			.join(" "),
	);
	const dominantHex =
		definitions.find((d) => d.key === reading.dominantEmotion)?.hex ?? "#1c1917";
	return (
		<div className="w-full h-full bg-stone-50 flex items-center justify-center">
			<svg
				viewBox={`0 0 ${W} ${H}`}
				className="w-full h-full block"
				role="img"
				aria-label="emotion radar"
			>
				<title>emotion radar</title>
				{grid.map((g, i) => (
					<polygon
						// biome-ignore lint/suspicious/noArrayIndexKey: ring index is stable
						key={`g-${i}`}
						points={g}
						fill="none"
						stroke="#e7e5e4"
						strokeWidth={0.75}
					/>
				))}
				{points.map((p) => (
					<line
						key={`r-${p.def.key}`}
						x1={cx}
						y1={cy}
						x2={p.ax}
						y2={p.ay}
						stroke="#f5f5f4"
						strokeWidth={0.6}
					/>
				))}
				<polygon
					points={points
						.map((p) => `${p.px.toFixed(2)},${p.py.toFixed(2)}`)
						.join(" ")}
					fill={dominantHex}
					fillOpacity={0.18}
					stroke={dominantHex}
					strokeWidth={1.2}
				/>
				{points.map((p) => (
					<circle
						key={`p-${p.def.key}`}
						cx={p.px}
						cy={p.py}
						r={2.2}
						fill={p.def.hex}
						stroke="#1c1917"
						strokeWidth={0.4}
					/>
				))}
			</svg>
		</div>
	);
}

function EightVectorOverview({
	individuals,
	cohortEmotions,
	definitions,
	agentColors,
}: {
	individuals: Doc<"agents">[];
	cohortEmotions: Record<string, Doc<"emotionalReadings"> | null> | null;
	definitions: EmotionDef[] | null;
	agentColors: Record<string, string>;
}) {
	const [yaw, setYaw] = useState(-0.55);
	const [pitch, setPitch] = useState(-0.35);
	const dragging = useRef<{ x: number; y: number } | null>(null);

	if (!definitions || !cohortEmotions) {
		return (
			<div className="w-full h-full flex items-center justify-center bg-stone-50 text-stone-400 font-mono text-[10px] uppercase tracking-[0.2em]">
				loading…
			</div>
		);
	}

	const W = 320;
	const H = 320;
	const cx = W / 2;
	const cy = H / 2;
	const scale = 95;

	const corners: [number, number, number][] = [
		[-1, -1, -1],
		[1, -1, -1],
		[1, 1, -1],
		[-1, 1, -1],
		[-1, -1, 1],
		[1, -1, 1],
		[1, 1, 1],
		[-1, 1, 1],
	];
	const edges: [number, number][] = [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 0],
		[4, 5],
		[5, 6],
		[6, 7],
		[7, 4],
		[0, 4],
		[1, 5],
		[2, 6],
		[3, 7],
	];

	function project([x, y, z]: [number, number, number]) {
		const cyA = Math.cos(yaw);
		const syA = Math.sin(yaw);
		const x1 = cyA * x + syA * z;
		const z1 = -syA * x + cyA * z;
		const cp = Math.cos(pitch);
		const sp = Math.sin(pitch);
		const y1 = cp * y - sp * z1;
		const z2 = sp * y + cp * z1;
		return { sx: cx + x1 * scale, sy: cy + y1 * scale, depth: z2 };
	}

	const projectedCorners = corners.map(project);
	const origin = project([0, 0, 0]);

	const axisEnds: {
		label: string;
		to: [number, number, number];
		tone: string;
	}[] = [
		{ label: "anger", to: [1.1, 0, 0], tone: "#c84a3a" },
		{ label: "optimism", to: [-1.1, 0, 0], tone: "#7ea96a" },
		{ label: "grief", to: [0, 1.1, 0], tone: "#5b6f8a" },
		{ label: "joy", to: [0, -1.1, 0], tone: "#f4c95d" },
		{ label: "fear", to: [0, 0, 1.1], tone: "#3d3d3d" },
		{ label: "ego", to: [0, 0, -1.1], tone: "#7a4ea3" },
	];

	const points = individuals
		.map((a) => {
			const r = cohortEmotions[a._id];
			if (!r) return null;
			const e = (r.emotions ?? {}) as Record<string, number>;
			const x = (e.anger ?? 0) - (e.optimism ?? 0);
			const y = (e.grief ?? 0) - (e.joy ?? 0);
			const z = (e.fear ?? 0) - (e.ego ?? 0);
			const intel = e.intelligence ?? 0;
			const tender = e.tenderness ?? 0;
			return {
				agent: a,
				p: project([x, y, z]),
				size: 3 + intel * 5,
				glow: tender,
				color: agentColors[a._id] ?? "#1c1917",
			};
		})
		.filter((x): x is NonNullable<typeof x> => x !== null)
		.sort((a, b) => b.p.depth - a.p.depth);

	function onMouseDown(ev: React.MouseEvent) {
		ev.preventDefault();
		dragging.current = { x: ev.clientX, y: ev.clientY };
	}
	function onMouseMove(ev: React.MouseEvent) {
		if (!dragging.current) return;
		ev.preventDefault();
		const dx = ev.clientX - dragging.current.x;
		const dy = ev.clientY - dragging.current.y;
		dragging.current = { x: ev.clientX, y: ev.clientY };
		setYaw((y) => y + dx * 0.008);
		setPitch((p) =>
			Math.max(
				-Math.PI / 2 + 0.05,
				Math.min(Math.PI / 2 - 0.05, p + dy * 0.008),
			),
		);
	}
	function onMouseUp() {
		dragging.current = null;
	}

	return (
		<div className="w-full h-full bg-stone-50 flex items-center justify-center">
			<svg
				viewBox={`0 0 ${W} ${H}`}
				className="w-full h-full block select-none cursor-grab active:cursor-grabbing"
				role="img"
				aria-label="cohort emotional vectors"
				onMouseDown={onMouseDown}
				onMouseMove={onMouseMove}
				onMouseUp={onMouseUp}
				onMouseLeave={onMouseUp}
				onClick={(e) => e.preventDefault()}
			>
				<title>cohort emotional vectors</title>
				<defs>
					<radialGradient id="commons-halo" cx="50%" cy="50%" r="50%">
						<stop offset="0%" stopColor="white" stopOpacity="0.55" />
						<stop offset="100%" stopColor="white" stopOpacity="0" />
					</radialGradient>
				</defs>
				{edges.map(([a, b], i) => {
					const A = projectedCorners[a];
					const B = projectedCorners[b];
					return (
						<line
							// biome-ignore lint/suspicious/noArrayIndexKey: edges array is stable
							key={`edge-${i}`}
							x1={A.sx}
							y1={A.sy}
							x2={B.sx}
							y2={B.sy}
							stroke="#d6d3d1"
							strokeWidth={0.8}
						/>
					);
				})}
				{axisEnds.map((a) => {
					const to = project(a.to);
					return (
						<g key={a.label}>
							<line
								x1={origin.sx}
								y1={origin.sy}
								x2={to.sx}
								y2={to.sy}
								stroke={a.tone}
								strokeOpacity={0.5}
								strokeWidth={0.8}
								strokeDasharray="2 3"
							/>
							<text
								x={to.sx}
								y={to.sy}
								dx={4}
								dy={3}
								fontSize={8}
								className="font-mono"
								fill={a.tone}
								fillOpacity={0.85}
							>
								{a.label}
							</text>
						</g>
					);
				})}
				{points.map((pt) => (
					<g key={pt.agent._id}>
						{pt.glow > 0.05 && (
							<circle
								cx={pt.p.sx}
								cy={pt.p.sy}
								r={pt.size + 5 + pt.glow * 9}
								fill="url(#commons-halo)"
								opacity={0.4 + pt.glow * 0.5}
							/>
						)}
						<circle
							cx={pt.p.sx}
							cy={pt.p.sy}
							r={pt.size}
							fill={pt.color}
							stroke="#1c1917"
							strokeWidth={0.6}
						/>
						<text
							x={pt.p.sx + pt.size + 2}
							y={pt.p.sy + 2}
							fontSize={7}
							className="font-mono"
							fill="#44403c"
						>
							{pt.agent.name}
						</text>
					</g>
				))}
			</svg>
		</div>
	);
}
