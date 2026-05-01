import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const Route = createFileRoute("/agents/$agentId/room")({
	component: RoomPage,
});

function RoomPage() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const rooms = useQuery(api.room.history, { agentId });

	return (
		<main className="mx-auto max-w-4xl px-6 py-10">
			<header className="mb-8">
				<h1 className="font-serif text-4xl text-stone-900 leading-tight">
					Sixty rooms
				</h1>
				<p className="font-serif italic text-stone-600 mt-2">
					Each year the room is rewritten. Latest first.
				</p>
			</header>

			{rooms === undefined ? (
				<div className="space-y-12">
					{["a", "b"].map((k) => (
						<div key={k} className="aspect-[4/3] bg-stone-100 animate-pulse" />
					))}
				</div>
			) : rooms.length === 0 ? (
				<p className="font-serif italic text-stone-500">
					No rooms have been generated yet.
				</p>
			) : (
				<ol className="space-y-14">
					{rooms.map((r, i) => (
						<li key={r._id}>
							<div className="flex items-baseline gap-3 mb-3">
								<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
									year {r.year} · {r.origin}
									{i === 0 && " · current"}
								</span>
								<span className="h-px flex-1 bg-stone-200" />
							</div>
							<div className="aspect-[4/3] bg-stone-100 border border-stone-200 overflow-hidden">
								{r.imageUrl ? (
									<img
										src={r.imageUrl}
										alt={`Year ${r.year} room`}
										className="w-full h-full object-cover"
									/>
								) : (
									<div className="w-full h-full flex items-center justify-center text-stone-400 font-mono text-xs uppercase tracking-[0.2em]">
										{r.imageStatus === "failed"
											? `image failed${r.imageError ? ` — ${r.imageError}` : ""}`
											: "rendering…"}
									</div>
								)}
							</div>
							<p className="mt-4 font-serif italic text-stone-700 leading-relaxed">
								{r.prompt}
							</p>
						</li>
					))}
				</ol>
			)}
		</main>
	);
}
