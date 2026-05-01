import { Link, useParams } from "@tanstack/react-router";

type Item = { to: string; label: string; end?: boolean };
const items: Item[] = [
	{ to: "/agents/$agentId", label: "Home", end: true },
	{ to: "/agents/$agentId/timeline", label: "Timeline" },
	{ to: "/agents/$agentId/brain", label: "Brain" },
	{ to: "/agents/$agentId/room", label: "Room" },
	{ to: "/agents/$agentId/portfolio", label: "Portfolio" },
	{ to: "/agents/$agentId/feed", label: "Feed" },
];

export function AgentSubnav() {
	const { agentId } = useParams({ strict: false }) as { agentId: string };
	return (
		<nav className="border-b border-stone-200 bg-stone-50 sticky top-[64px] z-20">
			<div className="mx-auto max-w-6xl px-6 flex gap-1 overflow-x-auto">
				{items.map((it) => (
					<Link
						key={it.to}
						to={it.to}
						params={{ agentId }}
						activeOptions={{ exact: it.end }}
						className="px-3 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 border-b-2 border-transparent"
						activeProps={{
							className:
								"px-3 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-900 border-b-2 border-stone-900",
						}}
					>
						{it.label}
					</Link>
				))}
			</div>
		</nav>
	);
}
