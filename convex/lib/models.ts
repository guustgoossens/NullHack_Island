// Model registry shared by server (tick/genesis) and client (BirthModal,
// AgentControls). Kept SDK-free so it can be imported from React without
// pulling the Anthropic node SDK into the browser bundle.

export const AGENT_MODELS = [
	{ id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
	{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
	{ id: "claude-opus-4-7", label: "Opus 4.7" },
] as const;

export type AgentModelId = (typeof AGENT_MODELS)[number]["id"];

export const DEFAULT_AGENT_MODEL: AgentModelId = "claude-haiku-4-5-20251001";

export function isAgentModel(s: string): s is AgentModelId {
	return AGENT_MODELS.some((m) => m.id === s);
}
