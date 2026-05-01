import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { lineDiff } from "../../../lib/diff";
import { Markdown } from "../../../lib/markdown";

type BrainEntry = {
	_id: string;
	path: string;
	currentVersion: number;
	createdAtYear: number;
	lastUpdatedYear: number;
	deleted: boolean;
};

type TreeNode = {
	name: string;
	fullPath: string;
	children: Map<string, TreeNode>;
	entry?: BrainEntry;
};

type BrainSearch = { path?: string; v?: number; cmp?: number };

export const Route = createFileRoute("/agents/$agentId/brain")({
	validateSearch: (s: Record<string, unknown>): BrainSearch => ({
		path: typeof s.path === "string" ? s.path : undefined,
		v: typeof s.v === "number" ? s.v : undefined,
		cmp: typeof s.cmp === "number" ? s.cmp : undefined,
	}),
	component: BrainPage,
});

function BrainPage() {
	const { agentId } = useParams({ strict: false }) as {
		agentId: Id<"agents">;
	};
	const search = useSearch({ strict: false }) as BrainSearch;
	const navigate = Route.useNavigate();
	const tree = useQuery(api.brain.tree, { agentId });

	const root = useMemo(() => buildTree(tree ?? []), [tree]);

	const selectedPath = search.path ?? tree?.[0]?.path;
	const file = useQuery(
		api.brain.getFile,
		selectedPath ? { agentId, path: selectedPath } : "skip",
	);
	const history = useQuery(
		api.brain.fileHistory,
		selectedPath ? { agentId, path: selectedPath } : "skip",
	);

	const setSelected = (path: string) =>
		navigate({ search: { path } as never, replace: false });

	return (
		<main className="mx-auto max-w-6xl px-6 py-8 grid lg:grid-cols-[280px_1fr] gap-8">
			<aside className="lg:sticky lg:top-[120px] lg:self-start">
				<div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400 mb-3">
					{tree?.length ?? 0} files
				</div>
				<div className="border border-stone-200 bg-white max-h-[70vh] overflow-y-auto">
					<TreeView
						node={root}
						depth={0}
						selectedPath={selectedPath}
						onSelect={setSelected}
					/>
				</div>
			</aside>

			<div>
				{!selectedPath ? (
					<p className="font-serif italic text-stone-500">
						The brain is still empty.
					</p>
				) : (
					<BrainFileView
						agentId={agentId}
						path={selectedPath}
						content={file?.content ?? ""}
						currentVersion={file?.currentVersion ?? 1}
						versions={history ?? []}
						compareVersion={search.cmp}
						setCompare={(cmp) =>
							navigate({
								search: { path: selectedPath, cmp } as never,
								replace: true,
							})
						}
					/>
				)}
			</div>
		</main>
	);
}

function BrainFileView({
	agentId: _agentId,
	path,
	content,
	currentVersion,
	versions,
	compareVersion,
	setCompare,
}: {
	agentId: Id<"agents">;
	path: string;
	content: string;
	currentVersion: number;
	versions: Array<{
		_id: string;
		version: number;
		content: string;
		year: number;
		op: "create" | "update" | "delete";
	}>;
	compareVersion: number | undefined;
	setCompare: (v: number | undefined) => void;
}) {
	const compare = versions.find((v) => v.version === compareVersion);
	const diff = compare ? lineDiff(compare.content, content) : null;

	return (
		<article>
			<header className="border-b border-stone-200 pb-4 mb-6 flex items-baseline justify-between gap-4">
				<div>
					<code className="font-mono text-sm text-stone-600">{path}</code>
					<div className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400 mt-1">
						v{currentVersion}
					</div>
				</div>
				{compareVersion !== undefined && (
					<button
						type="button"
						onClick={() => setCompare(undefined)}
						className="font-mono text-[10px] uppercase tracking-[0.18em] underline text-stone-600"
					>
						stop comparing
					</button>
				)}
			</header>

			{diff ? <DiffBlock diff={diff} /> : <Markdown source={content} />}

			{versions.length > 1 && (
				<section className="mt-10 pt-6 border-t border-stone-200">
					<h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500 mb-3">
						Version history
					</h3>
					<ul className="space-y-1">
						{versions.map((v) => {
							const isCurrent = v.version === currentVersion;
							const isComparing = v.version === compareVersion;
							return (
								<li
									key={v._id}
									className="flex items-center gap-3 font-mono text-xs"
								>
									<span className="w-12 text-stone-500">v{v.version}</span>
									<span className="w-16 text-stone-400">y{v.year}</span>
									<span className="w-16 text-stone-400 uppercase tracking-[0.18em] text-[10px]">
										{v.op}
									</span>
									<span className="text-stone-600 truncate flex-1">
										{firstLine(v.content)}
									</span>
									{!isCurrent && (
										<button
											type="button"
											onClick={() =>
												setCompare(isComparing ? undefined : v.version)
											}
											className="text-stone-700 hover:text-stone-900 underline"
										>
											{isComparing ? "comparing" : "diff against current"}
										</button>
									)}
								</li>
							);
						})}
					</ul>
				</section>
			)}
		</article>
	);
}

