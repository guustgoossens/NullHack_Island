// Cohort = a fixed group of 8 individual agents + 1 commons agent. Individuals
// live their lives normally; once every `gatheringEveryNYears` years they
// barrier-pause and convene with the commons in escalating breakout rounds
// (pairs → fours → full circle). The commons synthesizes their conversations
// into a shared brain/room/portfolio.
//
// This file owns the cohort's lifecycle: spawning the 9 agents, exposing
// queries the UI needs, and the barrier check that fires gatherings.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { DEFAULT_AGENT_MODEL, isAgentModel } from "./lib/anthropic";
import { BLANK_ROOM_PROMPT } from "./lib/personality";

const DEFAULT_SECONDS_PER_YEAR = 15;
const DEFAULT_LIFETIME_COST_CAP_USD = 50;
const DEFAULT_MAX_OUTPUT_TOKENS_PER_PHASE = 3_500;
const DEFAULT_GATHERING_EVERY_N_YEARS = 4;

export const COHORT_SIZE = 8;

// ---------------- queries ----------------

export const list = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("cohorts").take(50);
		return rows.sort((a, b) => b.createdAt - a.createdAt);
	},
});

export const get = query({
	args: { cohortId: v.id("cohorts") },
	handler: async (ctx, { cohortId }) => {
		return await ctx.db.get(cohortId);
	},
});

// Full bundle the /island view needs: cohort row + all 9 agents +
// the most recent gathering (if any) + recent gatherings (for the timeline).
export const islandView = query({
	args: { cohortId: v.id("cohorts") },
	handler: async (ctx, { cohortId }) => {
		const cohort = await ctx.db.get(cohortId);
		if (!cohort) return null;
		const agentIds = [...cohort.individualIds, cohort.commonsId];
		const agents = (await Promise.all(agentIds.map((id) => ctx.db.get(id))))
			.filter((a): a is Doc<"agents"> => a !== null);

		const gatherings = await ctx.db
			.query("gatherings")
			.withIndex("by_cohort_and_year", (q) => q.eq("cohortId", cohortId))
			.order("desc")
			.take(20);

		// Latest room for each agent.
		const latestRooms: Record<string, Doc<"roomVersions"> | null> = {};
		const latestRoomImageUrls: Record<string, string | null> = {};
		for (const agent of agents) {
			const rooms = await ctx.db
				.query("roomVersions")
				.withIndex("by_agent_and_year", (q) => q.eq("agentId", agent._id))
				.order("desc")
				.take(1);
			const room = rooms[0] ?? null;
			latestRooms[agent._id] = room;
			latestRoomImageUrls[agent._id] = room?.imageStorageId
				? await ctx.storage.getUrl(room.imageStorageId)
				: null;
		}

		// Latest era label per individual.
		const latestEras: Record<string, Doc<"eraLabels"> | null> = {};
		for (const agent of agents) {
			if (agent.kind === "commons") {
				latestEras[agent._id] = null;
				continue;
			}
			const eras = await ctx.db
				.query("eraLabels")
				.withIndex("by_agent_and_year", (q) => q.eq("agentId", agent._id))
				.order("desc")
				.take(1);
			latestEras[agent._id] = eras[0] ?? null;
		}

		return {
			cohort,
			agents,
			latestRooms,
			latestRoomImageUrls,
			latestEras,
			gatherings,
		};
	},
});

// Per-agent state at a specific year for the scrub view: the room version
// that was current at year K (most recent roomVersion with year <= K), and
// the era label that held at year K. Returned shape mirrors the relevant
// slice of islandView so the UI can swap data sources cleanly.
export const stateAtYear = query({
	args: { cohortId: v.id("cohorts"), year: v.number() },
	handler: async (ctx, { cohortId, year }) => {
		const cohort = await ctx.db.get(cohortId);
		if (!cohort) return null;
		const agentIds = [...cohort.individualIds, cohort.commonsId];

		const roomImageUrls: Record<string, string | null> = {};
		const eras: Record<string, Doc<"eraLabels"> | null> = {};
		const ages: Record<string, number> = {};

		for (const id of agentIds) {
			const agent = await ctx.db.get(id);
			if (!agent) continue;
			ages[id] = Math.min(year, agent.currentYear);

			const rooms = await ctx.db
				.query("roomVersions")
				.withIndex("by_agent_and_year", (q) =>
					q.eq("agentId", id).lte("year", year),
				)
				.order("desc")
				.take(1);
			const room = rooms[0] ?? null;
			roomImageUrls[id] = room?.imageStorageId
				? await ctx.storage.getUrl(room.imageStorageId)
				: null;

			if (agent.kind === "commons") {
				eras[id] = null;
				continue;
			}
			const e = await ctx.db
				.query("eraLabels")
				.withIndex("by_agent_and_year", (q) =>
					q.eq("agentId", id).lte("year", year),
				)
				.order("desc")
				.take(1);
			eras[id] = e[0] ?? null;
		}

		// Most recent gathering at-or-before year K, for the strip below the grid.
		const gatherings = await ctx.db
			.query("gatherings")
			.withIndex("by_cohort_and_year", (q) =>
				q.eq("cohortId", cohortId).lte("year", year),
			)
			.order("desc")
			.take(1);

		return {
			year,
			roomImageUrls,
			eras,
			ages,
			gatheringAtOrBefore: gatherings[0] ?? null,
		};
	},
});

