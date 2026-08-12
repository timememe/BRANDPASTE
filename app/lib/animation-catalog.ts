import type { CatalogEntry, CatalogGameMode } from "./catalog-types";

export type AnimationTypeId =
  | "walk"
  | "jump"
  | "attack"
  | "idle"
  | "hurt"
  | "knockdown"
  | "walk-down"
  | "walk-up"
  | "walk-side"
  | "attack-down"
  | "attack-up"
  | "attack-side"
  | "idle-iso"
  | "shoot-down"
  | "shoot-up"
  | "shoot-side"
  | "reload-iso";

export type AnimationPackId =
  | "side-core"
  | "side-combat"
  | "side-damage"
  | "iso-core"
  | "iso-melee"
  | "iso-firearms";

export type AnimationCategory = "Movement" | "Combat" | "State" | "Reaction" | "Firearms";

export interface AnimationTypeDefinition {
  id: AnimationTypeId;
  packId: AnimationPackId;
  mode: CatalogGameMode;
  label: string;
  category: AnimationCategory;
  description: string;
  aspectRatio: string;
  frames: number;
  tags: string[];
  storage: "legacy" | "library";
}

export interface AnimationPackDefinition {
  id: AnimationPackId;
  mode: CatalogGameMode;
  label: string;
  description: string;
  tags: string[];
  requiredTags: string[];
  accent: "purple" | "cyan" | "red" | "amber";
  animationIds: AnimationTypeId[];
}

export interface CharacterAnimationAsset {
  definition: AnimationTypeDefinition;
  url: string;
  transparent: boolean;
}

export interface StoredAnimationAsset {
  sourceUrl: string | null;
  cleanedUrl: string | null;
}

export const ANIMATION_PACKS: readonly AnimationPackDefinition[] = [
  {
    id: "side-core",
    mode: "side-scroller",
    label: "Side-scroller Essentials",
    description: "The foundational movement and state loops for a platform or action side-scroller.",
    tags: ["side-scroller", "core", "movement"],
    requiredTags: ["side-scroller"],
    accent: "purple",
    animationIds: ["walk", "jump", "idle"],
  },
  {
    id: "side-combat",
    mode: "side-scroller",
    label: "Side-scroller Combat",
    description: "A flexible character-specific offensive action for side-view gameplay.",
    tags: ["side-scroller", "combat", "action"],
    requiredTags: ["side-scroller"],
    accent: "amber",
    animationIds: ["attack"],
  },
  {
    id: "side-damage",
    mode: "side-scroller",
    label: "Damage & Reactions",
    description: "Readable hit feedback and knockdown states for combat, hazards, and enemy contact.",
    tags: ["side-scroller", "damage", "reaction", "combat"],
    requiredTags: ["side-scroller"],
    accent: "red",
    animationIds: ["hurt", "knockdown"],
  },
  {
    id: "iso-core",
    mode: "isometric",
    label: "Isometric Locomotion",
    description: "Directional movement and idle animation for top-down and isometric exploration.",
    tags: ["isometric", "core", "movement", "directional"],
    requiredTags: ["isometric"],
    accent: "cyan",
    animationIds: ["walk-down", "walk-up", "walk-side", "idle-iso"],
  },
  {
    id: "iso-melee",
    mode: "isometric",
    label: "Isometric Melee",
    description: "Three directional close-combat animations sharing one attack language.",
    tags: ["isometric", "melee", "combat", "directional"],
    requiredTags: ["isometric"],
    accent: "purple",
    animationIds: ["attack-down", "attack-up", "attack-side"],
  },
  {
    id: "iso-firearms",
    mode: "isometric",
    label: "Isometric Firearms",
    description: "Directional firearm handling plus a reusable reload cycle for ranged characters.",
    tags: ["isometric", "firearms", "ranged", "combat", "directional"],
    requiredTags: ["isometric"],
    accent: "amber",
    animationIds: ["shoot-down", "shoot-up", "shoot-side", "reload-iso"],
  },
] as const;

