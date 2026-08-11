import { NextRequest, NextResponse } from "next/server";
import { isSafeAssetKey, readStoredAsset } from "@/app/lib/catalog-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") || "";
  if (!isSafeAssetKey(key)) {
    return NextResponse.json({ error: "Invalid asset key" }, { status: 400 });
  }

  const object = await readStoredAsset(key);
  if (!object) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", object.contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (object.etag) headers.set("ETag", object.etag);
  const body = object.data.buffer instanceof ArrayBuffer
    ? object.data.buffer.slice(
        object.data.byteOffset,
        object.data.byteOffset + object.data.byteLength
      )
    : new Uint8Array(object.data).buffer;
  return new Response(body, { headers });
}
