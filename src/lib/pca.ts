// Tiny PCA via Jacobi eigendecomposition on the 8x8 covariance matrix.
//
// We do this on the client because (a) the matrix is at most 8x8 with at most
// ~60 rows and (b) it lets the chart re-fit instantly when the user toggles
// agents. Numerical accuracy is not interesting here — Jacobi converges in
// microseconds and we have no need for anything fancier.

export type Pca = {
	mean: number[];
	// `components[i]` is the i-th principal direction in the original 8-D space.
	components: number[][];
	// Eigenvalues (sorted descending). variance share = eig[i] / sum(eig).
	eigenvalues: number[];
	explained: number[];
	// Each input row projected onto all 8 components.
	projected: number[][];
};

/**
 * Compute a PCA over rows = samples, cols = features.
 * Centers but does not scale (the inputs are already on the same 1..10 scale).
 * Returns at least the requested number of components (we always compute all
 * 8 since the matrix is tiny — caller slices what it needs).
 */
export function pca(matrix: number[][]): Pca | null {
	if (matrix.length < 2) return null;
	const n = matrix.length;
	const d = matrix[0].length;
	if (d === 0) return null;

	// Mean-center.
	const mean = new Array(d).fill(0);
	for (const row of matrix) {
		for (let j = 0; j < d; j++) mean[j] += row[j];
	}
	for (let j = 0; j < d; j++) mean[j] /= n;

	const centered: number[][] = matrix.map((row) =>
		row.map((v, j) => v - mean[j]),
	);

	// Covariance matrix (d x d).
	const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
	for (const row of centered) {
		for (let i = 0; i < d; i++) {
			for (let j = i; j < d; j++) {
				cov[i][j] += row[i] * row[j];
			}
		}
	}
	const denom = Math.max(1, n - 1);
	for (let i = 0; i < d; i++) {
		for (let j = i; j < d; j++) {
			cov[i][j] /= denom;
			cov[j][i] = cov[i][j];
		}
	}

	const { values, vectors } = jacobiEigen(cov);

	// Sort by eigenvalue desc.
	const order = values
		.map((v, i) => ({ v, i }))
		.sort((a, b) => b.v - a.v)
		.map((o) => o.i);
	const sortedValues = order.map((i) => values[i]);
	// vectors is column-major: vectors[i][k] = i-th component of the k-th eigenvector.
	const sortedComponents = order.map((k) => vectors.map((row) => row[k]));

	const totalVar = sortedValues.reduce(
		(acc, v) => acc + Math.max(0, v),
		0,
	);
	const explained = sortedValues.map((v) =>
		totalVar > 0 ? Math.max(0, v) / totalVar : 0,
	);

	const projected = centered.map((row) =>
		sortedComponents.map((comp) =>
			row.reduce((acc, x, k) => acc + x * comp[k], 0),
		),
	);

	return {
		mean,
		components: sortedComponents,
		eigenvalues: sortedValues,
		explained,
		projected,
	};
}

// Jacobi eigendecomposition for a symmetric matrix.
// Returns eigenvalues + a matrix V with column k = eigenvector k.
function jacobiEigen(input: number[][]): {
	values: number[];
	vectors: number[][];
} {
	const n = input.length;
	const A = input.map((r) => r.slice());
	const V: number[][] = Array.from({ length: n }, (_, i) =>
		Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
	);

	const MAX_SWEEPS = 80;
	const EPS = 1e-12;

	for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
		// Off-diagonal sum of squares — convergence test.
		let off = 0;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
		}
		if (off < EPS) break;

		for (let p = 0; p < n - 1; p++) {
			for (let q = p + 1; q < n; q++) {
				const apq = A[p][q];
				if (Math.abs(apq) < 1e-14) continue;
				const app = A[p][p];
				const aqq = A[q][q];
				const theta = (aqq - app) / (2 * apq);
				const t =
					theta >= 0
						? 1 / (theta + Math.sqrt(1 + theta * theta))
						: 1 / (theta - Math.sqrt(1 + theta * theta));
				const c = 1 / Math.sqrt(1 + t * t);
				const s = t * c;

				A[p][p] = app - t * apq;
				A[q][q] = aqq + t * apq;
				A[p][q] = 0;
				A[q][p] = 0;
				for (let k = 0; k < n; k++) {
					if (k !== p && k !== q) {
						const akp = A[k][p];
						const akq = A[k][q];
						A[k][p] = c * akp - s * akq;
						A[p][k] = A[k][p];
						A[k][q] = s * akp + c * akq;
						A[q][k] = A[k][q];
					}
					const vkp = V[k][p];
					const vkq = V[k][q];
					V[k][p] = c * vkp - s * vkq;
					V[k][q] = s * vkp + c * vkq;
				}
			}
		}
	}

	const values = new Array(n).fill(0).map((_, i) => A[i][i]);
	return { values, vectors: V };
}
