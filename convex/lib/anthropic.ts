import Anthropic from "@anthropic-ai/sdk";

export const TICK_MODEL = "claude-haiku-4-5-20251001";
export const OBSERVER_MODEL = "claude-haiku-4-5-20251001";

export function getAnthropic(): Anthropic {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error(
			"ANTHROPIC_API_KEY is not set. Set it via `npx convex env set ANTHROPIC_API_KEY <key>`.",
		);
	}
	return new Anthropic({ apiKey });
}

export type AnthropicMessage = Anthropic.Messages.MessageParam;
export type AnthropicTool = Anthropic.Messages.Tool;
export type AnthropicContentBlock = Anthropic.Messages.ContentBlock;
