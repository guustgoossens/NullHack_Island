import type { AnthropicTool } from "../lib/anthropic";

export type ToolCategory = "consume" | "create";
export type Artifact = "brain" | "room" | "portfolio";

export type ToolDef = {
	name: string;
	description: string;
	category: ToolCategory;
	// Which artifact (if any) a successful call satisfies in the three-artifact contract.
	artifactsTouched: Artifact[];
	inputSchema: AnthropicTool["input_schema"];
};

// CONSUME — pulled in for consumption phases AND for brain_read in creation phases.
export const CONSUME_TOOLS: ToolDef[] = [
	{
		name: "wikipedia",
		description:
			"Look up a topic on Wikipedia. Returns the article summary + linked topics so you can follow a thread.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				topic: {
					type: "string",
					description: "Topic title or query.",
				},
			},
			required: ["topic"],
		},
	},
	{
		name: "wikipedia_random",
		description:
			"Get a random Wikipedia article.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "web_search",
		description:
			"Search the open web. Returns top results with snippets.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Free-form search query" },
			},
			required: ["query"],
		},
	},
	{
		name: "web_fetch",
		description:
			"Fetch a single URL and return its readable text content.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute URL" },
			},
			required: ["url"],
		},
	},
	{
		name: "image_search",
		description:
			"Search for images. Returns image URLs with alt text and source pages.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
			},
			required: ["query"],
		},
	},
	{
		name: "pinterest_search",
		description:
			"Search Pinterest pins. Returns pin images and metadata.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
			},
			required: ["query"],
		},
	},
	{
		name: "music_search",
		description:
			"Search for music. Returns track metadata and lyrics when available; never audio.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
			},
			required: ["query"],
		},
	},
	{
		name: "poetry_search",
		description:
			"Search for poems by author or title. Returns full poem text when available.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
			},
			required: ["query"],
		},
	},
	{
		name: "arxiv_search",
		description:
			"Search arXiv for papers. Returns titles and abstracts.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
			},
			required: ["query"],
		},
	},
	{
		name: "brain_read",
		description:
			"Read the full content of a brain file by path. Use when a file was truncated from your context.",
		category: "consume",
		artifactsTouched: [],
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
			},
			required: ["path"],
		},
	},
];

// CREATE — only available in creation phases.
export const CREATE_TOOLS: ToolDef[] = [
	{
		name: "brain_write",
		description:
			"Create or overwrite a brain file. The brain is your live state of mind, not a journal — name files for what they hold (a stance, a fixation, a current configuration of you), not for the year. Overwrite freely as you change. Slash-delimited paths are allowed for organisation.",
		category: "create",
		artifactsTouched: ["brain"],
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				content: { type: "string" },
			},
			required: ["path", "content"],
		},
	},
	{
		name: "brain_delete",
		description:
			"Delete a brain file. Old versions are preserved in history. Use when a file no longer reflects who you are.",
		category: "create",
		artifactsTouched: ["brain"],
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
			},
			required: ["path"],
		},
	},
	{
		name: "room_rewrite",
		description:
			"Rewrite the interior of your room. Describe what is inside it — furniture, surfaces, objects, art, color, light, what hangs on the walls. The viewpoint, walls, window, floor and dimensions are fixed and will not change; only the interior design does. Be visual and concrete.",
		category: "create",
		artifactsTouched: ["room"],
		inputSchema: {
			type: "object",
			properties: {
				prompt: { type: "string" },
			},
			required: ["prompt"],
		},
	},
	{
		name: "portfolio_curate",
		description:
			"Save something you have already consumed into your portfolio with your own commentary. For pinterest_search and image_search items, the first matching image is pinned to your portfolio inline.",
		category: "create",
		artifactsTouched: ["portfolio"],
		inputSchema: {
			type: "object",
			properties: {
				consumedItemId: {
					type: "string",
					description:
						"The id of a consumedItems row from the recent feed. Pass the exact id string.",
				},
				resultIndex: {
					type: "integer",
					description:
						"For pinterest_search / image_search items, which result in the list to keep (0 = first). Defaults to 0.",
					minimum: 0,
				},
				title: { type: "string" },
				caption: {
					type: "string",
					description: "Your commentary — what this means to you.",
				},
			},
			required: ["consumedItemId", "title", "caption"],
		},
	},
	{
		name: "portfolio_create_image",
		description:
			"Generate a new image and add it to your portfolio.",
		category: "create",
		artifactsTouched: ["portfolio"],
		inputSchema: {
			type: "object",
			properties: {
				prompt: { type: "string" },
				title: { type: "string" },
				caption: { type: "string" },
			},
			required: ["prompt", "title", "caption"],
		},
	},
	{
		name: "portfolio_create_ascii",
		description: "Add an ASCII-art piece (or any plain text artwork) to your portfolio.",
		category: "create",
		artifactsTouched: ["portfolio"],
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				text: { type: "string" },
				caption: { type: "string" },
			},
			required: ["title", "text", "caption"],
		},
	},
	{
		name: "portfolio_create_poem",
		description: "Add a poem of your own writing to your portfolio.",
		category: "create",
		artifactsTouched: ["portfolio"],
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				text: { type: "string" },
				caption: { type: "string" },
			},
			required: ["title", "text", "caption"],
		},
	},
	{
		name: "portfolio_create_writing",
		description:
			"Add a piece of writing to your portfolio. Distinct from your brain — this is for the public.",
		category: "create",
		artifactsTouched: ["portfolio"],
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				markdown: { type: "string" },
				caption: { type: "string" },
			},
			required: ["title", "markdown", "caption"],
		},
	},
	{
		name: "portfolio_create_html",
		description:
			"Add an HTML/CSS/JS artwork to your portfolio. Will be rendered in a sandbox and screenshotted.",
		category: "create",
		artifactsTouched: ["portfolio"],
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				html: { type: "string" },
				caption: { type: "string" },
			},
			required: ["title", "html", "caption"],
		},
	},
	{
		name: "portfolio_create_threejs",
		description:
			"Add a Three.js scene to your portfolio. Provide the JS code that defines the scene.",
		category: "create",
		artifactsTouched: ["portfolio"],
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				code: { type: "string" },
				caption: { type: "string" },
			},
			required: ["title", "code", "caption"],
		},
	},
	{
		name: "portfolio_create_manim",
		description:
			"Add a Manim animation to your portfolio. Provide the Python code that uses manim.",
		category: "create",
		artifactsTouched: ["portfolio"],
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				code: { type: "string" },
				caption: { type: "string" },
			},
			required: ["title", "code", "caption"],
		},
	},
];

export function toolsForPhase(phase: "consumption" | "creation"): ToolDef[] {
	if (phase === "consumption") return CONSUME_TOOLS;
	// Creation phases get create tools + brain_read (read-only consume).
	const brainRead = CONSUME_TOOLS.filter((t) => t.name === "brain_read");
	return [...CREATE_TOOLS, ...brainRead];
}

export function toAnthropicTools(tools: ToolDef[]): AnthropicTool[] {
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: t.inputSchema,
	}));
}
