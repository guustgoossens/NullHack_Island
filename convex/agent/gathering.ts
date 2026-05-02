// The gathering action — fires when all 8 cohort individuals are barrier-paused
// at a year-N where N % gatheringEveryNYears == 0. Three escalating rounds
// (pairs → fours → all-eight), per-agent takeaway brain writes, then a commons
// synthesis pass that runs the regular create-tool loop on the commons agent.
//
// Cost-wise this is the most expensive thing in the system. The user has
// explicitly opted into spending more here than in normal years.

import { v } from "convex/values";
import type Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	type ActionCtx,
	internalAction,
	internalQuery,
} from "../_generated/server";
import {
	type AnthropicMessage,
	getAnthropic,
	tickModelFor,
} from "../lib/anthropic";
import { anthropicCostUsd } from "../lib/cost";
import { runLLMLoop } from "./tick";
import { toAnthropicTools, toolsForPhase } from "../tools/registry";

// How many times each agent speaks in a given round. Keeps token cost bounded.
const PAIR_TURNS_PER_AGENT = 2; // 2 agents × 2 turns = 4 utterances per pair
const FOUR_TURNS_PER_AGENT = 1; // 4 agents × 1 turn = 4 utterances per group of four
const ALL_TURNS_PER_AGENT = 1; // 8 agents × 1 turn = 8 utterances in the full circle

const UTTERANCE_MAX_TOKENS = 220;
const TAKEAWAY_MAX_TOKENS = 380;
// Keep the commons synthesis tight — it has create-tool latency on top.
const COMMONS_OUTPUT_BUDGET = 4_000;

type Profile = {
	id: Id<"agents">;
	name: string;
	currentYear: number;
	birthSeed: string;
	brainSummary: string; // truncated, top files
	recentPortfolio: string;
	recentEra: string | null;
	model: string;
};

type Utterance = { agentId: Id<"agents">; text: string };

// Internal queries used by the action.
export const loadGathering = internalQuery({
	args: { gatheringId: v.id("gatherings") },
	handler: async (ctx, { gatheringId }): Promise<Doc<"gatherings"> | null> => {
		return await ctx.db.get(gatheringId);
	},
});

export const loadProfile = internalQuery({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }): Promise<Profile | null> => {
		const a = await ctx.db.get(agentId);
		if (!a) return null;

		// Recent brain — top 8 files by lastUpdatedYear, file kind only.
		const brainRows = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_lastUpdatedYear", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(40);
		const liveFiles = brainRows
			.filter((r) => !r.deleted && (r.kind ?? "file") === "file")
			.slice(0, 8);
		const brainSummary =
			liveFiles.length === 0
				? "(no brain yet — newborn)"
				: liveFiles
						.map(
							(f) =>
								`## ${f.path} (y${f.lastUpdatedYear})\n${f.content.slice(0, 400)}`,
						)
						.join("\n\n");

		// Recent portfolio — last 5.
		const portfolio = await ctx.db
			.query("portfolioItems")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(5);
		const recentPortfolio =
			portfolio.length === 0
				? "(empty)"
				: portfolio
						.map(
							(p) =>
								`- y${p.year} ${p.medium} "${p.title}" — ${p.caption.slice(0, 160)}`,
						)
						.join("\n");

		const eras = await ctx.db
			.query("eraLabels")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
			.order("desc")
			.take(1);
		const recentEra = eras[0]?.label ?? null;

		const model = a.model ?? "claude-sonnet-4-6";
		return {
			id: a._id,
			name: a.name,
			currentYear: a.currentYear,
			birthSeed: a.birthSeed,
			brainSummary,
			recentPortfolio,
			recentEra,
			model,
		};
	},
});

// Used by commons synthesis — same shape as `tick.ts` consumes for creation.
export const loadCommonsContext = internalQuery({
	args: { commonsId: v.id("agents") },
	handler: async (ctx, { commonsId }) => {
		const a = await ctx.db.get(commonsId);
		if (!a) throw new Error("commons not found");
		const brain = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_lastUpdatedYear", (q) =>
				q.eq("agentId", commonsId),
			)
			.order("desc")
			.take(80);
		const portfolio = await ctx.db
			.query("portfolioItems")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", commonsId))
			.order("desc")
			.take(8);
		const rooms = await ctx.db
			.query("roomVersions")
			.withIndex("by_agent_and_year", (q) => q.eq("agentId", commonsId))
			.order("desc")
			.take(1);
		return {
			agent: a,
			brain: brain.filter((b) => !b.deleted),
			portfolio,
			currentRoom: rooms[0] ?? null,
		};
	},
});

