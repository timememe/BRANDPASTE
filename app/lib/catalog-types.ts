export type CatalogKind = "character" | "world";
export type CatalogGameMode = "side-scroller" | "isometric";

export interface CatalogEntry {
  schemaVersion: 1;
  id: string;
  kind: CatalogKind;
  mode: CatalogGameMode;
  name: string;
  thumbnailUrl: string | null;
  animationCount: number;
  createdAt: string;
  updatedAt: string;
  snapshot: Record<string, unknown>;
}

export interface CatalogResponse {
  characters: CatalogEntry[];
  worlds: CatalogEntry[];
}
