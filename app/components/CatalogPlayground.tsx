"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogEntry, CatalogGameMode, CatalogResponse } from "../lib/catalog-types";

const PixiSandbox = lazy(() => import("./PixiSandbox"));
const IsometricSandbox = lazy(() => import("./IsometricSandbox"));

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RuntimeFrame {
  dataUrl: string;
  width: number;
  height: number;
  contentBounds: BoundingBox;
}

interface GridDefinition {
  cols: number;
  rows: number;
  vertical: number[];
  horizontal: number[];
}

interface FrameSource {
  imageUrl: string | null;
  removeWhiteBackground: boolean;
}

interface SideScrollerRuntime {
  walk: RuntimeFrame[];
  jump: RuntimeFrame[];
  attack: RuntimeFrame[];
  idle: RuntimeFrame[];
  layers: {
    layer1Url: string | null;
    layer2Url: string | null;
    layer3Url: string | null;
  };
  scales: {
    walk: number;
    jump: number;
    attack: number;
    idle: number;
  };
  offsets: [number, number, number];
  visibility: [boolean, boolean, boolean];
  characterYOffset: number;
}

interface IsometricRuntime {
  walkDown: RuntimeFrame[];
  walkUp: RuntimeFrame[];
  walkSide: RuntimeFrame[];
  attackDown: RuntimeFrame[];
  attackUp: RuntimeFrame[];
  attackSide: RuntimeFrame[];
  idle: RuntimeFrame[];
  mapUrl: string;
  scales: {
    walkDown: number;
    walkUp: number;
    walkSide: number;
    attackDown: number;
    attackUp: number;
    attackSide: number;
    idle: number;
  };
  mapScale: number;
}

interface PlaygroundRuntime {
  key: string;
  mode: CatalogGameMode;
  sideScroller?: SideScrollerRuntime;
  isometric?: IsometricRuntime;
}

interface CatalogPlaygroundProps {
  catalog: CatalogResponse;
  initialMode?: CatalogGameMode;
  onBack: () => void;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function url(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function grid(snapshot: Record<string, unknown>, key: "walk" | "jump" | "attack" | "idle"): GridDefinition {
  const grids = record(snapshot.grids);
  const value = record(grids[key]);
  return {
    cols: Math.max(1, Math.round(number(value.cols, 2))),
    rows: Math.max(1, Math.round(number(value.rows, 2))),
    vertical: numbers(value.vertical),
    horizontal: numbers(value.horizontal),
  };
}

function positions(dividers: number[], cells: number): number[] {
  const valid = dividers
    .filter((value) => value > 0 && value < 100)
    .sort((left, right) => left - right);
  if (valid.length > 0) return [0, ...valid, 100];
  return Array.from({ length: cells + 1 }, (_, index) => (index / cells) * 100);
}

function contentBounds(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): BoundingBox {
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 10) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return maxX < minX || maxY < minY
    ? { x: 0, y: 0, width, height }
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function removeConnectedWhiteBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  let cursor = 0;

  const looksLikeWhiteBackground = (index: number) => {
    const offset = index * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    return pixels[offset + 3] > 0 && red > 220 && green > 220 && blue > 220 && Math.max(red, green, blue) - Math.min(red, green, blue) < 24;
  };
  const enqueue = (index: number) => {
    if (visited[index] || !looksLikeWhiteBackground(index)) return;
    visited[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (cursor < queue.length) {
    const index = queue[cursor];
    cursor += 1;
    pixels[index * 4 + 3] = 0;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y < height - 1) enqueue(index + width);
  }

  context.putImageData(imageData, 0, 0);
}

async function extractFrames(
  imageUrl: string | null,
  definition: GridDefinition,
  removeWhiteBackground = false
): Promise<RuntimeFrame[]> {
  if (!imageUrl) return [];

  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("A saved sprite sheet could not be loaded."));
    image.src = imageUrl;
  });

  const columns = positions(definition.vertical, definition.cols);
  const rows = positions(definition.horizontal, definition.rows);
  const frames: RuntimeFrame[] = [];

  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns.length - 1; columnIndex += 1) {
      const startX = Math.round((columns[columnIndex] / 100) * image.naturalWidth);
      const endX = Math.round((columns[columnIndex + 1] / 100) * image.naturalWidth);
      const startY = Math.round((rows[rowIndex] / 100) * image.naturalHeight);
      const endY = Math.round((rows[rowIndex + 1] / 100) * image.naturalHeight);
      const width = Math.max(1, endX - startX);
      const height = Math.max(1, endY - startY);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.drawImage(image, startX, startY, width, height, 0, 0, width, height);
      if (removeWhiteBackground) removeConnectedWhiteBackground(context, width, height);
      frames.push({
        dataUrl: canvas.toDataURL("image/png"),
        width,
        height,
        contentBounds: contentBounds(context, width, height),
      });
    }
  }

  return frames;
}

