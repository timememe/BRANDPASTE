import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { randomUUID } from "node:crypto";
import type { CatalogEntry, CatalogKind, CatalogResponse } from "./catalog-types";

const DEFAULT_OWNER = "timememe";
const DEFAULT_REPO = "BRANDPASTE";
const DEFAULT_BRANCH = "catalog-data";
const DEFAULT_PREFIX = "brandpaste-storage";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_CATALOG_JSON_BYTES = 512 * 1024;
const MAX_LISTED_ENTRIES = 1_000;

interface GitHubStorageConfig {
  owner: string;
  repo: string;
  branch: string;
  prefix: string;
  token: string;
}

interface GitHubContentItem {
  type: "file" | "dir";
  name: string;
  path: string;
  sha: string;
  size: number;
}

export interface StoredAsset {
  data: Uint8Array;
  contentType: string;
  etag: string | null;
}

function runtimeEnv(name: string): string | undefined {
  try {
    const value = (getCloudflareContext().env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string") return value;
  } catch {
    // Plain Next.js builds do not have a Cloudflare context.
  }
  const value = process.env[name];
  return typeof value === "string" ? value : undefined;
}

function publicConfig(): Omit<GitHubStorageConfig, "token"> {
  const prefix = (runtimeEnv("GITHUB_STORAGE_PREFIX") || DEFAULT_PREFIX)
    .replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9._/-]+$/.test(prefix) || prefix.includes("..")) {
    throw new Error("GITHUB_STORAGE_PREFIX is invalid");
  }
  return {
    owner: runtimeEnv("GITHUB_STORAGE_OWNER") || DEFAULT_OWNER,
    repo: runtimeEnv("GITHUB_STORAGE_REPO") || DEFAULT_REPO,
    branch: runtimeEnv("GITHUB_STORAGE_BRANCH") || DEFAULT_BRANCH,
    prefix,
  };
}

