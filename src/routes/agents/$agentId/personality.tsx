import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { pca } from "../../../lib/pca";

export const Route = createFileRoute("/agents/$agentId/personality")({
	component: PersonalityPage,
});

function PersonalityPage() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const agent = useQuery(api.agents.get, { agentId });
	const axes = useQuery(api.personality.axes, {});
	const scores = useQuery(api.personality.list, { agentId });

	const ready = !!agent && !!axes && !!scores;

	const computed = useMemo(() => {
		if (!ready || !axes || !scores) return null;
		if (scores.length < 2) return null;
		const matrix = scores.map((row) =>
			axes.map((a) => Number((row.scores as Record<string, number>)[a.key] ?? 5)),
		);
		const result = pca(matrix);
		return result;
	}, [ready, axes, scores]);

	if (!agent) return null;

	return (
		<main className="mx-auto max-w-6xl px-6 py-10 space-y-12">
			<header>
				<h1 className="font-serif text-4xl text-stone-900 leading-tight">
					Personality drift
				</h1>
				<p className="font-serif italic text-stone-600 mt-2 max-w-2xl">
					Eight axes, scored each year by a small assessment model. The trajectory below
					is the agent's path through PCA space (eigendecomposition of the centered
					score matrix). Drift over time is the whole point.
				</p>
			</header>

			{!scores || scores.length === 0 ? (
				<EmptyState
					title="No assessments yet"
					body={
						agent.genesisStatus === "ready"
							? "The first creation phase will produce a yearly score. Until then there's only the birth vector to plot."
							: "Self-genesis hasn't completed — the birth vector is still being chosen."
					}
				/>
			) : !computed ? (
				<EmptyState
					title="Need at least two assessments to fit a projection"
					body={`Currently have ${scores.length}. Run the agent through one creation phase and a second point will appear.`}
				/>
			) : (
				<>
					<TrajectoryChart
						scores={scores}
						projected={computed.projected}
						explained={computed.explained}
					/>

					<LoadingsTable
						components={computed.components.slice(0, 3)}
						explained={computed.explained.slice(0, 3)}
						axes={axes ?? []}
					/>

					<EvolutionGrid scores={scores} axes={axes ?? []} />
				</>
			)}
		</main>
	);
}

function EmptyState({ title, body }: { title: string; body: string }) {
	return (
		<div className="border border-stone-200 bg-stone-50 px-6 py-8">
			<h2 className="font-serif text-xl text-stone-900">{title}</h2>
			<p className="font-serif italic text-stone-600 mt-2 leading-relaxed">
				{body}
			</p>
		</div>
	);
}

function TrajectoryChart({
	scores,
	projected,
	explained,
}: {
	scores: Doc<"personalityScores">[];
	projected: number[][];
	explained: number[];
}) {
	// 2D scatter on PC1/PC2; PC3 modulates point radius.
	const xs = projected.map((p) => p[0]);
	const ys = projected.map((p) => p[1]);
	const zs = projected.map((p) => p[2] ?? 0);
	const xMin = Math.min(...xs);
	const xMax = Math.max(...xs);
	const yMin = Math.min(...ys);
	const yMax = Math.max(...ys);
	const zAbsMax = Math.max(0.1, ...zs.map(Math.abs));

	const W = 720;
	const H = 480;
	const padX = 40;
	const padY = 40;

	const dx = Math.max(0.001, xMax - xMin);
	const dy = Math.max(0.001, yMax - yMin);
	const px = (x: number) => padX + ((x - xMin) / dx) * (W - 2 * padX);
	const py = (y: number) => H - padY - ((y - yMin) / dy) * (H - 2 * padY);
	const pr = (z: number) => 5 + (Math.abs(z) / zAbsMax) * 8;

	const points = projected.map((p, i) => ({
		x: px(p[0]),
		y: py(p[1]),
		r: pr(p[2] ?? 0),
		year: scores[i].year,
		origin: scores[i].origin,
	}));

	const pathD = points
		.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
		.join(" ");

	return (
		<section>
			<div className="flex items-baseline justify-between mb-4">
				<h2 className="font-serif text-2xl text-stone-900">Trajectory in PC space</h2>
				<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
					PC1 · PC2 · radius=PC3
				</span>
			</div>
			<div className="border border-stone-200 bg-white p-4">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					className="w-full h-auto block"
					role="img"
					aria-label="PCA trajectory"
				>
					<title>PCA trajectory</title>
					{/* origin axes */}
					<line
						x1={px(0)}
						x2={px(0)}
						y1={padY}
						y2={H - padY}
						stroke="#e7e5e4"
						strokeDasharray="2 4"
					/>
					<line
						x1={padX}
						x2={W - padX}
						y1={py(0)}
						y2={py(0)}
						stroke="#e7e5e4"
						strokeDasharray="2 4"
					/>
					{/* trajectory line */}
					<path
						d={pathD}
						fill="none"
						stroke="#a8a29e"
						strokeWidth={1.5}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					{/* points */}
					{points.map((pt, i) => {
						const isLast = i === points.length - 1;
						const isBirth = pt.origin === "birth";
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: a year + index pair is the stable identity for one point in the trajectory
							<g key={`${pt.year}-${i}`}>
								<circle
									cx={pt.x}
									cy={pt.y}
									r={pt.r}
									fill={
										isBirth
											? "#fafaf9"
											: isLast
												? "#1c1917"
												: "#57534e"
									}
									stroke="#1c1917"
									strokeWidth={isBirth ? 1.2 : 0.6}
								/>
								<text
									x={pt.x + pt.r + 3}
									y={pt.y + 3}
									className="font-mono"
									fontSize={9}
									fill="#57534e"
								>
									y{pt.year}
								</text>
							</g>
						);
					})}
				</svg>
			</div>
			<p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
				explained variance — PC1 {(explained[0] * 100).toFixed(1)}% · PC2 {(explained[1] * 100).toFixed(1)}% · PC3 {((explained[2] ?? 0) * 100).toFixed(1)}%
			</p>
		</section>
	);
}

