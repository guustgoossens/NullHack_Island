import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import {
	AGENT_MODELS,
	type AgentModelId,
	DEFAULT_AGENT_MODEL,
} from "../../convex/lib/models";

export function BirthModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const birth = useMutation(api.birth.birth);
	const [name, setName] = useState("");
	const [secondsPerYear, setSecondsPerYear] = useState(0);
	const [model, setModel] = useState<AgentModelId>(DEFAULT_AGENT_MODEL);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dlg = dialogRef.current;
		if (!dlg) return;
		if (open && !dlg.open) dlg.showModal();
		if (!open && dlg.open) dlg.close();
	}, [open]);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await birth({
				name: name.trim(),
				secondsPerYear,
				model,
			});
			setName("");
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<dialog
			ref={dialogRef}
			onClose={onClose}
			className="backdrop:bg-stone-900/40 bg-stone-50 border border-stone-200 p-0 max-w-xl w-full open:flex open:flex-col"
		>
			<form onSubmit={submit} className="p-7 flex flex-col gap-5">
				<div className="border-b border-stone-200 pb-4">
					<h2 className="font-serif text-3xl text-stone-900">
						Birth a new agent
					</h2>
					<p className="font-serif italic text-stone-500 text-sm mt-1">
						a name, a pace. they pick their own seed and their own room.
					</p>
				</div>

				<Field label="Name">
					<input
						required
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Mira, Lior, Andros…"
						className="w-full px-3 py-2 border border-stone-300 bg-white font-serif text-lg focus:border-stone-600 focus:outline-none"
					/>
				</Field>

				<Field label="Seconds per simulated year">
					<div className="flex items-center gap-3">
						<input
							type="range"
							min={0}
							max={300}
							step={5}
							value={secondsPerYear}
							onChange={(e) => setSecondsPerYear(Number(e.target.value))}
							className="flex-1 accent-stone-700"
						/>
						<span className="font-mono text-sm text-stone-600 tabular-nums w-16 text-right">
							{secondsPerYear}s
						</span>
					</div>
				</Field>

				<Field label="Model">
					<select
						value={model}
						onChange={(e) => setModel(e.target.value as AgentModelId)}
						className="w-full px-3 py-2 border border-stone-300 bg-white font-serif text-base focus:border-stone-600 focus:outline-none"
					>
						{AGENT_MODELS.map((m) => (
							<option key={m.id} value={m.id}>
								{m.label}
							</option>
						))}
					</select>
				</Field>

				<p className="font-serif italic text-xs text-stone-500 leading-relaxed border-l-2 border-stone-300 pl-3">
					On birth, the agent runs a one-shot self-genesis: it writes its own
					birth seed and rates itself on eight personality axes. The room
					starts as a blank canvas you don't see them write — that comes later.
				</p>

				{error && (
					<div className="text-sm text-red-700 font-mono bg-red-50 border border-red-200 px-3 py-2">
						{error}
					</div>
				)}

				<div className="flex items-center justify-end gap-3 pt-2 border-t border-stone-200">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-stone-600 hover:text-stone-900"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="px-5 py-2 bg-stone-900 text-stone-50 font-mono text-xs uppercase tracking-[0.18em] hover:bg-stone-700 disabled:opacity-50"
					>
						{submitting ? "Birthing…" : "Birth"}
					</button>
				</div>
			</form>
		</dialog>
	);
}

function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: control passed as children
		<label className="flex flex-col gap-1.5">
			<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
				{label}
			</span>
			{children}
			{hint && (
				<span className="font-serif italic text-xs text-stone-500">{hint}</span>
			)}
		</label>
	);
}