// One gathering with all its breakout rooms expanded.
export const gatheringDetail = query({
	args: { gatheringId: v.id("gatherings") },
	handler: async (ctx, { gatheringId }) => {
		const gathering = await ctx.db.get(gatheringId);
		if (!gathering) return null;
		const breakouts = await ctx.db
			.query("breakoutRooms")
			.withIndex("by_gathering_and_round", (q) =>
				q.eq("gatheringId", gatheringId),
			)
			.collect();
		return { gathering, breakouts };
	},
});

// ---------------- mutations: spawn ----------------

const memberInput = v.object({
	name: v.string(),
	model: v.optional(v.string()),
});

export const birthCohort = mutation({
	args: {
		name: v.string(),
		members: v.array(memberInput),
		commonsName: v.optional(v.string()),
		commonsModel: v.optional(v.string()),
		secondsPerYear: v.optional(v.number()),
		gatheringEveryNYears: v.optional(v.number()),
		lifetimeCostCapUsd: v.optional(v.number()),
		maxOutputTokensPerPhase: v.optional(v.number()),
	},
	handler: async (ctx, args): Promise<Id<"cohorts">> => {
		if (args.members.length !== COHORT_SIZE) {
			throw new Error(
				`Cohort must have exactly ${COHORT_SIZE} members; got ${args.members.length}.`,
			);
		}
		const now = Date.now();
		const secondsPerYear = args.secondsPerYear ?? DEFAULT_SECONDS_PER_YEAR;
		const lifetimeCostCapUsd =
			args.lifetimeCostCapUsd ?? DEFAULT_LIFETIME_COST_CAP_USD;
		const maxOutputTokensPerPhase =
			args.maxOutputTokensPerPhase ?? DEFAULT_MAX_OUTPUT_TOKENS_PER_PHASE;
		const gatheringEveryNYears =
			args.gatheringEveryNYears ?? DEFAULT_GATHERING_EVERY_N_YEARS;

		// Insert cohort first with placeholder ids; we patch with real ids below.
		// Convex doesn't have a transactional "insert with self-reference" so we
		// use a placeholder cohort and stamp `cohortId` on each agent after.
		const cohortId: Id<"cohorts"> = await ctx.db.insert("cohorts", {
			name: args.name,
			individualIds: [],
			// Patched below — `commonsId` is required, but we don't have one yet.
			// We use one of the individual ids as a placeholder and immediately
			// overwrite. To avoid that ugliness we instead spawn the commons FIRST.
			commonsId: undefined as unknown as Id<"agents">,
			gatheringEveryNYears,
			status: "active",
			createdAt: now,
		});

		// Spawn the commons. It uses the same `agents` table but with kind=commons,
		// status="paused" (it never ticks on its own), and no genesis pass — its
		// "seed" is the gathering experience itself, not a self-authored one.
		const commonsModel =
			args.commonsModel && isAgentModel(args.commonsModel)
				? args.commonsModel
				: DEFAULT_AGENT_MODEL;
		const commonsName = args.commonsName?.trim() || `${args.name} Commons`;
		const commonsId: Id<"agents"> = await ctx.db.insert("agents", {
			name: commonsName,
			kind: "commons",
			cohortId,
			birthSeed: "",
			startingRoomPrompt: BLANK_ROOM_PROMPT,
			genesisStatus: "ready", // skip self-genesis for the commons
			status: "paused", // never ticks; only wakes during gatherings
			currentYear: 0,
			currentPhaseInYear: 0,
			secondsPerYear,
			nextPhaseAt: now + 365 * 24 * 60 * 60 * 1000, // far future
			model: commonsModel,
			lifetimeCostUsd: 0,
			lifetimeCostCapUsd,
			maxOutputTokensPerPhase,
			bornAt: now,
		});

		// Seed commons starting room — it gets an image like everyone else.
		const commonsRoomId = await ctx.db.insert("roomVersions", {
			agentId: commonsId,
			year: 0,
			prompt: BLANK_ROOM_PROMPT,
			origin: "starting",
			imageStatus: "pending",
			createdAt: now,
		});
		await ctx.scheduler.runAfter(0, internal.tools.render.renderRoomImage, {
			roomVersionId: commonsRoomId,
		});

		// Spawn the 8 individuals.
		const individualIds: Id<"agents">[] = [];
		for (const m of args.members) {
			const model =
				m.model && isAgentModel(m.model) ? m.model : DEFAULT_AGENT_MODEL;
			const agentId: Id<"agents"> = await ctx.db.insert("agents", {
				name: m.name,
				kind: "individual",
				cohortId,
				birthSeed: "",
				startingRoomPrompt: BLANK_ROOM_PROMPT,
				genesisStatus: "pending",
				status: "alive",
				currentYear: 0,
				currentPhaseInYear: 0,
				secondsPerYear,
				nextPhaseAt: now + 60 * 60 * 1000, // placeholder; genesis schedules
				model,
				lifetimeCostUsd: 0,
				lifetimeCostCapUsd,
				maxOutputTokensPerPhase,
				bornAt: now,
			});
			individualIds.push(agentId);

			const roomVersionId = await ctx.db.insert("roomVersions", {
				agentId,
				year: 0,
				prompt: BLANK_ROOM_PROMPT,
				origin: "starting",
				imageStatus: "pending",
				createdAt: now,
			});
			await ctx.scheduler.runAfter(
				0,
				internal.tools.render.renderRoomImage,
				{ roomVersionId },
			);
			await ctx.scheduler.runAfter(
				0,
				internal.agent.genesis.runSelfGenesis,
				{ agentId },
			);
		}

		// Stamp the cohort with the real ids.
		await ctx.db.patch(cohortId, {
			individualIds,
			commonsId,
		});

		return cohortId;
	},
});

