import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { PortfolioPreview } from "../../../components/PortfolioPreview";
import { phaseLabel } from "../../../lib/time";

export const Route = createFileRoute("/agents/$agentId/")({
	component: AgentHome,
});

function AgentHome() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const agent = useQuery(api.agents.get, { agentId });
	const room = useQuery(api.room.current, { agentId });
	const era = useQuery(api.eras.current, { agentId });
	const brain = useQuery(api.brain.tree, { agentId });
	const portfolio = useQuery(api.portfolio.list, { agentId });
	const feed = useQuery(
		api.feed.byYear,
		agent ? { agentId, year: agent.currentYear } : "skip",
	);

	if (!agent) return null;

	const recentBrain = (brain ?? [])
		.slice()
		.sort((a, b) => b.lastUpdatedYear - a.lastUpdatedYear)
		.slice(0, 3);
	const recentPortfolio = (portfolio ?? []).slice(0, 6);
	const recentFeed = (feed ?? [])
		.slice()
		.sort(
			(a, b) =>
				a.phaseInYear - b.phaseInYear || a._creationTime - b._creationTime,
		);

	return (
		<main className="mx-auto max-w-6xl px-6 py-10 grid gap-10 lg:grid-cols-[2fr_1fr]">
			<div className="space-y-10">
				<section>
					<div className="aspect-[4/3] bg-stone-100 border border-stone-200 overflow-hidden">
						{room?.imageUrl ? (
							<img
								src={room.imageUrl}
								alt={`${agent.name}'s current room`}
								className="w-full h-full object-cover"
							/>
						) : (
							<div className="w-full h-full flex items-center justify-center text-stone-400 font-mono text-xs uppercase tracking-[0.2em]">
								{room?.imageStatus === "failed"
									? "image generation failed"
									: room
										? "rendering room…"
										: "no room yet"}
							</div>
						)}
					</div>
					{room && (
						<p className="mt-3 font-serif italic text-stone-600 text-sm leading-relaxed">
							{room.prompt}
						</p>
					)}
				</section>

				{era && (
					<section>
						<EraHeader label={era.label} />
						<p className="font-serif text-lg text-stone-700 leading-relaxed mt-3">
							{era.summary}
						</p>
					</section>
				)}

				<section>
					<SectionHeader
						title="Latest brain entries"
						link={{ to: "/agents/$agentId/brain", agentId }}
					/>
					{recentBrain.length === 0 ? (
						<EmptyNote text="The brain is still empty." />
					) : (
						<ul className="divide-y divide-stone-200 border-t border-b border-stone-200">
							{recentBrain.map((f) => (
								<BrainPreviewRow
									key={f._id}
									agentId={agentId}
									path={f.path}
									year={f.lastUpdatedYear}
								/>
							))}
						</ul>
					)}
				</section>

				<section>
					<SectionHeader
						title="Latest works"
						link={{ to: "/agents/$agentId/portfolio", agentId }}
					/>
					{recentPortfolio.length === 0 ? (
						<EmptyNote text="No portfolio yet." />
					) : (
						<div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
							{recentPortfolio.map((item) => (
								<PortfolioPreview key={item._id} item={item} />
							))}
						</div>
					)}
				</section>
			</div>

			<aside className="lg:sticky lg:top-[120px] lg:self-start space-y-6">
				<div>
					<SectionHeader
						title={`This year's feed (year ${agent.currentYear})`}
						link={{ to: "/agents/$agentId/feed", agentId }}
					/>
					{recentFeed.length === 0 ? (
						<EmptyNote text="Nothing consumed yet." />
					) : (
						<ul className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
							{recentFeed.map((c) => (
								<FeedItem key={c._id} item={c} />
							))}
						</ul>
					)}
				</div>
			</aside>
		</main>
	);
}

function EraHeader({ label }: { label: string }) {
	return (
		<div className="space-y-2">
			<div className="flex items-baseline gap-3">
				<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
					current era
				</span>
				<span className="h-px flex-1 bg-stone-300" />
			</div>
			<h2 className="font-serif text-3xl italic text-stone-900 leading-tight">
				{label}
			</h2>
		</div>
	);
}

function SectionHeader({
	title,
	link,
}: {
	title: string;
	link?: { to: string; agentId: string };
}) {
	return (
		<div className="flex items-baseline justify-between mb-4">
			<h2 className="font-serif text-2xl text-stone-900">{title}</h2>
			{link && (
				<Link
					to={link.to}
					params={{ agentId: link.agentId }}
					className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500 hover:text-stone-900"
				>
					see all →
				</Link>
			)}
		</div>
	);
}

function EmptyNote({ text }: { text: string }) {
	return <p className="font-serif italic text-stone-400 text-sm">{text}</p>;
}

function BrainPreviewRow({
	agentId,
	path,
	year,
}: {
	agentId: Id<"agents">;
	path: string;
	year: number;
}) {
	const file = useQuery(api.brain.getFile, { agentId, path });
	return (
		<li className="py-4">
			<Link
				to="/agents/$agentId/brain"
				params={{ agentId }}
				search={{ path } as never}
				className="block group"
			>
				<div className="flex items-baseline justify-between gap-3 mb-1">
					<code className="font-mono text-xs text-stone-600 group-hover:text-stone-900">
						{path}
					</code>
					<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
						y{year}
					</span>
				</div>
				{file?.content && (
					<p className="font-serif text-stone-700 text-sm leading-relaxed line-clamp-3">
						{firstParagraph(file.content)}
					</p>
				)}
			</Link>
		</li>
	);
}

function FeedItem({ item }: { item: Doc<"consumedItems"> }) {
	return (
		<li className="border-l-2 border-stone-200 pl-3">
			<div className="flex items-baseline gap-2 mb-0.5">
				<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
					{item.tool}
				</span>
				<span className="font-mono text-[10px] text-stone-400">
					{phaseLabel(item.phaseInYear)}
				</span>
			</div>
			<p className="font-serif italic text-sm text-stone-600">{item.query}</p>
			{item.summary && (
				<p className="font-serif text-xs text-stone-500 mt-1 leading-snug line-clamp-2">
					{item.summary}
				</p>
			)}
		</li>
	);
}

function firstParagraph(md: string): string {
	const stripped = md
		.split("\n")
		.filter(
			(l) => !l.startsWith("#") && !l.startsWith("---") && l.trim() !== "",
		)
		.join(" ");
	return stripped.slice(0, 240);
}