function DiffBlock({ diff }: { diff: ReturnType<typeof lineDiff> }) {
	return (
		<pre className="font-mono text-[12px] leading-snug whitespace-pre-wrap border border-stone-200 p-4 bg-stone-50 overflow-x-auto">
			{diff.map((d, i) => {
				const cls =
					d.type === "add"
						? "diff-add"
						: d.type === "del"
							? "diff-del"
							: "text-stone-700";
				const sigil = d.type === "add" ? "+ " : d.type === "del" ? "- " : "  ";
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: diff line position is part of identity
					<span key={`${i}-${d.type}-${d.text}`} className={`block ${cls}`}>
						{sigil}
						{d.text || " "}
					</span>
				);
			})}
		</pre>
	);
}

function TreeView({
	node,
	depth,
	selectedPath,
	onSelect,
}: {
	node: TreeNode;
	depth: number;
	selectedPath: string | undefined;
	onSelect: (path: string) => void;
}) {
	const children = Array.from(node.children.values()).sort((a, b) => {
		const aLeaf = a.entry !== undefined && a.children.size === 0;
		const bLeaf = b.entry !== undefined && b.children.size === 0;
		if (aLeaf !== bLeaf) return aLeaf ? 1 : -1; // folders first
		return a.name.localeCompare(b.name);
	});
	return (
		<ul>
			{children.map((c) => (
				<TreeRow
					key={c.fullPath}
					node={c}
					depth={depth}
					selectedPath={selectedPath}
					onSelect={onSelect}
				/>
			))}
		</ul>
	);
}

function TreeRow({
	node,
	depth,
	selectedPath,
	onSelect,
}: {
	node: TreeNode;
	depth: number;
	selectedPath: string | undefined;
	onSelect: (path: string) => void;
}) {
	const [open, setOpen] = useState(true);
	const isFile = node.children.size === 0 && node.entry !== undefined;
	const isSelected = selectedPath === node.fullPath;
	const indent = { paddingLeft: `${depth * 12 + 10}px` };

	if (isFile && node.entry) {
		return (
			<li>
				<button
					type="button"
					onClick={() => onSelect(node.fullPath)}
					style={indent}
					className={`block w-full text-left py-1.5 pr-3 font-mono text-xs hover:bg-stone-100 ${
						isSelected
							? "bg-stone-900 text-stone-50 hover:bg-stone-900"
							: "text-stone-700"
					}`}
				>
					<span className="truncate">{node.name}</span>
				</button>
			</li>
		);
	}

	return (
		<li>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				style={indent}
				className="block w-full text-left py-1.5 pr-3 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500 hover:bg-stone-100"
			>
				{open ? "▾" : "▸"} {node.name}/
			</button>
			{open && (
				<TreeView
					node={node}
					depth={depth + 1}
					selectedPath={selectedPath}
					onSelect={onSelect}
				/>
			)}
		</li>
	);
}

function buildTree(entries: BrainEntry[]): TreeNode {
	const root: TreeNode = {
		name: "",
		fullPath: "",
		children: new Map(),
	};
	for (const entry of entries) {
		const parts = entry.path.split("/");
		let cur = root;
		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			let child = cur.children.get(p);
			if (!child) {
				const fullPath = parts.slice(0, i + 1).join("/");
				child = { name: p, fullPath, children: new Map() };
				cur.children.set(p, child);
			}
			if (i === parts.length - 1) child.entry = entry;
			cur = child;
		}
	}
	return root;
}

function firstLine(s: string): string {
	return s.split("\n").find((l) => l.trim() !== "") ?? "";
}
