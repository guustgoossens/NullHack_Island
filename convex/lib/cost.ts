// Pricing tables for cost accounting. Prices are USD per 1M tokens unless noted.

export const ANTHROPIC_PRICING: Record<
	string,
	{ inputPer1M: number; outputPer1M: number }
> = {
	"claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
	"claude-haiku-4-5-20251001": { inputPer1M: 1, outputPer1M: 5 },
};

export function anthropicCostUsd(
	model: string,
	tokensIn: number,
	tokensOut: number,
): number {
	const p = ANTHROPIC_PRICING[model];
	if (!p) return 0;
	return (
		(tokensIn / 1_000_000) * p.inputPer1M +
		(tokensOut / 1_000_000) * p.outputPer1M
	);
}

// gemini-3.1-flash-image-preview at 1K: 1120 output tokens at ~$60/1M = ~$0.067/image.
export const IMAGE_GEN_USD_PER_IMAGE = 0.067;