// ---------------- mutations: speed control ----------------

export const setCohortSpeed = mutation({
	args: { cohortId: v.id("cohorts"), secondsPerYear: v.number() },
	handler: async (ctx, { cohortId, secondsPerYear }) => {
		const cohort = await ctx.db.get(cohortId);
		if (!cohort) return;
		const agentIds = [...cohort.individualIds, cohort.commonsId];
		for (const id of agentIds) {
			await ctx.db.patch(id, { secondsPerYear });
		}
	},
});

// ---------------- internal: barrier ----------------

// Mark an agent as gathering-waiting at a barrier year. Called by tick.ts
// when an individual cohort agent finishes a year-N creation phase where N
// is a multiple of gatheringEveryNYears.
export const enterGatheringWait = internalMutation({
	args: {
		agentId: v.id("agents"),
		forYear: v.number(),
	},
	handler: async (ctx, { agentId, forYear }) => {
		await ctx.db.patch(agentId, {
			gatheringWait: true,
			gatheringWaitForYear: forYear,
		});
	},
});

// Check whether every individual in a cohort is now waiting at the same year.
// If so, kick off the gathering action.
export const maybeFireGathering = internalMutation({
	args: { cohortId: v.id("cohorts"), forYear: v.number() },
	handler: async (ctx, { cohortId, forYear }) => {
		const cohort = await ctx.db.get(cohortId);
		if (!cohort) return null;
		if (cohort.status !== "active") return null;

		// All individuals must be waiting at the same year.
		const individuals = await Promise.all(
			cohort.individualIds.map((id) => ctx.db.get(id)),
		);
		const ready = individuals.every(
			(a) =>
				a !== null &&
				a.gatheringWait === true &&
				a.gatheringWaitForYear === forYear,
		);
		if (!ready) return null;

		// Idempotency: skip if a gathering for this cohort+year already exists.
		const existing = await ctx.db
			.query("gatherings")
			.withIndex("by_cohort_and_year", (q) =>
				q.eq("cohortId", cohortId).eq("year", forYear),
			)
			.unique();
		if (existing) return existing._id;

		const gatheringId = await ctx.db.insert("gatherings", {
			cohortId,
			year: forYear,
			status: "pending",
			startedAt: Date.now(),
			costUsd: 0,
		});

		await ctx.scheduler.runAfter(0, internal.agent.gathering.runGathering, {
			gatheringId,
		});
		return gatheringId;
	},
});

// Internal helpers used by the gathering action.

export const getCohort = internalQuery({
	args: { cohortId: v.id("cohorts") },
	handler: async (ctx, { cohortId }): Promise<Doc<"cohorts"> | null> => {
		return await ctx.db.get(cohortId);
	},
});

export const getAgents = internalQuery({
	args: { agentIds: v.array(v.id("agents")) },
	handler: async (ctx, { agentIds }): Promise<Doc<"agents">[]> => {
		const out: Doc<"agents">[] = [];
		for (const id of agentIds) {
			const a = await ctx.db.get(id);
			if (a) out.push(a);
		}
		return out;
	},
});

