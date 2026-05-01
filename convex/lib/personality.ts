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
// agent has rewritten anything.
export const BLANK_ROOM_PROMPT = `An empty rectangular room with warm beige walls and a smooth ceiling, featuring thick white crown molding and large-scale architectural details. On the left wall, a large white-framed casement window with four panes allows soft, natural light to flood the space. The floor is made of light-toned hardwood planks with a subtle satin finish, bordered by prominent dark wood baseboards that provide a sharp contrast to the neutral walls. The overall atmosphere is clean, bright, and symmetrical, resembling a high-quality interior design "blank canvas".`;
