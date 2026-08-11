export type CatalogKind = "character" | "world";

export interface CatalogEntry {
  schemaVersion: 1;
  id: string;
  kind: CatalogKind;
  name: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  snapshot: Record<string, unknown>;
}

export interface CatalogResponse {
  characters: CatalogEntry[];
  worlds: CatalogEntry[];
}
