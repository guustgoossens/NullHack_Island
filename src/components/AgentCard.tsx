import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { ageOf, formatStatus } from "../lib/time";

export function AgentCard({ agent }: { agent: Doc<"agents"> }) {
	const room = useQuery(api.room.current, { agentId: agent._id });
	const era = useQuery(api.eras.current, { agentId: agent._id });

	return (
		<Link
			to="/agents/$agentId"
			params={{ agentId: agent._id }}
			className="group block border border-stone-200 bg-white hover:border-stone-400 transition-colors"
		>
			<div className="aspect-[4/3] bg-stone-100 overflow-hidden border-b border-stone-200">
				{room?.imageUrl ? (
					<img
						src={room.imageUrl}
						alt={`${agent.name}'s room`}
						className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-700"
					/>
				) : (
					<div className="w-full h-full flex items-center justify-center text-stone-400 font-mono text-[10px] uppercase tracking-[0.2em]">
						{room?.imageStatus === "failed" ? "image failed" : "rendering…"}
					</div>
				)}
			</div>
			<div className="p-5">
				<div className="flex items-baseline justify-between gap-3">
					<h2 className="font-serif text-2xl text-stone-900 leading-tight">
						{agent.name}
					</h2>
					<span className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500 whitespace-nowrap">
						age {ageOf(agent)}
					</span>
				</div>
				<p className="mt-2 font-serif italic text-stone-600 text-sm leading-snug min-h-[2.5em] line-clamp-2">
					{era?.label ?? "—"}
				</p>
				<div className="mt-4 flex items-center justify-between">
					<StatusPill status={agent.status} />
					<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
						{agent.secondsPerYear}s / year
					</span>
				</div>
			</div>
		</Link>
	);
}

function StatusPill({ status }: { status: Doc<"agents">["status"] }) {
	const colors =
		status === "alive"
			? "bg-emerald-50 text-emerald-700 border-emerald-200"
			: status === "paused"
				? "bg-amber-50 text-amber-700 border-amber-200"
				: "bg-stone-100 text-stone-500 border-stone-200";
	return (
		<span
			className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] font-mono ${colors}`}
		>
			<span
				className={`size-1.5 rounded-full ${
					status === "alive"
						? "bg-emerald-500"
						: status === "paused"
							? "bg-amber-500"
							: "bg-stone-400"
				}`}
			/>
			{formatStatus(status)}
		</span>
	);
}
