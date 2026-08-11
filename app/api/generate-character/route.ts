import { NextRequest, NextResponse } from "next/server";
import { codexErrorDetails } from "../../lib/codex-agent";
import { generateImage } from "../../lib/generate-image";

export const runtime = "nodejs";
export const maxDuration = 700;

const CHARACTER_STYLE_PROMPT = `Generate a single character only, centered in the frame on a plain white background.
The character should be rendered in detailed 32-bit pixel art style (like PlayStation 1 / SNES era games).
Include proper shading, highlights, and anti-aliased edges for a polished look.
The character should have well-defined features, expressive details, and rich colors.
Show in a front-facing or 3/4 view pose, standing idle, suitable for sprite sheet animation.`;

const IMAGE_TO_PIXEL_PROMPT = `Transform this character into detailed 32-bit pixel art style (like PlayStation 1 / SNES era games).
IMPORTANT: Must be a FULL BODY shot showing the entire character from head to feet.
Keep the character centered in the frame on a plain white background.
Include proper shading, highlights, and anti-aliased edges for a polished look.
The character should have well-defined features, expressive details, and rich colors.
Show in a front-facing or 3/4 view pose, standing idle, suitable for sprite sheet animation.
Maintain the character's key features, colors, and identity while converting to pixel art.`;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined;

    if (imageUrl) {
      const fullPrompt = prompt
        ? `${prompt}. ${IMAGE_TO_PIXEL_PROMPT}`
        : IMAGE_TO_PIXEL_PROMPT;
      const image = await generateImage({
        prompt: fullPrompt,
        imageUrls: [imageUrl],
        aspectRatio: "1:1",
      });

      return NextResponse.json({
        imageUrl: image.url,
        width: image.width,
        height: image.height,
      });
    }

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt or image URL is required" },
        { status: 400 }
      );
    }

    const image = await generateImage({
      prompt: `${prompt}. ${CHARACTER_STYLE_PROMPT}`,
      aspectRatio: "1:1",
    });

    return NextResponse.json({
      imageUrl: image.url,
      width: image.width,
      height: image.height,
    });
  } catch (error) {
    console.error("Error generating character with Codex Agent:", error);
    const details = codexErrorDetails(error);
    return NextResponse.json(
      {
        error: details.message,
        retryAfterSec: details.retryAfterSec,
        retryAt: details.retryAt,
      },
      {
        status: details.status,
        headers: details.retryAfterSec
          ? { "Retry-After": String(Math.ceil(details.retryAfterSec)) }
          : undefined,
      }
    );
  }
}