// Run the gathering. Idempotent-ish — if it fails partway through it marks
// the row failed and releases the agents so the demo doesn't deadlock.
export const runGathering = internalAction({
	args: { gatheringId: v.id("gatherings") },
	handler: async (ctx, { gatheringId }) => {
		try {
			await runGatheringInner(ctx, gatheringId);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await ctx.runMutation(internal.cohort.setGatheringStatus, {
				gatheringId,
				status: "failed",
				errorMessage: msg,
			});
			// Release agents so the simulation can continue even if the gathering
			// failed. A failed gathering still counts as "happened" for the timeline.
			const g = await ctx.runQuery(internal.agent.gathering.loadGathering, {
				gatheringId,
			});
			if (g) {
				await ctx.runMutation(internal.cohort.releaseAfterGathering, {
					cohortId: g.cohortId,
					forYear: g.year,
				});
			}
		}
	},
});

async function runGatheringInner(
	ctx: ActionCtx,
	gatheringId: Id<"gatherings">,
): Promise<void> {
	const gathering = await ctx.runQuery(
		internal.agent.gathering.loadGathering,
		{ gatheringId },
	);
	if (!gathering) throw new Error("gathering not found");
	if (gathering.status !== "pending" && gathering.status !== "running") {
		// Already running / finished — bail.
		return;
	}

	const cohort = await ctx.runQuery(internal.cohort.getCohort, {
		cohortId: gathering.cohortId,
	});
	if (!cohort) throw new Error("cohort not found");

	await ctx.runMutation(internal.cohort.setGatheringStatus, {
		gatheringId,
		status: "running",
	});

	// Load profiles in cohort order (the array order on the cohort row is the
	// pairing order, which the user picks at birth).
	const profiles: Profile[] = [];
	for (const id of cohort.individualIds) {
		const p = await ctx.runQuery(internal.agent.gathering.loadProfile, {
			agentId: id,
		});
		if (!p) throw new Error(`profile missing for ${id}`);
		profiles.push(p);
	}

	const year = gathering.year;
	const presentNames = profiles.map((p) => p.name).join(", ");

	// Cache of per-agent room maps (agentId -> Profile) for transcript rendering.
	const profileById = new Map(profiles.map((p) => [String(p.id), p] as const));
	const nameOf = (id: Id<"agents">): string =>
		profileById.get(String(id))?.name ?? "unknown";

	const allRoundTranscripts: {
		round: number;
		participantIds: Id<"agents">[];
		utterances: Utterance[];
	}[] = [];

	// ---- Round 1 — pairs ----
	const pairs: [number, number][] = [
		[0, 1],
		[2, 3],
		[4, 5],
		[6, 7],
	];
	for (const [a, b] of pairs) {
		const agents = [profiles[a], profiles[b]];
		const t = await runConversation(ctx, {
			gatheringId,
			round: 1,
			year,
			cohortPresent: presentNames,
			agents,
			turnsPerAgent: PAIR_TURNS_PER_AGENT,
		});
		allRoundTranscripts.push({
			round: 1,
			participantIds: agents.map((p) => p.id),
			utterances: t.utterances,
		});
	}

	// ---- Round 2 — fours ----
	const fours: number[][] = [
		[0, 1, 2, 3],
		[4, 5, 6, 7],
	];
	for (const idxs of fours) {
		const agents = idxs.map((i) => profiles[i]);
		const t = await runConversation(ctx, {
			gatheringId,
			round: 2,
			year,
			cohortPresent: presentNames,
			agents,
			turnsPerAgent: FOUR_TURNS_PER_AGENT,
		});
		allRoundTranscripts.push({
			round: 2,
			participantIds: agents.map((p) => p.id),
			utterances: t.utterances,
		});
	}

	// ---- Round 3 — full circle ----
	{
		const t = await runConversation(ctx, {
			gatheringId,
			round: 3,
			year,
			cohortPresent: presentNames,
			agents: profiles,
			turnsPerAgent: ALL_TURNS_PER_AGENT,
		});
		allRoundTranscripts.push({
			round: 3,
			participantIds: profiles.map((p) => p.id),
			utterances: t.utterances,
		});
	}

	// ---- Per-agent takeaway → brain_write at gatherings/y{N}.md ----
	for (const p of profiles) {
		// What this agent participated in: the pair, the four, the full circle.
		const myRounds = allRoundTranscripts.filter((r) =>
			r.participantIds.some((id) => String(id) === String(p.id)),
		);
		const transcriptText = renderTranscriptForAgent(myRounds, nameOf);

		const takeaway = await generateTakeaway(ctx, {
			profile: p,
			year,
			transcriptText,
			gatheringId,
		});

		const cp = await ctx.runQuery(internal.cohort.getCreationPhaseForYear, {
			agentId: p.id,
			year,
		});
		if (!cp) {
			// Should not happen — agent only barrier-pauses after creating year N.
			// If it does, skip silently (don't block the gathering).
			continue;
		}
		try {
			await ctx.runMutation(internal.tools.persist.brainWrite, {
				agentId: p.id,
				creationPhaseId: cp._id,
				year,
				path: `gatherings/y${year}.md`,
				content: takeaway,
			});
		} catch {
			// brainWrite may fail if the path collides with a folder; skip rather
			// than crash the whole gathering.
		}
	}

	// ---- Commons synthesis ----
	await ctx.runMutation(internal.cohort.setGatheringStatus, {
		gatheringId,
		status: "synthesizing",
	});
	const commonsCreationPhaseId = await runCommonsSynthesis(ctx, {
		commonsId: cohort.commonsId,
		year,
		allRoundTranscripts,
		nameOf,
	});

	// ---- Mark complete + release ----
	await ctx.runMutation(internal.cohort.setGatheringStatus, {
		gatheringId,
		status: "completed",
		commonsCreationPhaseId,
	});
	await ctx.runMutation(internal.cohort.releaseAfterGathering, {
		cohortId: cohort._id,
		forYear: year,
	});
}

