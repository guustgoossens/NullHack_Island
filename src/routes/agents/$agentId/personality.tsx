import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

export const Route = createFileRoute("/agents/$agentId/personality")({
	component: PersonalityPage,
});

type EmotionDef = {
	key: string;
	label: string;
	axis?: { dim: "x" | "y" | "z"; sign: -1 | 1 };
	hex: string;
};

function PersonalityPage() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const agent = useQuery(api.agents.get, { agentId });
	const definitions = useQuery(api.emotions.definitions, {});
	const readings = useQuery(api.emotions.list, { agentId });

	if (!agent) return null;

	return (
		<main className="mx-auto max-w-6xl px-6 py-10 space-y-12">
			<header>
				<h1 className="font-serif text-4xl text-stone-900 leading-tight">
					Vector room
				</h1>
				<p className="font-serif italic text-stone-600 mt-2 max-w-2xl leading-relaxed">
					An outside observer scores eight emotions after every phase. The room
					below is the agent's emotional state in space — three of the emotions
					form the walls (joy↔grief, optimism↔anger, ego↔fear); the other five
					colour, size, and halo each point. Drag to rotate.
				</p>
			</header>

			{!readings || !definitions ? null : readings.length === 0 ? (
				<EmptyState
					title="No readings yet"
					body={
						agent.genesisStatus === "ready"
							? "The next phase will produce the first emotional reading."
							: "Self-genesis hasn't completed — the agent has nothing to feel yet."
					}
				/>
			) : (
				<>
					<VectorRoom
						readings={readings}
						definitions={definitions as EmotionDef[]}
					/>
					<CurrentPanel
						readings={readings}
						definitions={definitions as EmotionDef[]}
					/>
					<RecentTimeline
						readings={readings}
						definitions={definitions as EmotionDef[]}
					/>
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

// ---------- 3D math ----------

type Reading = Doc<"emotionalReadings">;

function readingPosition(r: Reading): [number, number, number] {
	const e = (r.emotions ?? {}) as Record<string, number>;
	const x = (e.anger ?? 0) - (e.optimism ?? 0); // -1..1
	const y = (e.grief ?? 0) - (e.joy ?? 0);
	const z = (e.fear ?? 0) - (e.ego ?? 0);
	return [x, y, z];
}

function rotate(
	[x, y, z]: [number, number, number],
	yaw: number,
	pitch: number,
): [number, number, number] {
	// Yaw around Y, then pitch around X.
	const cy = Math.cos(yaw);
	const sy = Math.sin(yaw);
	const x1 = cy * x + sy * z;
	const z1 = -sy * x + cy * z;
	const cp = Math.cos(pitch);
	const sp = Math.sin(pitch);
	const y1 = cp * y - sp * z1;
	const z2 = sp * y + cp * z1;
	return [x1, y1, z2];
}

// ---------- Vector Room ----------

function VectorRoom({
	readings,
	definitions,
}: {
	readings: Reading[];
	definitions: EmotionDef[];
}) {
	const [yaw, setYaw] = useState(-0.55);
	const [pitch, setPitch] = useState(-0.35);
	const [hover, setHover] = useState<number | null>(null);
	const dragging = useRef<{ x: number; y: number } | null>(null);

	const W = 760;
	const H = 540;
	const cx = W / 2;
	const cy = H / 2;
	const scale = 170;

	const colorByKey = useMemo(() => {
		const m: Record<string, string> = {};
		for (const d of definitions) m[d.key] = d.hex;
		return m;
	}, [definitions]);

	// 8 cube corners — drawn as the room.
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

	function project([x, y, z]: [number, number, number]): {
		sx: number;
		sy: number;
		depth: number;
	} {
		const [rx, ry, rz] = rotate([x, y, z], yaw, pitch);
		return {
			sx: cx + rx * scale,
			sy: cy + ry * scale,
			depth: rz, // for z-ordering — higher = further back
		};
	}

	const projectedCorners = corners.map(project);

	// Axis ends.
	const axisEnds: {
		label: string;
		from: [number, number, number];
		to: [number, number, number];
		tone: string;
	}[] = [
		{ label: "anger", from: [0, 0, 0], to: [1.1, 0, 0], tone: "#c84a3a" },
		{ label: "optimism", from: [0, 0, 0], to: [-1.1, 0, 0], tone: "#7ea96a" },
		{ label: "grief", from: [0, 0, 0], to: [0, 1.1, 0], tone: "#5b6f8a" },
		{ label: "joy", from: [0, 0, 0], to: [0, -1.1, 0], tone: "#f4c95d" },
		{ label: "fear", from: [0, 0, 0], to: [0, 0, 1.1], tone: "#3d3d3d" },
		{ label: "ego", from: [0, 0, 0], to: [0, 0, -1.1], tone: "#7a4ea3" },
	];

	// Build trail in chronological order.
	const projected = readings.map((r) => {
		const pos = readingPosition(r);
		return { reading: r, pos, p: project(pos) };
	});

	// For draw-order, we want farther points behind nearer. Render readings
	// sorted by depth desc; tooltip etc. use original index.
	const drawOrder = projected
		.map((p, i) => ({ i, depth: p.p.depth }))
		.sort((a, b) => b.depth - a.depth)
		.map((x) => x.i);

	function pointSize(r: Reading): number {
		const e = (r.emotions ?? {}) as Record<string, number>;
		const intel = e.intelligence ?? 0;
		return 4 + intel * 9;
	}
	function pointGlow(r: Reading): number {
		const e = (r.emotions ?? {}) as Record<string, number>;
		const t = e.tenderness ?? 0;
		return t;
	}

	function onMouseDown(ev: React.MouseEvent) {
		dragging.current = { x: ev.clientX, y: ev.clientY };
	}
	function onMouseMove(ev: React.MouseEvent) {
		if (!dragging.current) return;
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

	const lastIdx = readings.length - 1;
	const trailD = projected
		.map(
			(p, i) =>
				`${i === 0 ? "M" : "L"} ${p.p.sx.toFixed(2)} ${p.p.sy.toFixed(2)}`,
		)
		.join(" ");

	return (
		<section>
			<div className="flex items-baseline justify-between mb-4">
				<h2 className="font-serif text-2xl text-stone-900">
					Where they are right now
				</h2>
				<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
					drag to rotate · {readings.length} readings
				</span>
			</div>
			<div className="border border-stone-200 bg-white">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					className="w-full h-auto block select-none cursor-grab active:cursor-grabbing"
					role="img"
					aria-label="3D emotional vector room"
					onMouseDown={onMouseDown}
					onMouseMove={onMouseMove}
					onMouseUp={onMouseUp}
					onMouseLeave={onMouseUp}
				>
					<title>3D emotional vector room</title>
					<defs>
						<radialGradient id="halo" cx="50%" cy="50%" r="50%">
							<stop offset="0%" stopColor="white" stopOpacity="0.55" />
							<stop offset="100%" stopColor="white" stopOpacity="0" />
						</radialGradient>
					</defs>

					{/* Room — 12 cube edges */}
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
								stroke="#e7e5e4"
								strokeWidth={1}
							/>
						);
					})}

					{/* Axes through origin */}
					{axisEnds.map((a) => {
						const from = project(a.from);
						const to = project(a.to);
						return (
							<g key={a.label}>
								<line
									x1={from.sx}
									y1={from.sy}
									x2={to.sx}
									y2={to.sy}
									stroke={a.tone}
									strokeOpacity={0.55}
									strokeWidth={1}
									strokeDasharray="3 3"
								/>
								<text
									x={to.sx}
									y={to.sy}
									dx={6}
									dy={3}
									fontSize={10}
									className="font-mono"
									fill={a.tone}
									fillOpacity={0.85}
								>
									{a.label}
								</text>
							</g>
						);
					})}

					{/* Trail polyline */}
					<path
						d={trailD}
						fill="none"
						stroke="#a8a29e"
						strokeWidth={1.2}
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeOpacity={0.55}
					/>

					{/* Points — drawn far → near for proper occlusion */}
					{drawOrder.map((i) => {
						const p = projected[i];
						const r = pointSize(p.reading);
						const glow = pointGlow(p.reading);
						const color = colorByKey[p.reading.dominantEmotion] ?? "#1c1917";
						const isLast = i === lastIdx;
						const isBirth = p.reading.year === 0;
						const opacity = 0.35 + (i / Math.max(1, lastIdx)) * 0.6;
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: SVG <g> is decorative; the parent <svg> carries role=img and the hover only drives a redundant inline tooltip
							<g
								key={p.reading._id}
								onMouseEnter={() => setHover(i)}
								onMouseLeave={() => setHover((h) => (h === i ? null : h))}
								style={{ cursor: "pointer" }}
							>
								{glow > 0.05 && (
									<circle
										cx={p.p.sx}
										cy={p.p.sy}
										r={r + 8 + glow * 14}
										fill="url(#halo)"
										opacity={0.4 + glow * 0.6}
									/>
								)}
								<circle
									cx={p.p.sx}
									cy={p.p.sy}
									r={r}
									fill={color}
									fillOpacity={isLast ? 1 : opacity}
									stroke={
										isBirth ? "#1c1917" : isLast ? "#1c1917" : "transparent"
									}
									strokeWidth={isBirth || isLast ? 1.2 : 0}
								/>
								{isLast && (
									<circle
										cx={p.p.sx}
										cy={p.p.sy}
										r={r + 4}
										fill="none"
										stroke={color}
										strokeOpacity={0.5}
										strokeWidth={1}
									>
										<animate
											attributeName="r"
											values={`${r + 2};${r + 12};${r + 2}`}
											dur="2.4s"
											repeatCount="indefinite"
										/>
										<animate
											attributeName="stroke-opacity"
											values="0.55;0;0.55"
											dur="2.4s"
											repeatCount="indefinite"
										/>
									</circle>
								)}
							</g>
						);
					})}
				</svg>
			</div>

			{/* Tooltip lives outside SVG so it can use real text wrapping */}
			{hover !== null && readings[hover] ? (
				<TooltipCard reading={readings[hover]} definitions={definitions} />
			) : (
				<p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
					hover a point — they're chronological, last reading is the pulsing one
				</p>
			)}
		</section>
	);
}

