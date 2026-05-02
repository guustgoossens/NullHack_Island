import Anthropic from "@anthropic-ai/sdk";
import type { Doc } from "../_generated/dataModel";
import {
	type AgentModelId,
	DEFAULT_AGENT_MODEL,
	isAgentModel,
} from "./models";

export {
	AGENT_MODELS,
	type AgentModelId,
	DEFAULT_AGENT_MODEL,
	isAgentModel,
} from "./models";

// Observer/assessment is held constant (does not honor agent.model) so
// personality scoring stays comparable across agents.
export const OBSERVER_MODEL = "claude-haiku-4-5-20251001";

// Kept for any legacy import sites; new code should use tickModelFor(agent).
export const TICK_MODEL: AgentModelId = DEFAULT_AGENT_MODEL;

export function tickModelFor(agent: Pick<Doc<"agents">, "model">): AgentModelId {
	const m = agent.model;
	return m && isAgentModel(m) ? m : DEFAULT_AGENT_MODEL;
}

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
