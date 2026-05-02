import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import {
	AGENT_MODELS,
	type AgentModelId,
	DEFAULT_AGENT_MODEL,
} from "../../convex/lib/models";

export function AgentControls({ agent }: { agent: Doc<"agents"> }) {
	const navigate = useNavigate();
	const pause = useMutation(api.agents.pause);
	const resume = useMutation(api.agents.resume);
	const setSpeed = useMutation(api.agents.setSpeed);
	const setModel = useMutation(api.agents.setModel);
	const remove = useMutation(api.agents.remove);
	const [seconds, setSeconds] = useState(agent.secondsPerYear);
	const [busy, setBusy] = useState(false);
	const dragging = useRef(false);
	const currentModel = (agent.model ?? DEFAULT_AGENT_MODEL) as AgentModelId;

	// Keep the slider in sync with the persisted value when the user isn't
	// actively dragging. Without this the slider only ever reflects the value
	// at mount time.
	useEffect(() => {
		if (!dragging.current) setSeconds(agent.secondsPerYear);
	}, [agent.secondsPerYear]);

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
		dragging.current = false;
		await setSpeed({ agentId: agent._id, secondsPerYear: val });
	};

	const commitModel = async (val: AgentModelId) => {
		await setModel({ agentId: agent._id, model: val });
	};

	const confirmDelete = async () => {
		if (busy) return;
		const ok = window.confirm(
			`Delete ${agent.name}? This permanently removes their brain, room, portfolio, and history.`,
		);
		if (!ok) return;
		setBusy(true);
		try {
			await remove({ agentId: agent._id });
			await navigate({ to: "/" });
		} finally {
			setBusy(false);
		}
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
					min={0}
					max={300}
					step={5}
					value={seconds}
					onPointerDown={() => {
						dragging.current = true;
					}}
					onChange={(e) => setSeconds(Number(e.target.value))}
					onPointerUp={(e) =>
						commitSpeed(Number((e.target as HTMLInputElement).value))
					}
					onKeyUp={(e) =>
						commitSpeed(Number((e.target as HTMLInputElement).value))
					}
					className="w-40 accent-stone-700"
				/>
				<span className="font-mono text-xs text-stone-600 tabular-nums w-14">
					{seconds}s/yr
				</span>
			</label>
			<label className="flex items-center gap-3">
				<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
					Model
				</span>
				<select
					value={currentModel}
					onChange={(e) => commitModel(e.target.value as AgentModelId)}
					disabled={agent.status === "dead"}
					className="px-2 py-1.5 border border-stone-300 bg-white font-mono text-xs disabled:opacity-50 focus:border-stone-600 focus:outline-none"
				>
					{AGENT_MODELS.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
			</label>
			<button
				type="button"
				onClick={confirmDelete}
				disabled={busy}
				className="px-3 py-2 border border-stone-300 hover:border-red-600 hover:text-red-700 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-50"
			>
				Delete
			</button>
		</div>
	);
}
