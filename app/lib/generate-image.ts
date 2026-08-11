import "server-only";

import { generateCodexImage } from "./codex-agent";

export type AspectRatio = "1:1" | "21:9" | "9:16" | "16:9";

interface GenerateImageInput {
  prompt: string;
  imageUrls?: string[];
  aspectRatio: AspectRatio;
}

interface GeneratedImage {
  url: string;
  width: number;
  height: number;
}

export async function generateImage({
  prompt,
  imageUrls,
  aspectRatio,
}: GenerateImageInput): Promise<GeneratedImage> {
  return generateCodexImage({ prompt, imageUrls, aspectRatio });
}
