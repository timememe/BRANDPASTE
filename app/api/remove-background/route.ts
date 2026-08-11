import { NextRequest, NextResponse } from "next/server";
import {
  codexErrorDetails,
  removeBackgroundWithCodex,
} from "../../lib/codex-agent";

export const runtime = "nodejs";
export const maxDuration = 700;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined;

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Image URL is required" },
        { status: 400 }
      );
    }

    const image = await removeBackgroundWithCodex(imageUrl);
    return NextResponse.json({
      imageUrl: image.url,
      width: image.width,
      height: image.height,
    });
  } catch (error) {
    console.error("Error removing background with Codex Agent:", error);
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
