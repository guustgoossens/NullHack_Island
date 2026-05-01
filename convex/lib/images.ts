import OpenAI from "openai";

export const IMAGE_MODEL = "gpt-image-2";

export function getOpenAI(): OpenAI {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error(
			"OPENAI_API_KEY is not set. Set it via `npx convex env set OPENAI_API_KEY <key>`.",
		);
	}
	return new OpenAI({ apiKey });
}

/**
 * Generate an image and return raw PNG bytes.
 * Convex storage stores Blobs, so we return ArrayBuffer here and the caller wraps it.
 */
export async function generateImage(
	prompt: string,
	size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1024",
): Promise<ArrayBuffer> {
	const openai = getOpenAI();
	const result = await openai.images.generate({
		model: IMAGE_MODEL,
		prompt,
		size,
		n: 1,
	});
	const b64 = result.data?.[0]?.b64_json;
	if (!b64) {
		throw new Error("Image generation returned no b64_json payload");
	}
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes.buffer;
}
