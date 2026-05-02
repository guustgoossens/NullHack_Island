import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { PortfolioRenderInline } from "../../../components/PortfolioRender";

export const Route = createFileRoute("/agents/$agentId/")({
	component: AgentHome,
});

type StreamYear = {
	year: number;
	room: {
		_id: string;
		prompt: string;
		imageUrl: string | null;
		status: "pending" | "ready" | "failed";
	} | null;
	inspirations: Array<{
		id: string;
		tool: string;
		query: string;
		url: string;
		pageUrl?: string;
	}>;
	artworks: Array<
		Doc<"portfolioItems"> & {
			blobUrl: string | null;
			thumbnailUrl: string | null;
		}
	>;
};

function AgentHome() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const stream = useQuery(api.lifeStream.byAgent, { agentId }) as
		| StreamYear[]
		| undefined;

	if (stream === undefined) {
		return (
			<main className="mx-auto max-w-6xl px-6 py-12">
				<div className="h-32 bg-stone-100 animate-pulse" />
			</main>
		);
	}

	if (stream.length === 0) {
		return (
			<main className="mx-auto max-w-6xl px-6 py-24 text-center">
				<p className="font-serif italic text-stone-500">
					Nothing yet. The first year is still loading.
				</p>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-6xl px-6 py-10 space-y-16">
			{stream.map((y) => (
				<YearRow key={y.year} year={y} />
			))}
		</main>
	);
}

function YearRow({ year }: { year: StreamYear }) {
	return (
		<section className="grid lg:grid-cols-[160px_1fr] gap-6 lg:gap-10">
			<div className="lg:sticky lg:top-[140px] lg:self-start">
				<div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
					year
				</div>
				<div className="font-serif text-5xl text-stone-900 leading-none">
					{year.year}
				</div>
			</div>

			<div className="space-y-6">
				{year.room && (
					<div className="aspect-[4/3] bg-stone-100 border border-stone-200 overflow-hidden">
						{year.room.imageUrl ? (
							<img
								src={year.room.imageUrl}
								alt={`Year ${year.year} room`}
								className="w-full h-full object-cover"
							/>
						) : (
							<div className="w-full h-full flex items-center justify-center text-stone-400 font-mono text-[10px] uppercase tracking-[0.2em]">
								{year.room.status === "failed" ? "image failed" : "rendering…"}
							</div>
						)}
					</div>
				)}

				{year.inspirations.length > 0 && (
					<Strip label="inspirations" count={year.inspirations.length}>
						<div className="flex gap-2 overflow-x-auto pb-1">
							{year.inspirations.map((insp) => (
								<a
									key={insp.id}
									href={insp.pageUrl ?? insp.url}
									target="_blank"
									rel="noreferrer"
									className="shrink-0 w-32 h-32 bg-stone-100 overflow-hidden block"
									title={insp.query}
								>
									<img
										src={insp.url}
										alt={insp.query}
										loading="lazy"
										referrerPolicy="no-referrer"
										className="w-full h-full object-cover"
									/>
								</a>
							))}
						</div>
					</Strip>
				)}

				{year.artworks.length > 0 && (
					<Strip label="works" count={year.artworks.length}>
						<div className="flex gap-3 overflow-x-auto pb-1">
							{year.artworks.map((item) => (
								<div key={item._id} className="shrink-0 w-56">
									<PortfolioRenderInline item={item} height={144} />
								</div>
							))}
						</div>
					</Strip>
				)}

				{!year.room &&
					year.inspirations.length === 0 &&
					year.artworks.length === 0 && (
						<p className="font-serif italic text-stone-400 text-sm">
							A quiet year.
						</p>
					)}
			</div>
		</section>
	);
}

function Strip({
	label,
	count,
	children,
}: {
	label: string;
	count: number;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="flex items-baseline gap-3 mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
				<span>{label}</span>
				<span className="text-stone-300">·</span>
				<span>{count}</span>
			</div>
			{children}
		</div>
	);
}
