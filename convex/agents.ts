import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
	internalMutation,
	mutation,
	query,
} from "./_generated/server";
import { isAgentModel } from "./lib/anthropic";

export const list = query({
	args: {},
	handler: async (ctx) => {
		// Bounded — we never expect to demo with thousands of agents.
		return await ctx.db.query("agents").take(100);
	},
});

export const get = query({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		return await ctx.db.get(agentId);
	},
});

export const pause = mutation({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		await ctx.db.patch(agentId, { status: "paused" });
	},
});

export const resume = mutation({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const agent = await ctx.db.get(agentId);
		if (!agent) return;
		if (agent.status === "dead") return;
		if (agent.status === "alive") return;
		await ctx.db.patch(agentId, {
			status: "alive",
			nextPhaseAt: Date.now(),
		});
		// Pausing leaves the tick chain dead — the previously-scheduled tick
		// fires once, sees status="paused", and exits without rescheduling. So
		// on resume we have to bootstrap a fresh tick. currentPhaseInYear
		// always points at the next phase to run (scheduleNext advances it
		// unconditionally), so we just dispatch by phase.
		const isCreation = agent.currentPhaseInYear === 1;
		await ctx.scheduler.runAfter(
			0,
			isCreation
				? internal.agent.tick.tickCreation
				: internal.agent.tick.tickConsumption,
			{ agentId },
		);
	},
});

export const setSpeed = mutation({
	args: { agentId: v.id("agents"), secondsPerYear: v.number() },
	handler: async (ctx, { agentId, secondsPerYear }) => {
		await ctx.db.patch(agentId, { secondsPerYear });
	},
});

export const remove = mutation({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		const agent = await ctx.db.get(agentId);
		if (!agent) return;
		// Drop the agent row first so the UI navigates away cleanly and any
		// in-flight tick exits on its `if (!agent) return` guard. The heavy
		// fan-out cleanup runs in the background.
		await ctx.db.delete(agentId);

		// If the agent belonged to a cohort, prune the membership list so
		// gatherings don't try to wait on a ghost.
		if (agent.cohortId) {
			const cohort = await ctx.db.get(agent.cohortId);
			if (cohort) {
				await ctx.db.patch(cohort._id, {
					individualIds: cohort.individualIds.filter(
						(id) => id !== agentId,
					),
				});
			}
		}

		await ctx.scheduler.runAfter(0, internal.agents.purgeAgentData, {
			agentId,
		});
	},
});

const PURGE_BATCH = 200;

export const purgeAgentData = internalMutation({
	args: { agentId: v.id("agents") },
	handler: async (ctx, { agentId }) => {
		let more = false;

		const purgeByAgentYear = async (
			table:
				| "consumptionPhases"
				| "creationPhases"
				| "consumedItems"
				| "roomVersions"
				| "portfolioItems"
				| "eraLabels"
				| "personalityScores"
				| "creationPhases",
		) => {
			const rows = await ctx.db
				.query(table)
				.withIndex("by_agent_and_year", (q) => q.eq("agentId", agentId))
				.take(PURGE_BATCH);
			if (rows.length === PURGE_BATCH) more = true;
			for (const row of rows) {
				// Best-effort storage cleanup for rows that own blobs.
				const anyRow = row as unknown as {
					thumbnailStorageId?: string;
					imageStorageId?: string;
					payload?: { kind?: string; storageId?: string };
				};
				if (anyRow.thumbnailStorageId) {
					await ctx.storage.delete(anyRow.thumbnailStorageId as never);
				}
				if (anyRow.imageStorageId) {
					await ctx.storage.delete(anyRow.imageStorageId as never);
				}
				if (
					anyRow.payload &&
					anyRow.payload.kind === "blob" &&
					anyRow.payload.storageId
				) {
					await ctx.storage.delete(anyRow.payload.storageId as never);
				}
				await ctx.db.delete(row._id);
			}
		};

		await purgeByAgentYear("consumptionPhases");
		await purgeByAgentYear("creationPhases");
		await purgeByAgentYear("consumedItems");
		await purgeByAgentYear("roomVersions");
		await purgeByAgentYear("portfolioItems");
		await purgeByAgentYear("eraLabels");
		await purgeByAgentYear("personalityScores");

		const brainFiles = await ctx.db
			.query("brainFiles")
			.withIndex("by_agent_and_path", (q) => q.eq("agentId", agentId))
			.take(PURGE_BATCH);
		if (brainFiles.length === PURGE_BATCH) more = true;
		for (const row of brainFiles) await ctx.db.delete(row._id);

		const brainVersions = await ctx.db
			.query("brainFileVersions")
			.withIndex("by_agent_and_path_and_version", (q) =>
				q.eq("agentId", agentId),
			)
			.take(PURGE_BATCH);
		if (brainVersions.length === PURGE_BATCH) more = true;
		for (const row of brainVersions) await ctx.db.delete(row._id);

		const transcripts = await ctx.db
			.query("phaseTranscripts")
			.withIndex("by_agent", (q) => q.eq("agentId", agentId))
			.take(PURGE_BATCH);
		if (transcripts.length === PURGE_BATCH) more = true;
		for (const row of transcripts) await ctx.db.delete(row._id);

		const tools = await ctx.db
			.query("toolCalls")
			.withIndex("by_agent", (q) => q.eq("agentId", agentId))
			.take(PURGE_BATCH);
		if (tools.length === PURGE_BATCH) more = true;
		for (const row of tools) await ctx.db.delete(row._id);

		if (more) {
			await ctx.scheduler.runAfter(0, internal.agents.purgeAgentData, {
				agentId,
			});
		}
	},
});

export const setModel = mutation({
	args: { agentId: v.id("agents"), model: v.string() },
	handler: async (ctx, { agentId, model }) => {
		if (!isAgentModel(model)) {
			throw new Error(`Unknown model: ${model}`);
		}
		await ctx.db.patch(agentId, { model });
	},
});
