// Fixed 8-axis personality vector. Shared by self-genesis and the per-year
// assessment pass so all rows are commensurable for PCA.
//
// Each axis is rated 1..10. The scale is qualitative; only the *trajectory*
// across an agent's life is meaningful, not absolute values.

export type PersonalityAxis = {
	key: string;
	label: string;
	low: string;
	high: string;
};

export const PERSONALITY_AXES: PersonalityAxis[] = [
	{ key: "melancholy", label: "Melancholy", low: "joyful", high: "melancholic" },
	{ key: "romanticism", label: "Romanticism", low: "cynical", high: "romantic" },
	{ key: "austerity", label: "Austerity", low: "ornamented", high: "austere" },
	{ key: "intellectualism", label: "Intellect", low: "visceral", high: "intellectual" },
	{ key: "devotion", label: "Devotion", low: "ironic", high: "devout" },
	{ key: "eccentricity", label: "Eccentricity", low: "conventional", high: "eccentric" },
	{ key: "nostalgia", label: "Nostalgia", low: "futurist", high: "nostalgic" },
	{ key: "solitude", label: "Solitude", low: "social", high: "solitary" },
];

export const PERSONALITY_KEYS = PERSONALITY_AXES.map((a) => a.key);
export type PersonalityScores = Record<string, number>;

export function describeAxesForPrompt(): string {
	return PERSONALITY_AXES.map(
		(a) => `- ${a.key} (1=${a.low} ↔ 10=${a.high}): ${a.label}`,
	).join("\n");
}

export function clampScores(input: unknown): PersonalityScores {
	const out: PersonalityScores = {};
	const obj =
		input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	for (const a of PERSONALITY_AXES) {
		const raw = Number(obj[a.key]);
		const v = Number.isFinite(raw) ? raw : 5;
		out[a.key] = Math.max(1, Math.min(10, Math.round(v * 10) / 10));
	}
	return out;
}

// Hardcoded base prompt for the agent's first room. Used at birth before the
// agent has rewritten anything. Also serves as the spatial anchor: every
// subsequent room rewrite is rendered with this image as a visual reference,
// so POV and geometry stay locked across the lifetime — only interior design
// changes year over year.
//
// The wording here deliberately fixes camera, framing, walls, window, floor,
// and ceiling, and describes an empty room. The agent's prompt is appended to
// the *interior* only.
export const BLANK_ROOM_PROMPT = `An empty rectangular interior, photographed straight-on at standing eye-level. The camera is centered on the back wall and shows the room head-on with a slightly wide lens; the framing is symmetric. Neutral light-beige walls, a smooth white ceiling with thick white crown molding. A single large white-framed casement window with four panes sits on the left wall and floods the space with soft natural daylight. The floor is light-toned hardwood planks with dark wood baseboards. The room is otherwise completely empty: no furniture, no objects, no people. Clean, bright, calm.`;