function characterSnapshot(entry: CatalogEntry): Record<string, unknown> {
  return record(entry.snapshot);
}

function frameSource(cleaned: unknown, original: unknown): FrameSource {
  const cleanedUrl = url(cleaned);
  return cleanedUrl
    ? { imageUrl: cleanedUrl, removeWhiteBackground: false }
    : { imageUrl: url(original), removeWhiteBackground: true };
}

function walkSource(entry: CatalogEntry): FrameSource {
  const snapshot = characterSnapshot(entry);
  return frameSource(record(snapshot.backgroundRemoved).walk, record(snapshot.spriteSheets).walk);
}

function worldIsPlayable(entry: CatalogEntry): boolean {
  const snapshot = record(entry.snapshot);
  if (entry.mode === "isometric") return Boolean(url(snapshot.isometricMapUrl));
  return Boolean(url(record(snapshot.customBackgroundLayers).layer1Url));
}

function tupleNumbers(value: unknown): [number, number, number] {
  const items = numbers(value);
  return items.length === 3 ? [items[0], items[1], items[2]] : [0, 0, 0];
}

function tupleBooleans(value: unknown): [boolean, boolean, boolean] {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "boolean")) {
    return [value[0], value[1], value[2]];
  }
  return [true, true, true];
}

function modeLabel(mode: CatalogGameMode): string {
  return mode === "isometric" ? "Isometric" : "Side-scroller";
}

