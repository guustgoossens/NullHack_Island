import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import { AgentCard } from "../components/AgentCard";
import { BirthModal } from "../components/BirthModal";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const agents = useQuery(api.agents.list);
	const [birthOpen, setBirthOpen] = useState(false);

	return (
		<main className="mx-auto max-w-6xl px-6 py-12">
			<section className="flex items-end justify-between mb-10 gap-6">
				<div className="max-w-2xl">
					<h1 className="font-serif text-5xl text-stone-900 leading-[1.05] tracking-tight">
						The lives so far
					</h1>
					<p className="font-serif italic text-stone-600 text-lg mt-3">
						Each agent lives a sixty-year life of consumption and creation. Pick
						one. Watch a soul crystallize.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setBirthOpen(true)}
					className="shrink-0 px-5 py-3 bg-stone-900 text-stone-50 font-mono text-xs uppercase tracking-[0.2em] hover:bg-stone-700"
				>
					+ Birth an agent
				</button>
			</section>

			{agents === undefined ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{["a", "b", "c"].map((k) => (
						<div
							key={k}
							className="border border-stone-200 bg-white animate-pulse h-[360px]"
						/>
					))}
				</div>
			) : agents.length === 0 ? (
				<div className="border border-dashed border-stone-300 p-16 text-center">
					<p className="font-serif italic text-stone-500 text-lg">
						No one has been born yet.
					</p>
					<button
						type="button"
						onClick={() => setBirthOpen(true)}
						className="mt-6 px-5 py-3 bg-stone-900 text-stone-50 font-mono text-xs uppercase tracking-[0.2em] hover:bg-stone-700"
					>
						Birth the first
					</button>
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{agents.map((agent) => (
						<AgentCard key={agent._id} agent={agent} />
					))}
				</div>
			)}

			<BirthModal open={birthOpen} onClose={() => setBirthOpen(false)} />
		</main>
	);
}