function LoadingsTable({
	components,
	explained,
	axes,
}: {
	components: number[][];
	explained: number[];
	axes: { key: string; label: string }[];
}) {
	return (
		<section>
			<h2 className="font-serif text-2xl text-stone-900 mb-4">
				What the components are made of
			</h2>
			<div className="overflow-x-auto border border-stone-200 bg-white">
				<table className="w-full text-sm">
					<thead className="border-b border-stone-200">
						<tr>
							<th className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
								axis
							</th>
							{components.map((_, i) => (
								<th
									// biome-ignore lint/suspicious/noArrayIndexKey: column index is the identity here
									key={`pc${i}`}
									className="text-right px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500"
								>
									PC{i + 1}
									<span className="ml-1 text-stone-400 normal-case">
										({(explained[i] * 100).toFixed(0)}%)
									</span>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{axes.map((a, axisIdx) => (
							<tr key={a.key} className="border-b border-stone-100 last:border-0">
								<td className="px-3 py-2 font-serif text-stone-700">{a.label}</td>
								{components.map((comp, ci) => {
									const v = comp[axisIdx] ?? 0;
									const intensity = Math.min(1, Math.abs(v));
									const bg =
										v >= 0
											? `rgba(15, 118, 110, ${intensity * 0.35})`
											: `rgba(190, 18, 60, ${intensity * 0.35})`;
									return (
										<td
											// biome-ignore lint/suspicious/noArrayIndexKey: column index is the identity
											key={`${a.key}-pc${ci}`}
											className="px-3 py-2 text-right font-mono text-xs tabular-nums"
											style={{ backgroundColor: bg }}
										>
											{v.toFixed(2)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function EvolutionGrid({
	scores,
	axes,
}: {
	scores: Doc<"personalityScores">[];
	axes: { key: string; label: string; low: string; high: string }[];
}) {
	if (scores.length === 0) return null;
	const W = 240;
	const H = 80;
	const pad = 6;

	const yearMin = scores[0].year;
	const yearMax = scores[scores.length - 1].year;
	const dyear = Math.max(1, yearMax - yearMin);

	return (
		<section>
			<h2 className="font-serif text-2xl text-stone-900 mb-4">
				Per-axis evolution
			</h2>
			<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
				{axes.map((axis) => {
					const series = scores.map((row) => ({
						year: row.year,
						value: Number(
							(row.scores as Record<string, number>)[axis.key] ?? 5,
						),
					}));
					const px = (year: number) =>
						pad + ((year - yearMin) / dyear) * (W - 2 * pad);
					const py = (v: number) => H - pad - ((v - 1) / 9) * (H - 2 * pad);
					const path = series
						.map(
							(s, i) =>
								`${i === 0 ? "M" : "L"} ${px(s.year).toFixed(2)} ${py(s.value).toFixed(2)}`,
						)
						.join(" ");

					return (
						<div
							key={axis.key}
							className="border border-stone-200 bg-white p-3"
						>
							<div className="flex items-baseline justify-between mb-1">
								<span className="font-serif text-stone-900 text-sm">
									{axis.label}
								</span>
								<span className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-400">
									{series[series.length - 1].value.toFixed(1)}
								</span>
							</div>
							<svg
								viewBox={`0 0 ${W} ${H}`}
								className="w-full h-20 block"
								role="img"
								aria-label={`${axis.label} over time`}
							>
								<title>{axis.label} over time</title>
								<line
									x1={pad}
									x2={W - pad}
									y1={py(5)}
									y2={py(5)}
									stroke="#e7e5e4"
									strokeDasharray="2 3"
								/>
								<path d={path} fill="none" stroke="#1c1917" strokeWidth={1.4} />
								{series.map((s, i) => (
									<circle
										// biome-ignore lint/suspicious/noArrayIndexKey: year is the stable identity here
										key={`${axis.key}-${s.year}-${i}`}
										cx={px(s.year)}
										cy={py(s.value)}
										r={2}
										fill="#1c1917"
									/>
								))}
							</svg>
							<div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-stone-400">
								<span>{axis.low}</span>
								<span>{axis.high}</span>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
