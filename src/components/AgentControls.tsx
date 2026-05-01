import { useMutation } from "convex/react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

export function AgentControls({ agent }: { agent: Doc<"agents"> }) {
	const pause = useMutation(api.agents.pause);
	const resume = useMutation(api.agents.resume);
	const setSpeed = useMutation(api.agents.setSpeed);
	const [seconds, setSeconds] = useState(agent.secondsPerYear);
	const [busy, setBusy] = useState(false);

	const togglePause = async () => {
		setBusy(true);
		try {
			if (agent.status === "alive") await pause({ agentId: agent._id });
			else if (agent.status === "paused") await resume({ agentId: agent._id });
		} finally {
			setBusy(false);
		}
	};

	const commitSpeed = async (val: number) => {
		setSeconds(val);
		await setSpeed({ agentId: agent._id, secondsPerYear: val });
	};

	return (
		<div className="flex flex-wrap items-center gap-4 text-stone-700">
			<button
				type="button"
				onClick={togglePause}
				disabled={busy || agent.status === "dead"}
				className="px-4 py-2 border border-stone-300 hover:border-stone-900 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-50"
			>
				{agent.status === "alive" ? "Pause" : "Resume"}
			</button>
			<label className="flex items-center gap-3">
				<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
					Speed
				</span>
				<input
					type="range"
					min={30}
					max={300}
					step={10}
					value={seconds}
					onChange={(e) => setSeconds(Number(e.target.value))}
					onMouseUp={(e) =>
						commitSpeed(Number((e.target as HTMLInputElement).value))
					}
					onTouchEnd={(e) =>
						commitSpeed(Number((e.target as HTMLInputElement).value))
					}
					className="w-40 accent-stone-700"
				/>
				<span className="font-mono text-xs text-stone-600 tabular-nums w-14">
					{seconds}s/yr
				</span>
			</label>
		</div>
	);
}