function config(): GitHubStorageConfig {
  const token = runtimeEnv("GITHUB_STORAGE_TOKEN")?.trim();
  if (!token) throw new Error("GITHUB_STORAGE_TOKEN is not configured on the server");
  return { ...publicConfig(), token };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function storagePath(path: string): string {
  return `${publicConfig().prefix}/${path}`;
}

function contentApiPath(path: string): string {
  const current = publicConfig();
  return `/repos/${encodeURIComponent(current.owner)}/${encodeURIComponent(
    current.repo
  )}/contents/${encodePath(storagePath(path))}`;
}

async function githubRequest(
  path: string,
  init: RequestInit = {},
  allowNotFound = false
): Promise<Response | null> {
  const current = config();
  const isMutation = init.method && init.method !== "GET" && init.method !== "HEAD";
  let response: Response | undefined;

  for (let attempt = 0; attempt < (isMutation ? 5 : 1); attempt += 1) {
    response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${current.token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "BRANDPASTE-Catalog",
        ...(init.headers || {}),
      },
      cache: "no-store",
    });

    // Parallel sprite jobs may try to advance the data branch together.
    // GitHub serializes content commits, so retry conflicts with jitter.
    if (response.status === 409 && attempt < 4) {
      await new Promise((resolve) =>
        setTimeout(resolve, 200 * 2 ** attempt + Math.floor(Math.random() * 250))
      );
      continue;
    }
    break;
  }

  if (!response) throw new Error("GitHub storage request did not run");

  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    let message = `GitHub storage returned HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Preserve the status-based fallback.
    }
    throw new Error(message);
  }
  return response;
}

async function contentMetadata(path: string): Promise<GitHubContentItem | null> {
  const current = publicConfig();
  const response = await githubRequest(
    `${contentApiPath(path)}?ref=${encodeURIComponent(current.branch)}`,
    {},
    true
  );
  if (!response) return null;
  const item = (await response.json()) as GitHubContentItem;
  return item.type === "file" ? item : null;
}

async function readFile(path: string): Promise<Uint8Array | null> {
  const current = publicConfig();
  const response = await githubRequest(
    `${contentApiPath(path)}?ref=${encodeURIComponent(current.branch)}`,
    { headers: { Accept: "application/vnd.github.raw+json" } },
    true
  );
  return response ? new Uint8Array(await response.arrayBuffer()) : null;
}

async function writeFile(
  path: string,
  bytes: Uint8Array,
  message: string,
  knownSha?: string
): Promise<void> {
  const current = publicConfig();
  const sha = knownSha ?? (await contentMetadata(path))?.sha;
  await githubRequest(contentApiPath(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(bytes).toString("base64"),
      branch: current.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

async function deleteFile(path: string, message: string): Promise<void> {
  const current = publicConfig();
  const item = await contentMetadata(path);
  if (!item) return;
  await githubRequest(contentApiPath(path), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha: item.sha, branch: current.branch }),
  });
}

function catalogDirectory(kind: CatalogKind): string {
  return `catalog/${kind}s`;
}

function catalogPath(kind: CatalogKind, id: string): string {
  return `${catalogDirectory(kind)}/${id}.json`;
}

function isCatalogKind(value: unknown): value is CatalogKind {
  return value === "character" || value === "world";
}

function isSafeId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

export function isSafeAssetKey(value: string): boolean {
  return (
    value.length <= 256 &&
    !value.includes("..") &&
    /^assets\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.png$/i.test(value)
  );
}

export function assetKeyFromUrl(value: string): string | null {
  try {
    const url = new URL(value, "http://brandpaste.local");
    if (url.pathname === "/api/catalog/asset") {
      const key = url.searchParams.get("key");
      return key && isSafeAssetKey(key) ? key : null;
    }

    const current = publicConfig();
    if (url.hostname !== "raw.githubusercontent.com") return null;
    const expectedPrefix = `/${current.owner}/${current.repo}/${current.branch}/${current.prefix}/`;
    if (!url.pathname.startsWith(expectedPrefix)) return null;
    const key = decodeURIComponent(url.pathname.slice(expectedPrefix.length));
    return isSafeAssetKey(key) ? key : null;
  } catch {
    return null;
  }
}

function publicAssetUrl(key: string): string {
  const current = publicConfig();
  return `https://raw.githubusercontent.com/${encodeURIComponent(
    current.owner
  )}/${encodeURIComponent(current.repo)}/${encodePath(current.branch)}/${encodePath(
    current.prefix
  )}/${encodePath(key)}`;
}

export async function storeGeneratedAsset(
  data: Uint8Array,
  dimensions: { width: number; height: number }
): Promise<{ key: string; url: string }> {
  if (data.byteLength === 0) throw new Error("Cannot store an empty generated asset");
  const now = new Date();
  const key = `assets/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}/${randomUUID()}.png`;
  await writeFile(
    key,
    data,
    `[catalog] Store generated ${dimensions.width}x${dimensions.height} asset`
  );
  return { key, url: publicAssetUrl(key) };
}

export async function readStoredAsset(key: string): Promise<StoredAsset | null> {
  if (!isSafeAssetKey(key)) return null;
  const data = await readFile(key);
  return data ? { data, contentType: "image/png", etag: null } : null;
}

function parseCatalogBytes(bytes: Uint8Array): CatalogEntry | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CatalogEntry>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.id !== "string" ||
      !isSafeId(value.id) ||
      !isCatalogKind(value.kind) ||
      typeof value.name !== "string" ||
      typeof value.createdAt !== "string" ||
      typeof value.updatedAt !== "string" ||
      (value.thumbnailUrl !== null && typeof value.thumbnailUrl !== "string") ||
      !value.snapshot ||
      typeof value.snapshot !== "object" ||
      Array.isArray(value.snapshot)
    ) {
      return null;
    }
    return value as CatalogEntry;
  } catch {
    return null;
  }
}

async function readCatalogEntry(kind: CatalogKind, id: string): Promise<CatalogEntry | null> {
  const bytes = await readFile(catalogPath(kind, id));
  return bytes ? parseCatalogBytes(bytes) : null;
}

async function listKind(kind: CatalogKind): Promise<CatalogEntry[]> {
  const current = publicConfig();
  const response = await githubRequest(
    `${contentApiPath(catalogDirectory(kind))}?ref=${encodeURIComponent(current.branch)}`,
    {},
    true
  );
  if (!response) return [];
  const items = (await response.json()) as GitHubContentItem[];
  const files = Array.isArray(items)
    ? items.filter((item) => item.type === "file" && /^[0-9a-f-]{36}\.json$/i.test(item.name)).slice(0, MAX_LISTED_ENTRIES)
    : [];
  const entries = await Promise.all(
    files.map(async (item) => {
      const bytes = await readFile(item.path.slice(`${publicConfig().prefix}/`.length));
      return bytes ? parseCatalogBytes(bytes) : null;
    })
  );
  return entries
    .filter((entry): entry is CatalogEntry => entry !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listCatalog(): Promise<CatalogResponse> {
  const [characters, worlds] = await Promise.all([
    listKind("character"),
    listKind("world"),
  ]);
  return { characters, worlds };
}

export async function saveCatalogEntry(input: {
  id?: string;
  kind: CatalogKind;
  name: string;
  thumbnailUrl: string | null;
  snapshot: Record<string, unknown>;
}): Promise<CatalogEntry> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new Error("Catalog name is required");
  if (!isCatalogKind(input.kind)) throw new Error("Invalid catalog kind");
  if (input.thumbnailUrl && !assetKeyFromUrl(input.thumbnailUrl)) {
    throw new Error("Catalog thumbnails must be stored project assets");
  }

  const id = input.id && isSafeId(input.id) ? input.id : randomUUID();
  const existing = await readCatalogEntry(input.kind, id);
  const now = new Date().toISOString();
  const entry: CatalogEntry = {
    schemaVersion: 1,
    id,
    kind: input.kind,
    name,
    thumbnailUrl: input.thumbnailUrl,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    snapshot: input.snapshot,
  };
  const json = new TextEncoder().encode(JSON.stringify(entry, null, 2));
  if (json.byteLength > MAX_CATALOG_JSON_BYTES) {
    throw new Error("Catalog snapshot exceeds the 512 KB limit");
  }
  await writeFile(catalogPath(input.kind, id), json, `[catalog] Save ${input.kind} “${name}”`);
  return entry;
}

export async function deleteCatalogEntry(kind: CatalogKind, id: string): Promise<void> {
  if (!isCatalogKind(kind) || !isSafeId(id)) throw new Error("Invalid catalog entry");
  await deleteFile(catalogPath(kind, id), `[catalog] Delete ${kind} ${id}`);
}
