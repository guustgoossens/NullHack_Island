/**
 * Tiny LCS-based line diff for brain file history.
 * Returns array of { type: "ctx" | "add" | "del", text: string }.
 */
export type DiffLine = { type: "ctx" | "add" | "del"; text: string };

export function lineDiff(a: string, b: string): DiffLine[] {
	const aLines = a.split("\n");
	const bLines = b.split("\n");
	const m = aLines.length;
	const n = bLines.length;

	// Build LCS table
	const lcs: number[][] = Array.from({ length: m + 1 }, () =>
		new Array<number>(n + 1).fill(0),
	);
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (aLines[i] === bLines[j]) {
				lcs[i][j] = lcs[i + 1][j + 1] + 1;
			} else {
				lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
			}
		}
	}

	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (aLines[i] === bLines[j]) {
			out.push({ type: "ctx", text: aLines[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			out.push({ type: "del", text: aLines[i] });
			i++;
		} else {
			out.push({ type: "add", text: bLines[j] });
			j++;
		}
	}
	while (i < m) {
		out.push({ type: "del", text: aLines[i++] });
	}
	while (j < n) {
		out.push({ type: "add", text: bLines[j++] });
	}
	return out;
}
