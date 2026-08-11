"use client";

import { useMemo, useState } from "react";
import {
  ANIMATION_TYPES,
  animationTypesForMode,
  characterAnimationAssets,
  type AnimationTypeDefinition,
  type AnimationTypeId,
} from "../lib/animation-catalog";
import type {
  CatalogEntry,
  CatalogGameMode,
  CatalogKind,
  CatalogResponse,
} from "../lib/catalog-types";

type CatalogSection = "characters" | "animations" | "worlds";

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
  onEdit: (
    entry: CatalogEntry,
    focus?: "animations" | "world",
    animationType?: AnimationTypeId
  ) => void;
  onDelete: (entry: CatalogEntry) => void;
  onDeleteAnimation: (entry: CatalogEntry, animationType: AnimationTypeId) => void;
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

function typeMatchesSearch(definition: AnimationTypeDefinition, search: string): boolean {
  return !search || [definition.label, definition.category, definition.description]
    .some((value) => value.toLowerCase().includes(search));
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
  onDeleteAnimation,
  onSaveCurrent,
}: CatalogDashboardProps) {
  const [section, setSection] = useState<CatalogSection>("characters");
  const [createMode, setCreateMode] = useState<CatalogGameMode>("side-scroller");
  const [modeFilter, setModeFilter] = useState<"all" | CatalogGameMode>("all");
  const [search, setSearch] = useState("");
  const [animationTargetIds, setAnimationTargetIds] = useState<Partial<Record<CatalogGameMode, string>>>({});

  const characterAnimations = useMemo(
    () => catalog.characters.map((entry) => ({ entry, assets: characterAnimationAssets(entry) })),
    [catalog.characters]
  );
  const generatedAnimationCount = characterAnimations.reduce(
    (total, character) => total + character.assets.length,
    0
  );
  const normalizedSearch = search.trim().toLowerCase();
  const matchesMode = (entry: CatalogEntry) =>
    modeFilter === "all" || entry.mode === modeFilter;
  const matchesEntry = (entry: CatalogEntry) =>
    matchesMode(entry) &&
    (!normalizedSearch || entry.name.toLowerCase().includes(normalizedSearch));
  const visibleCharacters = catalog.characters.filter(matchesEntry);
  const visibleWorlds = catalog.worlds.filter(matchesEntry);
  const visibleAnimationTypes = ANIMATION_TYPES.filter(
    (definition) =>
      (modeFilter === "all" || definition.mode === modeFilter) &&
      typeMatchesSearch(definition, normalizedSearch)
  );

  const selectedTarget = (mode: CatalogGameMode): CatalogEntry | undefined => {
    const candidates = catalog.characters.filter((entry) => entry.mode === mode);
    return candidates.find((entry) => entry.id === animationTargetIds[mode]) || candidates[0];
  };

  const selectTarget = (mode: CatalogGameMode, id: string) => {
    setAnimationTargetIds((current) => ({ ...current, [mode]: id }));
  };

  return (
    <section className="library-shell">
      <div className="library-hero">
        <div className="library-hero-copy">
          <span className="library-eyebrow">BRANDPASTE ASSET LIBRARY</span>
          <h2>Your characters, animation types, and worlds</h2>
          <p>
            Generated sprite sheets live inside their character. The animation catalog
            describes the reusable motion types that BRANDPASTE can generate.
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
        <div><strong>{generatedAnimationCount}</strong><span>Character animations</span></div>
        <div><strong>{ANIMATION_TYPES.length}</strong><span>Animation types</span></div>
        <div><strong>{catalog.worlds.length}</strong><span>Worlds</span></div>
      </div>

      <div className="library-toolbar">
        <div className="library-tabs" role="tablist" aria-label="Asset type">
          {([
            ["characters", "Characters", catalog.characters.length],
            ["animations", "Animation Types", ANIMATION_TYPES.length],
            ["worlds", "Worlds", catalog.worlds.length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              role="tab"
              aria-selected={section === value}
              className={section === value ? "active" : ""}
              onClick={() => setSection(value)}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </div>
        <div className="library-filters">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={section === "animations" ? "Search animation types..." : "Search assets..."}
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
          <div className="library-grid character-library-grid">
            {visibleCharacters.map((entry) => {
              const entryAnimations = characterAnimationAssets(entry);
              const generatedIds = new Set(entryAnimations.map((asset) => asset.definition.id));
              const missingAnimations = animationTypesForMode(entry.mode).filter(
                (definition) => !generatedIds.has(definition.id)
              );
              return (
                <article className="library-card character-library-card" key={entry.id}>
                  <div className="library-card-media character-media">
                    {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <span className="library-placeholder">◇</span>}
                    <span className={`library-mode-badge ${entry.mode}`}>{modeLabel(entry.mode)}</span>
                    {loadedCatalogIds.character === entry.id && <span className="library-current-badge">Current</span>}
                  </div>
                  <div className="library-card-body">
                    <div className="library-card-title-row">
                      <div><strong>{entry.name}</strong><span>Updated {new Date(entry.updatedAt).toLocaleDateString()}</span></div>
                    </div>
                    <div className="library-card-actions">
                      <button className="btn btn-primary" onClick={() => onEdit(entry)}>Edit Character</button>
                      <button className="library-icon-delete" onClick={() => onDelete(entry)} aria-label={`Delete ${entry.name}`}>×</button>
                    </div>
                  </div>

                  <section className="character-animation-block" aria-label={`${entry.name} animations`}>
                    <div className="character-animation-heading">
                      <div>
                        <strong>Character animations</strong>
                        <span>{entryAnimations.length} of {animationTypesForMode(entry.mode).length} generated</span>
                      </div>
                      {missingAnimations[0] && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => onEdit(entry, "animations", missingAnimations[0].id)}
                        >
                          + Add animation
                        </button>
                      )}
                    </div>

                    {entryAnimations.length > 0 ? (
                      <div className="character-animation-grid">
                        {entryAnimations.map((asset) => (
                          <article className="character-animation-item" key={asset.definition.id}>
                            <button
                              className="character-animation-preview"
                              onClick={() => onEdit(entry, "animations", asset.definition.id)}
                              aria-label={`Edit ${asset.definition.label}`}
                            >
                              <img src={asset.url} alt="" />
                            </button>
                            <div>
                              <strong>{asset.definition.label}</strong>
                              <span>{asset.transparent ? "Transparent PNG" : "Original sheet"}</span>
                            </div>
                            <div className="character-animation-actions">
                              <button onClick={() => onEdit(entry, "animations", asset.definition.id)}>Edit</button>
                              <button
                                className="danger"
                                onClick={() => onDeleteAnimation(entry, asset.definition.id)}
                                aria-label={`Delete ${asset.definition.label} from ${entry.name}`}
                              >
                                Delete
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="character-animation-empty">
                        No sprite sheets yet. Add one of the supported animation types below.
                      </div>
                    )}

                    {missingAnimations.length > 0 && (
                      <div className="character-animation-missing">
                        <span>Available to add</span>
                        <div>
                          {missingAnimations.map((definition) => (
                            <button
                              key={definition.id}
                              onClick={() => onEdit(entry, "animations", definition.id)}
                            >
                              + {definition.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                </article>
              );
            })}
          </div>
        ) : <LibraryEmpty title="No characters found" text="Create a character or change the current filters." onCreate={() => onCreate("character", createMode)} />
      ) : section === "animations" ? (
        visibleAnimationTypes.length > 0 ? (
          <>
            <div className="animation-type-intro">
              <div>
                <strong>Generation capability catalog</strong>
                <span>These are reusable motion definitions—not generated files. Choose a compatible character to create or replace its sprite sheet.</span>
              </div>
            </div>
            <div className="library-grid animation-type-grid">
              {visibleAnimationTypes.map((definition) => {
                const candidates = catalog.characters.filter((entry) => entry.mode === definition.mode);
                const target = selectedTarget(definition.mode);
                const targetHasAnimation = target
                  ? characterAnimationAssets(target).some((asset) => asset.definition.id === definition.id)
                  : false;
                return (
                  <article className="library-card animation-type-card" key={definition.id}>
                    <div className={`animation-type-visual ${definition.category.toLowerCase()}`}>
                      <span>{definition.category === "Movement" ? "↗" : definition.category === "Combat" ? "✦" : "◌"}</span>
                      <small>{definition.frames} frames · 2×2 · {definition.aspectRatio}</small>
                    </div>
                    <div className="library-card-body">
                      <div className="animation-type-title">
                        <div><strong>{definition.label}</strong><span>{definition.category}</span></div>
                        <span className={`library-mode-badge inline ${definition.mode}`}>{modeLabel(definition.mode)}</span>
                      </div>
                      <p>{definition.description}</p>
                      {candidates.length > 0 ? (
                        <div className="animation-type-target">
                          <label htmlFor={`target-${definition.id}`}>Character</label>
                          <select
                            id={`target-${definition.id}`}
                            value={target?.id || ""}
                            onChange={(event) => selectTarget(definition.mode, event.target.value)}
                          >
                            {candidates.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
                          </select>
                          <button
                            className="btn btn-primary"
                            disabled={!target}
                            onClick={() => target && onEdit(target, "animations", definition.id)}
                          >
                            {targetHasAnimation ? "Edit / regenerate" : "Generate sprite sheet"}
                          </button>
                        </div>
                      ) : (
                        <button className="btn btn-secondary" onClick={() => onCreate("character", definition.mode)}>
                          Create {modeLabel(definition.mode)} character first
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : <LibraryEmpty title="No animation types found" text="Change the current search or mode filter." onCreate={() => setModeFilter("all")} />
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
      <button className="btn btn-primary" onClick={onCreate}>Continue</button>
    </div>
  );
}