export const ANIMATION_TYPES: readonly AnimationTypeDefinition[] = [
  {
    id: "walk", packId: "side-core", mode: "side-scroller", label: "Walk", category: "Movement",
    description: "Looping right-facing platformer walk cycle.", aspectRatio: "1:1", frames: 4,
    tags: ["movement", "loop", "ground"], storage: "legacy",
  },
  {
    id: "jump", packId: "side-core", mode: "side-scroller", label: "Jump", category: "Movement",
    description: "Anticipation, rise, apex, and landing sequence.", aspectRatio: "1:1", frames: 4,
    tags: ["movement", "air", "platformer"], storage: "legacy",
  },
  {
    id: "idle", packId: "side-core", mode: "side-scroller", label: "Idle", category: "State",
    description: "Subtle looping breathing and resting motion.", aspectRatio: "1:1", frames: 4,
    tags: ["state", "loop"], storage: "legacy",
  },
  {
    id: "attack", packId: "side-combat", mode: "side-scroller", label: "Attack", category: "Combat",
    description: "Character-specific attack with wind-up, impact, and recovery.", aspectRatio: "21:9", frames: 4,
    tags: ["combat", "action", "impact"], storage: "legacy",
  },
  {
    id: "hurt", packId: "side-damage", mode: "side-scroller", label: "Take Damage", category: "Reaction",
    description: "A sharp hit reaction that preserves the character silhouette and facing direction.", aspectRatio: "1:1", frames: 4,
    tags: ["damage", "reaction", "hit-stun"], storage: "library",
  },
  {
    id: "knockdown", packId: "side-damage", mode: "side-scroller", label: "Knockdown", category: "Reaction",
    description: "Heavy impact, fall, grounded pose, and the beginning of recovery.", aspectRatio: "16:9", frames: 4,
    tags: ["damage", "reaction", "fall"], storage: "library",
  },
  {
    id: "walk-down", packId: "iso-core", mode: "isometric", label: "Walk Down", category: "Movement",
    description: "Front-facing movement toward the camera.", aspectRatio: "1:1", frames: 4,
    tags: ["movement", "directional", "south"], storage: "legacy",
  },
  {
    id: "walk-up", packId: "iso-core", mode: "isometric", label: "Walk Up", category: "Movement",
    description: "Back-facing movement away from the camera.", aspectRatio: "1:1", frames: 4,
    tags: ["movement", "directional", "north"], storage: "legacy",
  },
  {
    id: "walk-side", packId: "iso-core", mode: "isometric", label: "Walk Side", category: "Movement",
    description: "Right-facing movement; the left direction is mirrored at runtime.", aspectRatio: "1:1", frames: 4,
    tags: ["movement", "directional", "side"], storage: "legacy",
  },
  {
    id: "idle-iso", packId: "iso-core", mode: "isometric", label: "Idle Front", category: "State",
    description: "Subtle front-facing isometric idle loop.", aspectRatio: "1:1", frames: 4,
    tags: ["state", "loop", "south"], storage: "legacy",
  },
  {
    id: "attack-down", packId: "iso-melee", mode: "isometric", label: "Attack Down", category: "Combat",
    description: "Front-facing attack toward the camera.", aspectRatio: "9:16", frames: 4,
    tags: ["melee", "directional", "south"], storage: "legacy",
  },
  {
    id: "attack-up", packId: "iso-melee", mode: "isometric", label: "Attack Up", category: "Combat",
    description: "Back-facing variant of the character's attack.", aspectRatio: "9:16", frames: 4,
    tags: ["melee", "directional", "north"], storage: "legacy",
  },
  {
    id: "attack-side", packId: "iso-melee", mode: "isometric", label: "Attack Side", category: "Combat",
    description: "Side attack; the opposite direction is mirrored at runtime.", aspectRatio: "16:9", frames: 4,
    tags: ["melee", "directional", "side"], storage: "legacy",
  },
  {
    id: "shoot-down", packId: "iso-firearms", mode: "isometric", label: "Shoot Down", category: "Firearms",
    description: "Aim and fire toward the camera with readable recoil and muzzle flash.", aspectRatio: "1:1", frames: 4,
    tags: ["firearms", "ranged", "directional", "south"], storage: "library",
  },
  {
    id: "shoot-up", packId: "iso-firearms", mode: "isometric", label: "Shoot Up", category: "Firearms",
    description: "Back-facing firearm shot using the same weapon and recoil language.", aspectRatio: "1:1", frames: 4,
    tags: ["firearms", "ranged", "directional", "north"], storage: "library",
  },
  {
    id: "shoot-side", packId: "iso-firearms", mode: "isometric", label: "Shoot Side", category: "Firearms",
    description: "Right-facing firearm shot; the left direction can be mirrored at runtime.", aspectRatio: "16:9", frames: 4,
    tags: ["firearms", "ranged", "directional", "side"], storage: "library",
  },
  {
    id: "reload-iso", packId: "iso-firearms", mode: "isometric", label: "Reload", category: "Firearms",
    description: "A front-facing reload cycle matched to the character's generated weapon.", aspectRatio: "1:1", frames: 4,
    tags: ["firearms", "ranged", "state"], storage: "library",
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

function storedLibraryAsset(snapshot: Record<string, unknown>, id: AnimationTypeId): StoredAnimationAsset {
  const value = record(record(snapshot.animationLibrary)[id]);
  return {
    sourceUrl: assetUrl(value.sourceUrl),
    cleanedUrl: assetUrl(value.cleanedUrl),
  };
}

export function animationTypeDefinition(id: AnimationTypeId): AnimationTypeDefinition {
  return ANIMATION_TYPES.find((definition) => definition.id === id)!;
}

export function animationPackDefinition(id: AnimationPackId): AnimationPackDefinition {
  return ANIMATION_PACKS.find((pack) => pack.id === id)!;
}

export function animationTypesForMode(mode: CatalogGameMode): AnimationTypeDefinition[] {
  return ANIMATION_TYPES.filter((definition) => definition.mode === mode);
}

export function animationPacksForMode(mode: CatalogGameMode): AnimationPackDefinition[] {
  return ANIMATION_PACKS.filter((pack) => pack.mode === mode);
}

export function animationTypesForPack(packId: AnimationPackId): AnimationTypeDefinition[] {
  return ANIMATION_TYPES.filter((definition) => definition.packId === packId);
}

export function characterTags(entry: CatalogEntry): string[] {
  const snapshot = characterSnapshot(entry.snapshot);
  const saved = Array.isArray(snapshot.tags)
    ? snapshot.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return Array.from(new Set([entry.mode, ...saved]));
}

export function isPackCompatible(entry: CatalogEntry, pack: AnimationPackDefinition): boolean {
  const tags = new Set(characterTags(entry));
  return pack.mode === entry.mode && pack.requiredTags.every((tag) => tags.has(tag));
}

export function characterAnimationAssets(entry: CatalogEntry): CharacterAnimationAsset[] {
  const snapshot = characterSnapshot(entry.snapshot);
  return animationTypesForMode(entry.mode).flatMap((definition) => {
    const location = animationLocation(definition.id, entry.mode);
    if (location) {
      const sourceGroup = record(snapshot[location.group]);
      const removedGroup = record(snapshot[location.removedGroup]);
      const cleaned = assetUrl(removedGroup[location.removed]);
      const original = assetUrl(sourceGroup[location.source]);
      const url = cleaned || original;
      return url ? [{ definition, url, transparent: Boolean(cleaned) }] : [];
    }

    const stored = storedLibraryAsset(snapshot, definition.id);
    const url = stored.cleanedUrl || stored.sourceUrl;
    return url ? [{ definition, url, transparent: Boolean(stored.cleanedUrl) }] : [];
  });
}

export function countGeneratedAnimations(snapshot: Record<string, unknown>, mode: CatalogGameMode): number {
  return characterAnimationAssets({ snapshot, mode } as CatalogEntry).length;
}

export function removeCharacterAnimation(
  snapshot: Record<string, unknown>,
  mode: CatalogGameMode,
  id: AnimationTypeId
): Record<string, unknown> {
  const location = animationLocation(id, mode);
  const next = { ...snapshot };

  if (!location) {
    const library = { ...record(next.animationLibrary) };
    library[id] = { sourceUrl: null, cleanedUrl: null };
    next.animationLibrary = library;
    return next;
  }

  const sourceGroup = { ...record(next[location.group]) };
  const removedGroup = location.removedGroup === location.group
    ? sourceGroup
    : { ...record(next[location.removedGroup]) };
  sourceGroup[location.source] = null;
  removedGroup[location.removed] = null;

  if (mode === "isometric" && id === "walk-side") {
    sourceGroup.idle = null;
    removedGroup.idle = null;
  }

  next[location.group] = sourceGroup;
  next[location.removedGroup] = removedGroup;
  return next;
}
