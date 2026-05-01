import { GoogleGenAI } from "@google/genai";

// "Nano Banana" — Google's Gemini 2.5 Flash Image model.
export const IMAGE_MODEL = "gemini-2.5-flash-image";

export function getGenAI(): GoogleGenAI {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error(
			"GEMINI_API_KEY is not set. Set it via `npx convex env set GEMINI_API_KEY <key>`.",
		);
	}
	return new GoogleGenAI({ apiKey });
}

type Size = "1024x1024" | "1024x1536" | "1536x1024";

const ASPECT_RATIO: Record<Size, string> = {
	"1024x1024": "1:1",
	"1024x1536": "2:3",
	"1536x1024": "3:2",
};

/**
 * Generate an image and return raw PNG bytes.
 * Convex storage stores Blobs, so we return ArrayBuffer here and the caller wraps it.
 */
export async function generateImage(
	prompt: string,
	size: Size = "1024x1024",
): Promise<ArrayBuffer> {
	const ai = getGenAI();
	const response = await ai.models.generateContent({
		model: IMAGE_MODEL,
		contents: prompt,
		config: {
			imageConfig: { aspectRatio: ASPECT_RATIO[size] },
		},
	});

	const parts = response.candidates?.[0]?.content?.parts ?? [];
	for (const part of parts) {
		const data = part.inlineData?.data;
		if (data) {
			const bin = atob(data);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return bytes.buffer;
		}
	}
	throw new Error("Image generation returned no inline image data");
}
