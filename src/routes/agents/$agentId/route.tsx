import {
	createFileRoute,
	Link,
	Outlet,
	useParams,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AgentSubnav } from "../../../components/AgentSubnav";
import { ageOf, formatStatus } from "../../../lib/time";

export const Route = createFileRoute("/agents/$agentId")({
	component: AgentLayout,
});

function AgentLayout() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const agent = useQuery(api.agents.get, { agentId });
	const era = useQuery(api.eras.current, { agentId });

	if (agent === undefined) {
		return (
			<div className="mx-auto max-w-6xl px-6 py-12">
				<div className="h-32 bg-stone-100 animate-pulse" />
			</div>
		);
	}
	if (agent === null) {
		return (
			<div className="mx-auto max-w-6xl px-6 py-24 text-center">
				<p className="font-serif italic text-stone-500 text-xl">
					No such agent.
				</p>
				<Link
					to="/"
					className="mt-6 inline-block font-mono text-[11px] uppercase tracking-[0.18em] underline"
				>
					Back to all agents
				</Link>
			</div>
		);
	}

	return (
		<div>
			<section className="border-b border-stone-200 bg-stone-50">
				<div className="mx-auto max-w-6xl px-6 py-6 flex flex-wrap items-end justify-between gap-4">
					<div className="flex items-baseline gap-4">
						<h1 className="font-serif text-3xl text-stone-900 leading-none tracking-tight">
							{agent.name}
						</h1>
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
							{formatStatus(agent.status)} · {ageOf(agent)}
						</span>
						{era && (
							<span className="font-serif italic text-stone-600 text-sm truncate max-w-md">
								{era.label}
							</span>
						)}
					</div>
				</div>
			</section>
			<AgentSubnav />
			<Outlet />
		</div>
	);
}