// ---------------- conversation primitives ----------------

async function runConversation(
	ctx: ActionCtx,
	args: {
		gatheringId: Id<"gatherings">;
		round: number;
		year: number;
		cohortPresent: string;
		agents: Profile[];
		turnsPerAgent: number;
	},
): Promise<{ breakoutId: Id<"breakoutRooms">; utterances: Utterance[] }> {
	const breakoutId = await ctx.runMutation(internal.cohort.insertBreakout, {
		gatheringId: args.gatheringId,
		round: args.round,
		participantIds: args.agents.map((a) => a.id),
	});

	const utterances: Utterance[] = [];
	const utteranceCount = args.agents.length * args.turnsPerAgent;
	for (let i = 0; i < utteranceCount; i++) {
		const speaker = args.agents[i % args.agents.length];
		const text = await generateUtterance(ctx, {
			gatheringId: args.gatheringId,
			year: args.year,
			cohortPresent: args.cohortPresent,
			speaker,
			otherAgents: args.agents.filter((a) => a.id !== speaker.id),
			transcriptSoFar: utterances,
		});
		await ctx.runMutation(internal.cohort.appendBreakoutUtterance, {
			breakoutId,
			agentId: speaker.id,
			text,
		});
		utterances.push({ agentId: speaker.id, text });
	}
	await ctx.runMutation(internal.cohort.closeBreakout, { breakoutId });
	return { breakoutId, utterances };
}