function TooltipCard({
	reading,
	definitions,
}: {
	reading: Reading;
	definitions: EmotionDef[];
}) {
	const e = (reading.emotions ?? {}) as Record<string, number>;
	const labelByKey = useMemo(() => {
		const m: Record<string, string> = {};
		for (const d of definitions) m[d.key] = d.label;
		return m;
	}, [definitions]);
	const top = [...definitions]
		.map((d) => ({ key: d.key, label: d.label, v: e[d.key] ?? 0, hex: d.hex }))
		.sort((a, b) => b.v - a.v)
		.slice(0, 3);
	return (
		<div className="mt-3 border border-stone-200 bg-stone-50 px-4 py-3">
			<div className="flex items-baseline justify-between gap-4">
				<div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
					year {reading.year}
				</div>
				<div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
					dominant:{" "}
					{labelByKey[reading.dominantEmotion] ?? reading.dominantEmotion}
				</div>
			</div>
			<p className="mt-2 font-serif italic text-stone-800 leading-snug">
				"{reading.salientPull}"
			</p>
			<div className="mt-2 flex gap-4">
				{top.map((t) => (
					<div key={t.key} className="flex items-center gap-1.5">
						<span
							className="inline-block w-2 h-2 rounded-full"
							style={{ backgroundColor: t.hex }}
						/>
						<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600">
							{t.label} {(t.v * 100).toFixed(0)}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

// ---------- Current state radar ----------

function CurrentPanel({
	readings,
	definitions,
}: {
	readings: Reading[];
	definitions: EmotionDef[];
}) {
	const latest = readings[readings.length - 1];
	if (!latest) return null;
	const e = (latest.emotions ?? {}) as Record<string, number>;

	const W = 360;
	const H = 360;
	const cx = W / 2;
	const cy = H / 2;
	const r = 130;

	const n = definitions.length;
	const points = definitions.map((d, i) => {
		const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
		const v = Math.max(0, Math.min(1, e[d.key] ?? 0));
		const px = cx + Math.cos(angle) * r * v;
		const py = cy + Math.sin(angle) * r * v;
		const lx = cx + Math.cos(angle) * (r + 22);
		const ly = cy + Math.sin(angle) * (r + 22);
		return { def: d, value: v, px, py, lx, ly, angle };
	});
	const grid = [0.25, 0.5, 0.75, 1].map((g) => {
		const ringPts = definitions.map((_, i) => {
			const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
			return `${(cx + Math.cos(angle) * r * g).toFixed(2)},${(cy + Math.sin(angle) * r * g).toFixed(2)}`;
		});
		return ringPts.join(" ");
	});

	return (
		<section>
			<div className="flex items-baseline justify-between mb-4">
				<h2 className="font-serif text-2xl text-stone-900">Current weather</h2>
				<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
					year {latest.year}
				</span>
			</div>
			<div className="grid lg:grid-cols-[auto,1fr] gap-8 items-start">
				<div className="border border-stone-200 bg-white p-2">
					<svg
						viewBox={`0 0 ${W} ${H}`}
						className="w-full h-auto max-w-[360px] block"
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
								x2={cx + Math.cos(p.angle) * r}
								y2={cy + Math.sin(p.angle) * r}
								stroke="#f5f5f4"
								strokeWidth={0.75}
							/>
						))}
						<polygon
							points={points
								.map((p) => `${p.px.toFixed(2)},${p.py.toFixed(2)}`)
								.join(" ")}
							fill="#1c1917"
							fillOpacity={0.08}
							stroke="#1c1917"
							strokeWidth={1.2}
						/>
						{points.map((p) => (
							<g key={`p-${p.def.key}`}>
								<circle
									cx={p.px}
									cy={p.py}
									r={3}
									fill={p.def.hex}
									stroke="#1c1917"
									strokeWidth={0.5}
								/>
								<text
									x={p.lx}
									y={p.ly}
									textAnchor={
										Math.cos(p.angle) > 0.2
											? "start"
											: Math.cos(p.angle) < -0.2
												? "end"
												: "middle"
									}
									dominantBaseline="middle"
									fontSize={10}
									className="font-mono uppercase tracking-[0.14em]"
									fill="#57534e"
								>
									{p.def.label}
								</text>
								<text
									x={p.lx}
									y={p.ly + 12}
									textAnchor={
										Math.cos(p.angle) > 0.2
											? "start"
											: Math.cos(p.angle) < -0.2
												? "end"
												: "middle"
									}
									dominantBaseline="middle"
									fontSize={9}
									className="font-mono tabular-nums"
									fill="#a8a29e"
								>
									{(p.value * 100).toFixed(0)}
								</text>
							</g>
						))}
					</svg>
				</div>
				<div className="space-y-4">
					<p className="font-serif italic text-stone-800 leading-relaxed text-lg">
						"{latest.salientPull}"
					</p>
					<div className="border-l-2 border-stone-300 pl-3">
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
							dominant
						</span>
						<div
							className="font-serif text-xl text-stone-900 mt-1"
							style={{
								color: definitions.find((d) => d.key === latest.dominantEmotion)
									?.hex,
							}}
						>
							{definitions.find((d) => d.key === latest.dominantEmotion)
								?.label ?? latest.dominantEmotion}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

// ---------- Recent timeline strip ----------

function RecentTimeline({
	readings,
	definitions,
}: {
	readings: Reading[];
	definitions: EmotionDef[];
}) {
	const colorByKey = useMemo(() => {
		const m: Record<string, string> = {};
		for (const d of definitions) m[d.key] = d.hex;
		return m;
	}, [definitions]);

	const tail = readings.slice(-30);

	return (
		<section>
			<div className="flex items-baseline justify-between mb-4">
				<h2 className="font-serif text-2xl text-stone-900">Recent pulls</h2>
				<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
					last {tail.length} years
				</span>
			</div>
			<ol className="space-y-2">
				{tail
					.slice()
					.reverse()
					.map((r) => (
						<li
							key={r._id}
							className="flex items-baseline gap-3 border-b border-stone-100 pb-2"
						>
							<span
								className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
								style={{
									backgroundColor: colorByKey[r.dominantEmotion] ?? "#a8a29e",
								}}
							/>
							<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 tabular-nums w-16 shrink-0">
								y{r.year}
							</span>
							<span className="font-serif italic text-stone-700 leading-snug">
								{r.salientPull || "—"}
							</span>
						</li>
					))}
			</ol>
		</section>
	);
}