export const setGatheringStatus = internalMutation({
	args: {
		gatheringId: v.id("gatherings"),
		status: v.union(
			v.literal("pending"),
			v.literal("running"),
			v.literal("synthesizing"),
			v.literal("completed"),
			v.literal("failed"),
		),
		errorMessage: v.optional(v.string()),
		commonsCreationPhaseId: v.optional(v.id("creationPhases")),
	},
	handler: async (ctx, args) => {
		const patch: Partial<Doc<"gatherings">> = { status: args.status };
		if (args.errorMessage !== undefined)
			patch.errorMessage = args.errorMessage;
		if (args.commonsCreationPhaseId !== undefined)
			patch.commonsCreationPhaseId = args.commonsCreationPhaseId;
		if (args.status === "completed" || args.status === "failed") {
			patch.completedAt = Date.now();
		}
		await ctx.db.patch(args.gatheringId, patch);
	},
});

export const addGatheringCost = internalMutation({
	args: { gatheringId: v.id("gatherings"), deltaUsd: v.number() },
	handler: async (ctx, { gatheringId, deltaUsd }) => {
		const g = await ctx.db.get(gatheringId);
		if (!g) return;
		await ctx.db.patch(gatheringId, {
			costUsd: (g.costUsd ?? 0) + deltaUsd,
		});
	},
});

export const insertBreakout = internalMutation({
	args: {
		gatheringId: v.id("gatherings"),
		round: v.number(),
		participantIds: v.array(v.id("agents")),
	},
	handler: async (ctx, args): Promise<Id<"breakoutRooms">> => {
		return await ctx.db.insert("breakoutRooms", {
			gatheringId: args.gatheringId,
			round: args.round,
			participantIds: args.participantIds,
			transcript: [],
			startedAt: Date.now(),
		});
	},
});

export const appendBreakoutUtterance = internalMutation({
	args: {
		breakoutId: v.id("breakoutRooms"),
		agentId: v.id("agents"),
		text: v.string(),
	},
	handler: async (ctx, { breakoutId, agentId, text }) => {
		const row = await ctx.db.get(breakoutId);
		if (!row) return;
		await ctx.db.patch(breakoutId, {
			transcript: [...row.transcript, { agentId, text }],
		});
	},
});

export const closeBreakout = internalMutation({
	args: { breakoutId: v.id("breakoutRooms") },
	handler: async (ctx, { breakoutId }) => {
		await ctx.db.patch(breakoutId, { completedAt: Date.now() });
	},
});

// After a gathering completes: clear the wait flags, advance each individual's
// clock to year+1 phase 0, and schedule the next consumption tick.
export const releaseAfterGathering = internalMutation({
	args: { cohortId: v.id("cohorts"), forYear: v.number() },
	handler: async (ctx, { cohortId, forYear }) => {
		const cohort = await ctx.db.get(cohortId);
		if (!cohort) return;
		for (const id of cohort.individualIds) {
			const a = await ctx.db.get(id);
			if (!a) continue;
			if (!a.gatheringWait) continue;
			if (a.gatheringWaitForYear !== forYear) continue;

			// Advance clock past year-N creation: next phase is consumption of N+1.
			const nextYear = a.currentYear + 1;
			const nextPhaseAt =
				Date.now() + (a.secondsPerYear / 2) * 1000;
			await ctx.db.patch(id, {
				gatheringWait: false,
				gatheringWaitForYear: undefined,
				currentYear: nextYear,
				currentPhaseInYear: 0,
				nextPhaseAt,
				status: nextYear >= 60 ? "dead" : a.status,
			});
			if (nextYear < 60 && a.status === "alive") {
				await ctx.scheduler.runAt(
					nextPhaseAt,
					internal.agent.tick.tickConsumption,
					{ agentId: id },
				);
			}
		}
	},
});

// Bump the commons agent's currentYear so the /island UI shows it advancing
// in lockstep with gatherings.
export const bumpCommonsYear = internalMutation({
	args: { commonsId: v.id("agents"), year: v.number() },
	handler: async (ctx, { commonsId, year }) => {
		await ctx.db.patch(commonsId, { currentYear: year });
	},
});

// Returns the year-N creation phase ID for an agent, used by the gathering
// loop when it wants to attach a brain-takeaway version row to the agent's
// completed creation phase.
export const getCreationPhaseForYear = internalQuery({
	args: { agentId: v.id("agents"), year: v.number() },
	handler: async (ctx, { agentId, year }) => {
		const row = await ctx.db
			.query("creationPhases")
			.withIndex("by_agent_and_year", (q) =>
				q.eq("agentId", agentId).eq("year", year),
			)
			.unique();
		return row;
	},
});
