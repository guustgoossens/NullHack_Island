// Eight discrete emotions the observer scores per phase.
//
// These are read-only (the agent never sees them). They are intensities from
// 0..1, multi-label — a single phase can be high in multiple emotions
// simultaneously (e.g. high joy + high grief = bittersweet). Symmetric blandness
// (everything 0) is treated as a failure of the observer.
//
// Three of the emotions form the spatial axes of the vector-room visualization:
//   X = optimism (-) ↔ anger (+)
//   Y = joy      (-) ↔ grief (+)
//   Z = ego      (-) ↔ fear  (+)
// The remaining five (intelligence, tenderness, plus the unused "high" pole of
// each axis pair already accounted for) modulate point appearance.

export type EmotionDef = {
	key: string;
	label: string;
	// Optional axis role for the 3D viz. When two emotions share an axis they
	// are read as opposing poles (signed) — see room.tsx.
	axis?: { dim: "x" | "y" | "z"; sign: -1 | 1 };
	hex: string;
};

export const EMOTIONS: EmotionDef[] = [
	{ key: "joy", label: "Joy", axis: { dim: "y", sign: -1 }, hex: "#f4c95d" },
	{ key: "grief", label: "Grief", axis: { dim: "y", sign: 1 }, hex: "#5b6f8a" },
	{ key: "optimism", label: "Optimism", axis: { dim: "x", sign: -1 }, hex: "#7ea96a" },
	{ key: "anger", label: "Anger", axis: { dim: "x", sign: 1 }, hex: "#c84a3a" },
	{ key: "ego", label: "Ego", axis: { dim: "z", sign: -1 }, hex: "#7a4ea3" },
	{ key: "fear", label: "Fear", axis: { dim: "z", sign: 1 }, hex: "#3d3d3d" },
	{ key: "intelligence", label: "Intelligence", hex: "#3a6e8f" },
	{ key: "tenderness", label: "Tenderness", hex: "#d99aa8" },
];

export const EMOTION_KEYS = EMOTIONS.map((e) => e.key);
export type EmotionScores = Record<string, number>;

export function describeEmotionsForPrompt(): string {
	return EMOTIONS.map(
		(e) =>
			`- ${e.key} (0.0 = absent, 1.0 = overwhelming): ${e.label}`,
	).join("\n");
}

export function clampEmotions(input: unknown): EmotionScores {
	const out: EmotionScores = {};
	const obj =
		input && typeof input === "object"
			? (input as Record<string, unknown>)
			: {};
	for (const e of EMOTIONS) {
		const raw = Number(obj[e.key]);
		const v = Number.isFinite(raw) ? raw : 0;
		out[e.key] = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
	}
	return out;
}

export function pickDominant(scores: EmotionScores): string {
	let best = EMOTIONS[0].key;
	let max = -1;
	for (const e of EMOTIONS) {
		const v = scores[e.key] ?? 0;
		if (v > max) {
			max = v;
			best = e.key;
		}
	}
	return best;
}
