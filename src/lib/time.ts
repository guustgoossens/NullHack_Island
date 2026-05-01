import type { Doc } from "../../convex/_generated/dataModel";

/** Returns the agent's current simulated age in years. */
export function ageOf(agent: Pick<Doc<"agents">, "currentYear">): number {
	return agent.currentYear ?? 0;
}

/** Phase-in-year 0..3 = consumption season, 4 = creation phase. */
export function phaseLabel(phase: number): string {
	if (phase >= 4) return "creation";
	const seasons = ["spring", "summer", "autumn", "winter"];
	return seasons[phase] ?? `phase ${phase}`;
}

export function formatStatus(status: Doc<"agents">["status"]): string {
	switch (status) {
		case "alive":
			return "alive";
		case "paused":
			return "paused";
		case "dead":
			return "passed";
		default:
			return status;
	}
}

export function relativeTime(ms: number): string {
	const diff = Date.now() - ms;
	if (diff < 0) return "soon";
	const sec = Math.round(diff / 1000);
	if (sec < 60) return `${sec}s ago`;
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const days = Math.round(hr / 24);
	return `${days}d ago`;
}
