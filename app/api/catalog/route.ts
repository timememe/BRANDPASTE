import { NextRequest, NextResponse } from "next/server";
import {
  deleteCatalogEntry,
  listCatalog,
  saveCatalogEntry,
} from "@/app/lib/catalog-storage";
import type { CatalogKind } from "@/app/lib/catalog-types";

export const runtime = "nodejs";

function isKind(value: unknown): value is CatalogKind {
  return value === "character" || value === "world";
}

export async function GET() {
  try {
    return NextResponse.json(await listCatalog());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load catalog" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !isKind(body.kind) ||
      typeof body.name !== "string" ||
      (body.id !== undefined && typeof body.id !== "string") ||
      (body.thumbnailUrl !== null && typeof body.thumbnailUrl !== "string") ||
      !body.snapshot ||
      typeof body.snapshot !== "object" ||
      Array.isArray(body.snapshot)
    ) {
      return NextResponse.json({ error: "Invalid catalog entry" }, { status: 400 });
    }

    const entry = await saveCatalogEntry({
      id: body.id as string | undefined,
      kind: body.kind,
      name: body.name,
      thumbnailUrl: body.thumbnailUrl as string | null,
      snapshot: body.snapshot as Record<string, unknown>,
    });
    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save catalog entry" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const kind = request.nextUrl.searchParams.get("kind");
    const id = request.nextUrl.searchParams.get("id") || "";
    if (!isKind(kind)) {
      return NextResponse.json({ error: "Invalid catalog kind" }, { status: 400 });
    }
    await deleteCatalogEntry(kind, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete catalog entry" },
      { status: 400 }
    );
  }
}
