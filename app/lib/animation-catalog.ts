import type { CatalogEntry, CatalogGameMode } from "./catalog-types";

export type AnimationTypeId =
  | "walk"
  | "jump"
  | "attack"
  | "idle"
  | "walk-down"
  | "walk-up"
  | "walk-side"
  | "attack-down"
  | "attack-up"
  | "attack-side"
  | "idle-iso";

export type AnimationCategory = "Movement" | "Combat" | "State";

export interface AnimationTypeDefinition {
  id: AnimationTypeId;
  mode: CatalogGameMode;
  label: string;
  category: AnimationCategory;
  description: string;
  aspectRatio: string;
  frames: number;
}

export interface CharacterAnimationAsset {
  definition: AnimationTypeDefinition;
  url: string;
  transparent: boolean;
}

export const ANIMATION_TYPES: readonly AnimationTypeDefinition[] = [
  {
    id: "walk",
    mode: "side-scroller",
    label: "Walk",
    category: "Movement",
    description: "Looping right-facing platformer walk cycle.",
    aspectRatio: "1:1",
    frames: 4,
  },
  {
    id: "jump",
    mode: "side-scroller",
    label: "Jump",
    category: "Movement",
    description: "Anticipation, rise, apex, and landing sequence.",
    aspectRatio: "1:1",
    frames: 4,
  },
  {
    id: "attack",
    mode: "side-scroller",
    label: "Attack",
    category: "Combat",
    description: "Character-specific attack with wind-up, impact, and recovery.",
    aspectRatio: "21:9",
    frames: 4,
  },
  {
    id: "idle",
    mode: "side-scroller",
    label: "Idle",
    category: "State",
    description: "Subtle looping breathing and resting motion.",
    aspectRatio: "1:1",
    frames: 4,
  },
  {
    id: "walk-down",
    mode: "isometric",
    label: "Walk Down",
    category: "Movement",
    description: "Front-facing movement toward the camera.",
    aspectRatio: "1:1",
    frames: 4,
  },
  {
    id: "walk-up",
    mode: "isometric",
    label: "Walk Up",
    category: "Movement",
    description: "Back-facing movement away from the camera.",
    aspectRatio: "1:1",
    frames: 4,
  },
  {
    id: "walk-side",
    mode: "isometric",
    label: "Walk Side",
    category: "Movement",
    description: "Right-facing movement; the left direction is mirrored at runtime.",
    aspectRatio: "1:1",
    frames: 4,
  },
  {
    id: "attack-down",
    mode: "isometric",
    label: "Attack Down",
    category: "Combat",
    description: "Front-facing attack toward the camera.",
    aspectRatio: "9:16",
    frames: 4,
  },
  {
    id: "attack-up",
    mode: "isometric",
    label: "Attack Up",
    category: "Combat",
    description: "Back-facing variant of the character's attack.",
    aspectRatio: "9:16",
    frames: 4,
  },
  {
    id: "attack-side",
    mode: "isometric",
    label: "Attack Side",
    category: "Combat",
    description: "Side attack; the opposite direction is mirrored at runtime.",
    aspectRatio: "16:9",
    frames: 4,
  },
  {
    id: "idle-iso",
    mode: "isometric",
    label: "Idle Front",
    category: "State",
    description: "Subtle front-facing isometric idle loop.",
    aspectRatio: "1:1",
    frames: 4,
  },
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assetUrl(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function characterSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const nested = record(snapshot.character);
  return Object.keys(nested).length > 0 ? nested : snapshot;
}

function animationLocation(
  id: AnimationTypeId,
  mode: CatalogGameMode
): { group: "spriteSheets" | "isometric"; source: string; removedGroup: "backgroundRemoved" | "isometric"; removed: string } | null {
  if (mode === "side-scroller") {
    if (id !== "walk" && id !== "jump" && id !== "attack" && id !== "idle") return null;
    return { group: "spriteSheets", source: id, removedGroup: "backgroundRemoved", removed: id };
  }

  const isometricLocations: Partial<Record<AnimationTypeId, ReturnType<typeof animationLocation>>> = {
    "walk-down": { group: "spriteSheets", source: "walk", removedGroup: "backgroundRemoved", removed: "walk" },
    "walk-up": { group: "spriteSheets", source: "jump", removedGroup: "backgroundRemoved", removed: "jump" },
    "walk-side": { group: "spriteSheets", source: "attack", removedGroup: "backgroundRemoved", removed: "attack" },
    "attack-down": { group: "isometric", source: "attackDown", removedGroup: "isometric", removed: "attackDownBackgroundRemoved" },
    "attack-up": { group: "isometric", source: "attackUp", removedGroup: "isometric", removed: "attackUpBackgroundRemoved" },
    "attack-side": { group: "isometric", source: "attackSide", removedGroup: "isometric", removed: "attackSideBackgroundRemoved" },
    "idle-iso": { group: "isometric", source: "idle", removedGroup: "isometric", removed: "idleBackgroundRemoved" },
  };
  return isometricLocations[id] || null;
}

export function animationTypeDefinition(id: AnimationTypeId): AnimationTypeDefinition {
  return ANIMATION_TYPES.find((definition) => definition.id === id)!;
}

export function animationTypesForMode(mode: CatalogGameMode): AnimationTypeDefinition[] {
  return ANIMATION_TYPES.filter((definition) => definition.mode === mode);
}

export function characterAnimationAssets(entry: CatalogEntry): CharacterAnimationAsset[] {
  const snapshot = characterSnapshot(entry.snapshot);
  return animationTypesForMode(entry.mode).flatMap((definition) => {
    const location = animationLocation(definition.id, entry.mode);
    if (!location) return [];
    const sourceGroup = record(snapshot[location.group]);
    const removedGroup = record(snapshot[location.removedGroup]);
    const cleaned = assetUrl(removedGroup[location.removed]);
    const original = assetUrl(sourceGroup[location.source]);
    const url = cleaned || original;
    return url ? [{ definition, url, transparent: Boolean(cleaned) }] : [];
  });
}

export function countGeneratedAnimations(
  snapshot: Record<string, unknown>,
  mode: CatalogGameMode
): number {
  const entry = {
    snapshot,
    mode,
  } as CatalogEntry;
  return characterAnimationAssets(entry).length;
}

export function removeCharacterAnimation(
  snapshot: Record<string, unknown>,
  mode: CatalogGameMode,
  id: AnimationTypeId
): Record<string, unknown> {
  const location = animationLocation(id, mode);
  if (!location) return snapshot;

  const next = { ...snapshot };
  const sourceGroup = { ...record(next[location.group]) };
  const removedGroup = location.removedGroup === location.group
    ? sourceGroup
    : { ...record(next[location.removedGroup]) };
  sourceGroup[location.source] = null;
  removedGroup[location.removed] = null;

  // Isometric Walk Left is mirrored from the same Walk Side sheet.
  if (mode === "isometric" && id === "walk-side") {
    sourceGroup.idle = null;
    removedGroup.idle = null;
  }

  next[location.group] = sourceGroup;
  next[location.removedGroup] = removedGroup;
  return next;
}
