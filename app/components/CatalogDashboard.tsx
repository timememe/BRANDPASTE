"use client";

import { useMemo, useState } from "react";
import type {
  CatalogEntry,
  CatalogGameMode,
  CatalogKind,
  CatalogResponse,
} from "../lib/catalog-types";

type CatalogSection = "characters" | "animations" | "worlds";

interface AnimationAsset {
  id: string;
  label: string;
  url: string;
  transparent: boolean;
  character: CatalogEntry;
}

interface CatalogDashboardProps {
  catalog: CatalogResponse;
  isLoading: boolean;
  notice: string | null;
  isSaving: CatalogKind | null;
  loadedCatalogIds: { character?: string; world?: string };
  hasCurrentCharacter: boolean;
  hasCurrentWorld: boolean;
  onRefresh: () => void;
  onCreate: (kind: CatalogKind, mode: CatalogGameMode) => void;
  onOpenClassicCreator: (mode: CatalogGameMode) => void;
  onEdit: (entry: CatalogEntry, focus?: "animations" | "world") => void;
  onDelete: (entry: CatalogEntry) => void;
  onSaveCurrent: (kind: CatalogKind) => void;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function url(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function animationAssets(character: CatalogEntry): AnimationAsset[] {
  const snapshot = record(character.snapshot);
  const sheets = record(snapshot.spriteSheets);
  const removed = record(snapshot.backgroundRemoved);
  const iso = record(snapshot.isometric);
  const assets: AnimationAsset[] = [];
  const baseLabels = character.mode === "isometric"
    ? { walk: "Walk Down", jump: "Walk Up", attack: "Walk Right", idle: "Walk Left" }
    : { walk: "Walk", jump: "Jump", attack: "Attack", idle: "Idle" };

  for (const key of ["walk", "jump", "attack", "idle"] as const) {
    const cleaned = url(removed[key]);
    const original = url(sheets[key]);
    const assetUrl = cleaned || original;
    if (assetUrl) {
      assets.push({
        id: `${character.id}-${key}`,
        label: baseLabels[key],
        url: assetUrl,
        transparent: Boolean(cleaned),
        character,
      });
    }
  }

  const isoAnimations = [
    ["attackDown", "attackDownBackgroundRemoved", "Attack Down"],
    ["attackUp", "attackUpBackgroundRemoved", "Attack Up"],
    ["attackSide", "attackSideBackgroundRemoved", "Attack Side"],
    ["idle", "idleBackgroundRemoved", "Idle Front"],
  ] as const;
  for (const [sourceKey, cleanedKey, label] of isoAnimations) {
    const cleaned = url(iso[cleanedKey]);
    const original = url(iso[sourceKey]);
    const assetUrl = cleaned || original;
    if (assetUrl) {
      assets.push({
        id: `${character.id}-iso-${sourceKey}`,
        label,
        url: assetUrl,
        transparent: Boolean(cleaned),
        character,
      });
    }
  }
  return assets;
}

function worldAssets(entry: CatalogEntry): string[] {
  const snapshot = record(entry.snapshot);
  const layers = record(snapshot.customBackgroundLayers);
  return [
    url(snapshot.isometricMapUrl),
    url(layers.layer1Url),
    url(layers.layer2Url),
    url(layers.layer3Url),
  ].filter((item): item is string => Boolean(item));
}

function modeLabel(mode: CatalogGameMode): string {
  return mode === "isometric" ? "Isometric" : "Side-scroller";
}

export default function CatalogDashboard({
  catalog,
  isLoading,
  notice,
  isSaving,
  loadedCatalogIds,
  hasCurrentCharacter,
  hasCurrentWorld,
  onRefresh,
  onCreate,
  onOpenClassicCreator,
  onEdit,
  onDelete,
  onSaveCurrent,
}: CatalogDashboardProps) {
  const [section, setSection] = useState<CatalogSection>("characters");
  const [createMode, setCreateMode] = useState<CatalogGameMode>("side-scroller");
  const [modeFilter, setModeFilter] = useState<"all" | CatalogGameMode>("all");
  const [search, setSearch] = useState("");
  const [animationCharacterId, setAnimationCharacterId] = useState<string | null>(null);

  const animations = useMemo(
    () => catalog.characters.flatMap(animationAssets),
    [catalog.characters]
  );
  const normalizedSearch = search.trim().toLowerCase();
  const matchesMode = (entry: CatalogEntry) =>
    modeFilter === "all" || entry.mode === modeFilter;
  const matchesEntry = (entry: CatalogEntry) =>
    matchesMode(entry) &&
    (!normalizedSearch || entry.name.toLowerCase().includes(normalizedSearch));
  const visibleCharacters = catalog.characters.filter(matchesEntry);
  const visibleWorlds = catalog.worlds.filter(matchesEntry);
  const visibleAnimations = animations.filter(
    (asset) =>
      matchesMode(asset.character) &&
      (!animationCharacterId || asset.character.id === animationCharacterId) &&
      (!normalizedSearch ||
        asset.label.toLowerCase().includes(normalizedSearch) ||
        asset.character.name.toLowerCase().includes(normalizedSearch))
  );

  const openAnimations = (entry: CatalogEntry) => {
    setAnimationCharacterId(entry.id);
    setSection("animations");
  };

  const switchSection = (next: CatalogSection) => {
    setSection(next);
    if (next !== "animations") setAnimationCharacterId(null);
  };

  return (
    <section className="library-shell">
      <div className="library-hero">
        <div className="library-hero-copy">
          <span className="library-eyebrow">BRANDPASTE ASSET LIBRARY</span>
          <h2>Your characters, animations, and worlds</h2>
          <p>
            Build a reusable game universe. Every generated asset stays attached to its
            character or world and is tagged for its gameplay perspective.
          </p>
        </div>
        <div className="library-create-panel">
          <label htmlFor="library-create-mode">New asset mode</label>
          <select
            id="library-create-mode"
            value={createMode}
            onChange={(event) => setCreateMode(event.target.value as CatalogGameMode)}
          >
            <option value="side-scroller">Side-scroller</option>
            <option value="isometric">Isometric</option>
          </select>
          <div className="library-create-buttons">
            <button className="btn btn-primary" onClick={() => onCreate("character", createMode)}>
              + New Character
            </button>
            <button className="btn btn-success" onClick={() => onCreate("world", createMode)}>
              + New World
            </button>
          </div>
          <button className="library-classic-button" onClick={() => onOpenClassicCreator(createMode)}>
            Open classic step-by-step Creator <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      {(hasCurrentCharacter || hasCurrentWorld) && (
        <div className="library-draft-bar">
          <div>
            <strong>Unsaved or loaded work is available</strong>
            <span>Store the current Creator state in the project catalog.</span>
          </div>
          <div>
            {hasCurrentCharacter && (
              <button
                className="btn btn-primary"
                disabled={isSaving !== null}
                onClick={() => onSaveCurrent("character")}
              >
                {isSaving === "character" ? "Saving..." : loadedCatalogIds.character ? "Update Character" : "Save Character"}
              </button>
            )}
            {hasCurrentWorld && (
              <button
                className="btn btn-success"
                disabled={isSaving !== null}
                onClick={() => onSaveCurrent("world")}
              >
                {isSaving === "world" ? "Saving..." : loadedCatalogIds.world ? "Update World" : "Save World"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="library-stats">
        <div><strong>{catalog.characters.length}</strong><span>Characters</span></div>
        <div><strong>{animations.length}</strong><span>Animations</span></div>
        <div><strong>{catalog.worlds.length}</strong><span>Worlds</span></div>
        <div><strong>{catalog.characters.filter((entry) => entry.mode === "isometric").length + catalog.worlds.filter((entry) => entry.mode === "isometric").length}</strong><span>Isometric assets</span></div>
      </div>

      <div className="library-toolbar">
        <div className="library-tabs" role="tablist" aria-label="Asset type">
          {([
            ["characters", "Characters", catalog.characters.length],
            ["animations", "Animations", animations.length],
            ["worlds", "Worlds", catalog.worlds.length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              role="tab"
              aria-selected={section === value}
              className={section === value ? "active" : ""}
              onClick={() => switchSection(value)}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </div>
        <div className="library-filters">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search assets..."
            aria-label="Search catalog"
          />
          <select
            value={modeFilter}
            onChange={(event) => setModeFilter(event.target.value as typeof modeFilter)}
            aria-label="Filter by game mode"
          >
            <option value="all">All modes</option>
            <option value="side-scroller">Side-scroller</option>
            <option value="isometric">Isometric</option>
          </select>
          <button className="library-refresh" onClick={onRefresh} aria-label="Refresh catalog">↻</button>
        </div>
      </div>

      {notice && <div className="catalog-notice library-notice">{notice}</div>}

      {isLoading ? (
        <div className="library-empty"><div className="library-loader" /><strong>Loading catalog...</strong></div>
      ) : section === "characters" ? (
        visibleCharacters.length > 0 ? (
          <div className="library-grid">
            {visibleCharacters.map((entry) => {
              const entryAnimations = animationAssets(entry);
              return (
                <article className="library-card" key={entry.id}>
                  <div className="library-card-media character-media">
                    {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <span className="library-placeholder">◇</span>}
                    <span className={`library-mode-badge ${entry.mode}`}>{modeLabel(entry.mode)}</span>
                    {loadedCatalogIds.character === entry.id && <span className="library-current-badge">Current</span>}
                  </div>
                  {entryAnimations.length > 0 && (
                    <button className="library-sprite-strip" onClick={() => openAnimations(entry)}>
                      {entryAnimations.slice(0, 4).map((asset) => <img key={asset.id} src={asset.url} alt="" />)}
                      <span>{entryAnimations.length} animation{entryAnimations.length === 1 ? "" : "s"}</span>
                    </button>
                  )}
                  <div className="library-card-body">
                    <div className="library-card-title-row">
                      <div><strong>{entry.name}</strong><span>Updated {new Date(entry.updatedAt).toLocaleDateString()}</span></div>
                    </div>
                    <div className="library-card-actions">
                      <button className="btn btn-primary" onClick={() => onEdit(entry)}>Edit Character</button>
                      <button className="btn btn-secondary" onClick={() => onEdit(entry, "animations")}>Edit Animations</button>
                      <button className="library-icon-delete" onClick={() => onDelete(entry)} aria-label={`Delete ${entry.name}`}>×</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <LibraryEmpty title="No characters found" text="Create a character or change the current filters." onCreate={() => onCreate("character", createMode)} />
      ) : section === "animations" ? (
        visibleAnimations.length > 0 ? (
          <>
            {animationCharacterId && (
              <button className="library-clear-filter" onClick={() => setAnimationCharacterId(null)}>× Show animations from all characters</button>
            )}
            <div className="library-grid animation-grid">
              {visibleAnimations.map((asset) => (
                <article className="library-card animation-card" key={asset.id}>
                  <div className="library-card-media animation-media">
                    <img src={asset.url} alt="" />
                    <span className={`library-mode-badge ${asset.character.mode}`}>{modeLabel(asset.character.mode)}</span>
                    {asset.transparent && <span className="library-transparent-badge">Transparent</span>}
                  </div>
                  <div className="library-card-body">
                    <strong>{asset.label}</strong>
                    <span className="library-parent-name">{asset.character.name}</span>
                    <div className="library-card-actions">
                      <button className="btn btn-primary" onClick={() => onEdit(asset.character, "animations")}>Edit Animation</button>
                      <a className="btn btn-secondary" href={asset.url} target="_blank" rel="noreferrer">Open PNG</a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : <LibraryEmpty title="No animations found" text="Generate sprite sheets for a saved character first." onCreate={() => onOpenClassicCreator(createMode)} />
      ) : visibleWorlds.length > 0 ? (
        <div className="library-grid world-grid">
          {visibleWorlds.map((entry) => {
            const assets = worldAssets(entry);
            return (
              <article className="library-card world-card" key={entry.id}>
                <div className="library-card-media world-media">
                  {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <span className="library-placeholder">◇</span>}
                  <span className={`library-mode-badge ${entry.mode}`}>{modeLabel(entry.mode)}</span>
                  {loadedCatalogIds.world === entry.id && <span className="library-current-badge">Current</span>}
                </div>
                {assets.length > 1 && <div className="library-world-strip">{assets.slice(0, 4).map((asset) => <img key={asset} src={asset} alt="" />)}</div>}
                <div className="library-card-body">
                  <strong>{entry.name}</strong>
                  <span className="library-parent-name">{assets.length} background asset{assets.length === 1 ? "" : "s"}</span>
                  <div className="library-card-actions">
                    <button className="btn btn-primary" onClick={() => onEdit(entry, "world")}>Edit World</button>
                    <button className="library-icon-delete" onClick={() => onDelete(entry)} aria-label={`Delete ${entry.name}`}>×</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : <LibraryEmpty title="No worlds found" text="Create a side-scroller background or an isometric map." onCreate={() => onCreate("world", createMode)} />}
    </section>
  );
}

function LibraryEmpty({ title, text, onCreate }: { title: string; text: string; onCreate: () => void }) {
  return (
    <div className="library-empty">
      <span className="library-empty-mark">◇</span>
      <strong>{title}</strong>
      <span>{text}</span>
      <button className="btn btn-primary" onClick={onCreate}>Create asset</button>
    </div>
  );
}
