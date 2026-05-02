import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import {
	AGENT_MODELS,
	type AgentModelId,
	DEFAULT_AGENT_MODEL,
} from "../../convex/lib/models";

const COHORT_SIZE = 8;

type Member = { name: string; model: AgentModelId };

const DEFAULT_NAMES = [
	"Mira",
	"Lior",
	"Andros",
	"Hana",
	"Ezra",
	"Wren",
	"Iris",
	"Cyrus",
];

export function CohortBirthModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: (createdId?: string) => void;
}) {
	const birth = useMutation(api.cohort.birthCohort);
	const [cohortName, setCohortName] = useState("Atrium");
	const [commonsName, setCommonsName] = useState("");
	const [commonsModel, setCommonsModel] = useState<AgentModelId>(DEFAULT_AGENT_MODEL);
	const [secondsPerYear, setSecondsPerYear] = useState(15);
	const [members, setMembers] = useState<Member[]>(() =>
		DEFAULT_NAMES.map((name) => ({ name, model: DEFAULT_AGENT_MODEL })),
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dlg = dialogRef.current;
		if (!dlg) return;
		if (open && !dlg.open) dlg.showModal();
		if (!open && dlg.open) dlg.close();
	}, [open]);

	function updateMember(idx: number, patch: Partial<Member>) {
		setMembers((prev) =>
			prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
		);
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const trimmed = members.map((m) => ({
			name: m.name.trim(),
			model: m.model,
		}));
		if (trimmed.some((m) => !m.name)) {
			setError("Every agent needs a name.");
			return;
		}
		setSubmitting(true);
		try {
			const id = await birth({
				name: cohortName.trim() || "Atrium",
				members: trimmed,
				commonsName: commonsName.trim() || undefined,
				commonsModel,
				secondsPerYear,
			});
			onClose(id);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<dialog
			ref={dialogRef}
			onClose={() => onClose()}
			className="backdrop:bg-stone-900/40 bg-stone-50 border border-stone-200 p-0 max-w-3xl w-full open:flex open:flex-col"
		>
			<form onSubmit={submit} className="p-7 flex flex-col gap-5">
				<div className="border-b border-stone-200 pb-4">
					<h2 className="font-serif text-3xl text-stone-900">
						Birth a cohort
					</h2>
					<p className="font-serif italic text-stone-500 text-sm mt-1">
						eight individuals + one commons. they convene every four years.
					</p>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<Field label="Cohort name">
						<input
							value={cohortName}
							onChange={(e) => setCohortName(e.target.value)}
							className="w-full px-3 py-2 border border-stone-300 bg-white font-serif text-base focus:border-stone-600 focus:outline-none"
						/>
					</Field>
					<Field label="Seconds per simulated year">
						<div className="flex items-center gap-3">
							<input
								type="range"
								min={5}
								max={120}
								step={5}
								value={secondsPerYear}
								onChange={(e) =>
									setSecondsPerYear(Number(e.target.value))
								}
								className="flex-1 accent-stone-700"
							/>
							<span className="font-mono text-sm text-stone-600 tabular-nums w-16 text-right">
								{secondsPerYear}s
							</span>
						</div>
					</Field>
				</div>

				<div className="border border-stone-200 bg-white">
					<div className="px-3 py-2 border-b border-stone-200 flex items-baseline justify-between">
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
							Eight individuals
						</span>
						<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
							pairing order — (0,1) (2,3) (4,5) (6,7) → fours → all eight
						</span>
					</div>
					<div className="divide-y divide-stone-100">
						{Array.from({ length: COHORT_SIZE }).map((_, i) => (
							<div
								key={i}
								className="grid grid-cols-[28px_1fr_180px] items-center gap-2 px-3 py-2"
							>
								<span className="font-mono text-xs text-stone-400 tabular-nums">
									{i}
								</span>
								<input
									required
									value={members[i].name}
									onChange={(e) =>
										updateMember(i, { name: e.target.value })
									}
									placeholder={DEFAULT_NAMES[i]}
									className="px-2 py-1 border border-stone-200 bg-stone-50 font-serif text-base focus:border-stone-500 focus:outline-none"
								/>
								<select
									value={members[i].model}
									onChange={(e) =>
										updateMember(i, {
											model: e.target.value as AgentModelId,
										})
									}
									className="px-2 py-1 border border-stone-200 bg-stone-50 font-mono text-xs focus:border-stone-500 focus:outline-none"
								>
									{AGENT_MODELS.map((m) => (
										<option key={m.id} value={m.id}>
											{m.label}
										</option>
									))}
								</select>
							</div>
						))}
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<Field label="Commons name">
						<input
							value={commonsName}
							onChange={(e) => setCommonsName(e.target.value)}
							placeholder="auto: <cohort> Commons"
							className="w-full px-3 py-2 border border-stone-300 bg-white font-serif text-base focus:border-stone-600 focus:outline-none"
						/>
					</Field>
					<Field label="Commons model">
						<select
							value={commonsModel}
							onChange={(e) =>
								setCommonsModel(e.target.value as AgentModelId)
							}
							className="w-full px-3 py-2 border border-stone-300 bg-white font-mono text-sm focus:border-stone-600 focus:outline-none"
						>
							{AGENT_MODELS.map((m) => (
								<option key={m.id} value={m.id}>
									{m.label}
								</option>
							))}
						</select>
					</Field>
				</div>

				{error && (
					<div className="text-sm text-red-700 font-mono bg-red-50 border border-red-200 px-3 py-2">
						{error}
					</div>
				)}

				<div className="flex items-center justify-end gap-3 pt-2 border-t border-stone-200">
					<button
						type="button"
						onClick={() => onClose()}
						className="px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-stone-600 hover:text-stone-900"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="px-5 py-2 bg-stone-900 text-stone-50 font-mono text-xs uppercase tracking-[0.18em] hover:bg-stone-700 disabled:opacity-50"
					>
						{submitting ? "Birthing 9…" : "Birth cohort"}
					</button>
				</div>
			</form>
		</dialog>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: control passed as children
		<label className="flex flex-col gap-1.5">
			<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
				{label}
			</span>
			{children}
		</label>
	);
}