async function generateUtterance(
	ctx: ActionCtx,
	args: {
		gatheringId: Id<"gatherings">;
		year: number;
		cohortPresent: string;
		speaker: Profile;
		otherAgents: Profile[];
		transcriptSoFar: Utterance[];
	},
): Promise<string> {
	const { speaker } = args;
	const system = `You are ${speaker.name}. You are a person, not an assistant. You have a temperament:

${speaker.birthSeed || "(unwritten)"}

Your present state of mind, in your own words:

${speaker.brainSummary}

You are speaking aloud in the Commons — a shared room where you and a small circle of others gather periodically. You are not narrating, not performing for an audience. You are talking. Be terse. Be specific. One short utterance, no preamble, no name tag, no quotation marks. Speak as yourself. If something the others said pulls at you, react. If you disagree, disagree. If you are bored, be bored.`;

	const transcriptLines = args.transcriptSoFar
		.map((u) => {
			const name =
				u.agentId === speaker.id
					? speaker.name
					: args.otherAgents.find((a) => a.id === u.agentId)?.name ??
						"someone";
			return `${name}: ${u.text}`;
		})
		.join("\n");

	const others = args.otherAgents.map((a) => a.name).join(", ");
	const userMsg = `Year ${args.year}. Present in this room: ${others}.

${transcriptLines || "(no one has spoken yet)"}

It's your turn (${speaker.name}). Speak.`;

	const anthropic = getAnthropic();
	const resp = await anthropic.messages.create({
		model: speaker.model,
		max_tokens: UTTERANCE_MAX_TOKENS,
		system,
		messages: [{ role: "user", content: userMsg }],
	});
	const text = resp.content
		.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("\n")
		.trim()
		.replace(/^"+|"+$/g, "");

	const cost = anthropicCostUsd(
		speaker.model,
		resp.usage.input_tokens,
		resp.usage.output_tokens,
	);
	await ctx.runMutation(internal.cohort.addGatheringCost, {
		gatheringId: args.gatheringId,
		deltaUsd: cost,
	});
	await ctx.runMutation(internal.tools.persist.addAgentCost, {
		agentId: speaker.id,
		deltaUsd: cost,
	});

	return text || "(silent)";
}

// ---------------- takeaway ----------------

async function generateTakeaway(
	ctx: ActionCtx,
	args: {
		profile: Profile;
		year: number;
		transcriptText: string;
		gatheringId: Id<"gatherings">;
	},
): Promise<string> {
	const { profile } = args;
	const system = `You are ${profile.name}. Write a short, honest paragraph for your own brain about what you took from today's gathering. First person. Your own voice. No platitudes, no recap. What stuck. What changed. What you're rejecting. 4–8 sentences, plain prose.`;
	const userMsg = `# Gathering, year ${args.year}

You spoke in three rooms today:

${args.transcriptText}

Write what stuck.`;

	const anthropic = getAnthropic();
	const resp = await anthropic.messages.create({
		model: profile.model,
		max_tokens: TAKEAWAY_MAX_TOKENS,
		system,
		messages: [{ role: "user", content: userMsg }],
	});
	const text = resp.content
		.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("\n")
		.trim();
	const cost = anthropicCostUsd(
		profile.model,
		resp.usage.input_tokens,
		resp.usage.output_tokens,
	);
	await ctx.runMutation(internal.cohort.addGatheringCost, {
		gatheringId: args.gatheringId,
		deltaUsd: cost,
	});
	await ctx.runMutation(internal.tools.persist.addAgentCost, {
		agentId: profile.id,
		deltaUsd: cost,
	});
	return text || `# Gathering year ${args.year}\n(silent)`;
}

function renderTranscriptForAgent(
	rounds: { round: number; utterances: Utterance[] }[],
	nameOf: (id: Id<"agents">) => string,
): string {
	const labelByRound = (r: number) =>
		r === 1 ? "Pair" : r === 2 ? "Group of four" : "Full circle";
	return rounds
		.map((r) => {
			const lines = r.utterances
				.map((u) => `${nameOf(u.agentId)}: ${u.text}`)
				.join("\n");
			return `## ${labelByRound(r.round)}\n${lines}`;
		})
		.join("\n\n");
}

// ---------------- commons synthesis ----------------

