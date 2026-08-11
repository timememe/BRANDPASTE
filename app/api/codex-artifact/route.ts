import { NextRequest, NextResponse } from "next/server";
import {
  codexErrorDetails,
  isSafeOutputManifestName,
  readArtifactBuffer,
} from "../../lib/codex-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const manifestName = request.nextUrl.searchParams.get("manifest") || "";
  if (!isSafeOutputManifestName(manifestName)) {
    return NextResponse.json(
      { error: "Invalid Codex artifact manifest" },
      { status: 400 }
    );
  }

  try {
    const { data } = await readArtifactBuffer(manifestName);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error proxying Codex artifact:", error);
    const details = codexErrorDetails(error);
    return NextResponse.json(
      { error: details.message },
      { status: details.status }
    );
  }
}