export default function CatalogPlayground({ catalog, initialMode = "side-scroller", onBack }: CatalogPlaygroundProps) {
  const [mode, setMode] = useState<CatalogGameMode>(initialMode);
  const [characterId, setCharacterId] = useState("");
  const [worldId, setWorldId] = useState("");
  const [runtime, setRuntime] = useState<PlaygroundRuntime | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const launchId = useRef(0);

  const characters = useMemo(
    () => catalog.characters.filter((entry) => entry.mode === mode),
    [catalog.characters, mode]
  );
  const worlds = useMemo(
    () => catalog.worlds.filter((entry) => entry.mode === mode),
    [catalog.worlds, mode]
  );

  const selectedCharacter = characters.find((entry) => entry.id === characterId) || characters[0];
  const selectedWorld = worlds.find((entry) => entry.id === worldId) || worlds[0];
  const characterReady = Boolean(selectedCharacter && walkSource(selectedCharacter).imageUrl);
  const worldReady = Boolean(selectedWorld && worldIsPlayable(selectedWorld));

  useEffect(() => {
    const currentCharacters = catalog.characters.filter((entry) => entry.mode === mode);
    const currentWorlds = catalog.worlds.filter((entry) => entry.mode === mode);
    setCharacterId((current) => currentCharacters.some((entry) => entry.id === current) ? current : currentCharacters[0]?.id || "");
    setWorldId((current) => currentWorlds.some((entry) => entry.id === current) ? current : currentWorlds[0]?.id || "");
    setRuntime(null);
    setError(null);
    launchId.current += 1;
  }, [catalog.characters, catalog.worlds, mode]);

  const chooseMode = (nextMode: CatalogGameMode) => {
    setMode(nextMode);
    setRuntime(null);
    setError(null);
  };

  const changeCharacter = (id: string) => {
    setCharacterId(id);
    setRuntime(null);
    setError(null);
    launchId.current += 1;
  };

  const changeWorld = (id: string) => {
    setWorldId(id);
    setRuntime(null);
    setError(null);
    launchId.current += 1;
  };

  const launch = async () => {
    if (!selectedCharacter || !selectedWorld || !characterReady || !worldReady) return;
    const currentLaunchId = launchId.current + 1;
    launchId.current = currentLaunchId;
    setRuntime(null);
    setError(null);
    setStatus("Preparing saved animation frames...");

    try {
      const character = characterSnapshot(selectedCharacter);
      const sprites = record(character.spriteSheets);
      const removed = record(character.backgroundRemoved);
      const isometric = record(character.isometric);
      const world = record(selectedWorld.snapshot);

      if (mode === "side-scroller") {
        const walkSource = frameSource(removed.walk, sprites.walk);
        const jumpSource = frameSource(removed.jump, sprites.jump);
        const attackSource = frameSource(removed.attack, sprites.attack);
        const idleSource = frameSource(removed.idle, sprites.idle);
        const [walk, jump, attack, idle] = await Promise.all([
          extractFrames(walkSource.imageUrl, grid(character, "walk"), walkSource.removeWhiteBackground),
          extractFrames(jumpSource.imageUrl, grid(character, "jump"), jumpSource.removeWhiteBackground),
          extractFrames(attackSource.imageUrl, grid(character, "attack"), attackSource.removeWhiteBackground),
          extractFrames(idleSource.imageUrl, grid(character, "idle"), idleSource.removeWhiteBackground),
        ]);
        if (walk.length === 0) throw new Error("This character needs a Walk animation before it can enter the Playground.");
        const layers = record(world.customBackgroundLayers);
        const scaleValues = record(character.sideScrollerScales);
        const sideScroller: SideScrollerRuntime = {
          walk,
          jump: jump.length > 0 ? jump : walk,
          attack: attack.length > 0 ? attack : walk.slice(0, 1),
          idle: idle.length > 0 ? idle : walk.slice(0, 1),
          layers: {
            layer1Url: url(layers.layer1Url),
            layer2Url: url(layers.layer2Url),
            layer3Url: url(layers.layer3Url),
          },
          scales: {
            walk: number(scaleValues.walk, 1),
            jump: number(scaleValues.jump, 1),
            attack: number(scaleValues.attack, 1.35),
            idle: number(scaleValues.idle, 1),
          },
          offsets: tupleNumbers(world.customBgLayerOffsets),
          visibility: tupleBooleans(world.customBgLayerVisibility),
          characterYOffset: number(character.characterYOffset, 0),
        };
        if (launchId.current === currentLaunchId) {
          setRuntime({ key: `${selectedCharacter.id}:${selectedWorld.id}:${currentLaunchId}`, mode, sideScroller });
        }
      } else {
        const twoByTwo: GridDefinition = { cols: 2, rows: 2, vertical: [], horizontal: [] };
        const walkDownSource = frameSource(removed.walk, sprites.walk);
        const walkUpSource = frameSource(removed.jump, sprites.jump);
        const walkSideSource = frameSource(removed.attack, sprites.attack);
        const attackDownSource = frameSource(isometric.attackDownBackgroundRemoved, isometric.attackDown);
        const attackUpSource = frameSource(isometric.attackUpBackgroundRemoved, isometric.attackUp);
        const attackSideSource = frameSource(isometric.attackSideBackgroundRemoved, isometric.attackSide);
        const idleSource = frameSource(isometric.idleBackgroundRemoved, isometric.idle);
        const [walkDown, walkUp, walkSide, attackDown, attackUp, attackSide, idle] = await Promise.all([
          extractFrames(walkDownSource.imageUrl, grid(character, "walk"), walkDownSource.removeWhiteBackground),
          extractFrames(walkUpSource.imageUrl, grid(character, "jump"), walkUpSource.removeWhiteBackground),
          extractFrames(walkSideSource.imageUrl, grid(character, "attack"), walkSideSource.removeWhiteBackground),
          extractFrames(attackDownSource.imageUrl, twoByTwo, attackDownSource.removeWhiteBackground),
          extractFrames(attackUpSource.imageUrl, twoByTwo, attackUpSource.removeWhiteBackground),
          extractFrames(attackSideSource.imageUrl, twoByTwo, attackSideSource.removeWhiteBackground),
          extractFrames(idleSource.imageUrl, twoByTwo, idleSource.removeWhiteBackground),
        ]);
        if (walkDown.length === 0) throw new Error("This character needs a Walk Down animation before it can enter the Playground.");
        const mapUrl = url(world.isometricMapUrl);
        if (!mapUrl) throw new Error("This world does not have an isometric map yet.");
        const scaleValues = record(character.isometricScales);
        const up = walkUp.length > 0 ? walkUp : walkDown;
        const side = walkSide.length > 0 ? walkSide : walkDown;
        const isoRuntime: IsometricRuntime = {
          walkDown,
          walkUp: up,
          walkSide: side,
          attackDown: attackDown.length > 0 ? attackDown : walkDown.slice(0, 1),
          attackUp: attackUp.length > 0 ? attackUp : up.slice(0, 1),
          attackSide: attackSide.length > 0 ? attackSide : side.slice(0, 1),
          idle: idle.length > 0 ? idle : walkDown.slice(0, 1),
          mapUrl,
          scales: {
            walkDown: number(scaleValues.walkDown, 1),
            walkUp: number(scaleValues.walkUp, 1),
            walkSide: number(scaleValues.walkSide, 1),
            attackDown: number(scaleValues.attackDown, 1),
            attackUp: number(scaleValues.attackUp, 1),
            attackSide: number(scaleValues.attackSide, 1.45),
            idle: number(scaleValues.idle, 1),
          },
          mapScale: number(world.isometricMapScale, 1),
        };
        if (launchId.current === currentLaunchId) {
          setRuntime({ key: `${selectedCharacter.id}:${selectedWorld.id}:${currentLaunchId}`, mode, isometric: isoRuntime });
        }
      }
    } catch (caught) {
      if (launchId.current === currentLaunchId) {
        setError(caught instanceof Error ? caught.message : "Could not prepare this Playground pairing.");
      }
    } finally {
      if (launchId.current === currentLaunchId) setStatus(null);
    }
  };

  return (
    <section className="playground-shell">
      <div className="playground-heading">
        <div>
          <span className="library-eyebrow">CATALOG PLAYGROUND</span>
          <h2>Put a character inside a world</h2>
          <p>Choose two compatible catalog assets. Nothing here changes the saved character or world.</p>
        </div>
        <button className="btn btn-secondary" onClick={onBack}>← Back to Catalog</button>
      </div>

      <div className="playground-mode-switch" role="group" aria-label="Playground mode">
        {(["side-scroller", "isometric"] as const).map((value) => (
          <button key={value} className={mode === value ? "active" : ""} onClick={() => chooseMode(value)}>
            {modeLabel(value)}
          </button>
        ))}
      </div>

      <div className="playground-layout">
        <aside className="playground-picker">
          <div className="playground-field">
            <label htmlFor="playground-character">Character</label>
            <select id="playground-character" value={selectedCharacter?.id || ""} onChange={(event) => changeCharacter(event.target.value)}>
              {characters.length === 0 && <option value="">No {modeLabel(mode)} characters</option>}
              {characters.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}{walkSource(entry).imageUrl && walkSource(entry).removeWhiteBackground ? " — auto-clean background" : ""}
                </option>
              ))}
            </select>
            {selectedCharacter && (
              <div className="playground-selection-card">
                {selectedCharacter.thumbnailUrl ? <img src={selectedCharacter.thumbnailUrl} alt="" /> : <span>◇</span>}
                <div><strong>{selectedCharacter.name}</strong><small>{selectedCharacter.animationCount} animations</small></div>
              </div>
            )}
          </div>

          <div className="playground-join">+</div>

          <div className="playground-field">
            <label htmlFor="playground-world">World</label>
            <select id="playground-world" value={selectedWorld?.id || ""} onChange={(event) => changeWorld(event.target.value)}>
              {worlds.length === 0 && <option value="">No {modeLabel(mode)} worlds</option>}
              {worlds.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}{worldIsPlayable(entry) ? "" : " — no playable background"}
                </option>
              ))}
            </select>
            {selectedWorld && (
              <div className="playground-selection-card world">
                {selectedWorld.thumbnailUrl ? <img src={selectedWorld.thumbnailUrl} alt="" /> : <span>◇</span>}
                <div><strong>{selectedWorld.name}</strong><small>{modeLabel(selectedWorld.mode)} world</small></div>
              </div>
            )}
          </div>

          <button className="btn btn-success playground-launch" disabled={!characterReady || !worldReady || Boolean(status)} onClick={() => void launch()}>
            {status || (runtime ? "Restart Playground" : "Enter Playground")}
          </button>

          {!characterReady && selectedCharacter && <small className="playground-requirement">Generate a Walk animation for this character first.</small>}
          {!worldReady && selectedWorld && <small className="playground-requirement">Generate and save a compatible world background first.</small>}
          {error && <div className="error-message playground-error">{error}</div>}
        </aside>

        <div className="playground-stage">
          {runtime?.sideScroller ? (
            <div key={runtime.key} className="playground-running">
              <Suspense fallback={<div className="playground-stage-empty">Loading Playground...</div>}>
                <PixiSandbox
                  walkFrames={runtime.sideScroller.walk}
                  jumpFrames={runtime.sideScroller.jump}
                  attackFrames={runtime.sideScroller.attack}
                  idleFrames={runtime.sideScroller.idle}
                  fps={8}
                  customBackgroundLayers={runtime.sideScroller.layers}
                  spriteScales={runtime.sideScroller.scales}
                  customBgLayerOffsets={runtime.sideScroller.offsets}
                  characterYOffset={runtime.sideScroller.characterYOffset}
                  customBgLayerVisibility={runtime.sideScroller.visibility}
                />
              </Suspense>
              <div className="playground-controls"><span><kbd>A</kbd><kbd>D</kbd> Move</span><span><kbd>W</kbd> Jump</span><span><kbd>J</kbd> Attack</span></div>
            </div>
          ) : runtime?.isometric ? (
            <div key={runtime.key} className="playground-running">
              <Suspense fallback={<div className="playground-stage-empty">Loading Playground...</div>}>
                <IsometricSandbox
                  walkDownFrames={runtime.isometric.walkDown}
                  walkUpFrames={runtime.isometric.walkUp}
                  walkLeftFrames={runtime.isometric.walkSide}
                  walkRightFrames={runtime.isometric.walkSide}
                  attackDownFrames={runtime.isometric.attackDown}
                  attackUpFrames={runtime.isometric.attackUp}
                  attackSideFrames={runtime.isometric.attackSide}
                  idleFrames={runtime.isometric.idle}
                  fps={8}
                  mapUrl={runtime.isometric.mapUrl}
                  spriteScales={runtime.isometric.scales}
                  mapScale={runtime.isometric.mapScale}
                />
              </Suspense>
              <div className="playground-controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span><span><kbd>J</kbd> Attack</span></div>
            </div>
          ) : (
            <div className="playground-stage-empty">
              <span>◇</span>
              <strong>Your selected pairing will appear here</strong>
              <small>Choose a character and world, then enter the Playground.</small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