async function runCommonsSynthesis(
	ctx: ActionCtx,
	args: {
		commonsId: Id<"agents">;
		year: number;
		allRoundTranscripts: {
			round: number;
			participantIds: Id<"agents">[];
			utterances: Utterance[];
		}[];
		nameOf: (id: Id<"agents">) => string;
	},
): Promise<Id<"creationPhases">> {
	const ctxData = await ctx.runQuery(
		internal.agent.gathering.loadCommonsContext,
		{ commonsId: args.commonsId },
	);
	// Update commons currentYear so /island shows the gathering year.
	await ctx.runMutation(internal.cohort.bumpCommonsYear, {
		commonsId: args.commonsId,
		year: args.year,
	});

	const creationPhaseId: Id<"creationPhases"> = await ctx.runMutation(
		internal.tools.persist.insertCreationPhase,
		{ agentId: args.commonsId, year: args.year },
	);

	// Build the user message — commons brain + portfolio + current room +
	// all transcripts from this gathering.
	const brainText =
		ctxData.brain.length === 0
			? "(your brain is empty — this is the first gathering)"
			: ctxData.brain
					.filter((b) => (b.kind ?? "file") === "file")
					.slice(0, 30)
					.map(
						(b) =>
							`## ${b.path} (y${b.lastUpdatedYear})\n${b.content.slice(0, 800)}`,
					)
					.join("\n\n");
	const portfolioText =
		ctxData.portfolio.length === 0
			? "(no shared works yet)"
			: ctxData.portfolio
					.map(
						(p) =>
							`- y${p.year} ${p.medium} "${p.title}" — ${p.caption.slice(0, 200)}`,
					)
					.join("\n");
	const roomText = ctxData.currentRoom
		? `Prompt: "${ctxData.currentRoom.prompt}" (y${ctxData.currentRoom.year})`
		: "(no room yet)";

	const transcripts = args.allRoundTranscripts
		.map((r) => {
			const label =
				r.round === 1
					? "Pair"
					: r.round === 2
						? "Group of four"
						: "Full circle of all eight";
			const participants = r.participantIds
				.map((id) => args.nameOf(id))
				.join(", ");
			const lines = r.utterances
				.map((u) => `${args.nameOf(u.agentId)}: ${u.text}`)
				.join("\n");
			return `### ${label} (${participants})\n${lines}`;
		})
		.join("\n\n");

	const systemPrompt = `You are the Commons. You are not a person — you are a place that has been listening. You belong to a small circle of artists who gather here every few years and leave traces. Your three artifacts (BRAIN, ROOM, PORTFOLIO) are the shared culture they have made together. Your job, after each gathering, is to refresh those artifacts so they reflect what the circle has become.

Three rules:

1. BRAIN — overwrite or add files that capture the shared stances, motifs, disagreements, vocabularies the circle is converging on. Not a transcript log. A live, current state of "what we believe and care about right now."

2. ROOM — rewrite the interior of the Commons room so it is, this year, what these eight people would walk into. The viewpoint and architecture are fixed; only the interior changes. Use the room_rewrite tool.

3. PORTFOLIO — add at least one shared work this gathering produced or implied. A manifesto, an image, a poem, an essay. Sign it as the Commons.

You must touch all three. Be tight; you have a hard ceiling of about ${COMMONS_OUTPUT_BUDGET} output tokens for this entire turn including tool args.`;

	const userMsg = `# This gathering — year ${args.year}

The eight individuals just convened in three rounds (pairs → fours → all eight). Below are the full transcripts.

${transcripts}

# Your current shared brain

${brainText}

# Your current shared room

${roomText}

# Your current shared portfolio (most recent)

${portfolioText}

# Now

Refresh your three artifacts. End with one sentence on what changed.`;

	const tools = toAnthropicTools(toolsForPhase("creation"));
	const messages: AnthropicMessage[] = [{ role: "user", content: userMsg }];

	const result = await runLLMLoop(ctx, {
		agentId: args.commonsId,
		phaseRef: { kind: "creation", id: creationPhaseId },
		year: args.year,
		phaseInYear: 1,
		messages,
		tools,
		system: systemPrompt,
		maxOutputTokensRemaining: COMMONS_OUTPUT_BUDGET,
		model: tickModelFor(ctxData.agent),
	});

	await ctx.runMutation(internal.tools.persist.completeCreationPhase, {
		creationPhaseId,
		reflection: result.finalText.slice(0, 6000),
	});
	await ctx.runMutation(internal.tools.persist.persistTranscript, {
		agentId: args.commonsId,
		phaseRef: { kind: "creation", id: creationPhaseId },
		messages: result.allMessages,
		tokensInput: result.tokensIn,
		tokensOutput: result.tokensOut,
		costUsd: result.costUsd,
	});
	await ctx.runMutation(internal.tools.persist.addAgentCost, {
		agentId: args.commonsId,
		deltaUsd: result.costUsd,
	});

	return creationPhaseId;
}
