import { GoogleGenAI } from "@google/genai";

// "Nano Banana" — Google's Gemini Flash Image model. 3.1 preview adds
// selectable resolution; we render at 1K to keep cost ~$0.067/image.
export const IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const IMAGE_SIZE = "1K";

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

function bufToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	// btoa is available in the Convex runtime.
	return btoa(bin);
}

type GenerateOpts = {
	size?: Size;
	// Optional reference image bytes. When provided, the image model treats it
	// as a visual anchor (used to lock POV/geometry for room re-decoration).
	referenceImage?: { bytes: ArrayBuffer; mimeType: string } | null;
};

/**
 * Generate an image and return raw PNG bytes.
 * Convex storage stores Blobs, so we return ArrayBuffer here and the caller wraps it.
 */
export async function generateImage(
	prompt: string,
	opts: GenerateOpts = {},
): Promise<ArrayBuffer> {
	const ai = getGenAI();
	const size = opts.size ?? "1024x1024";

	// Multimodal contents: when we have a reference image, send it alongside
	// the prompt so the model conditions on the visual layout, not just the
	// text. Otherwise fall back to text-only.
	const parts: Array<
		| { text: string }
		| { inlineData: { mimeType: string; data: string } }
	> = [];
	if (opts.referenceImage) {
		parts.push({
			inlineData: {
				mimeType: opts.referenceImage.mimeType,
				data: bufToBase64(opts.referenceImage.bytes),
			},
		});
	}
	parts.push({ text: prompt });

	const response = await ai.models.generateContent({
		model: IMAGE_MODEL,
		contents: [{ role: "user", parts }],
		config: {
			responseModalities: ["TEXT", "IMAGE"],
			imageConfig: {
				aspectRatio: ASPECT_RATIO[size],
				imageSize: IMAGE_SIZE,
			},
		},
	});

	const out = response.candidates?.[0]?.content?.parts ?? [];
	for (const part of out) {
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
