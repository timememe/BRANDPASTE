"use client";

import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import type { CatalogEntry, CatalogKind, CatalogResponse } from "./lib/catalog-types";

// Dynamically import sandbox components to avoid SSR issues
const PixiSandbox = lazy(() => import("./components/PixiSandbox"));
const IsometricSandbox = lazy(() => import("./components/IsometricSandbox"));

// Scale defaults kept in sync with the sandbox components
const DEFAULT_SIDE_SCROLLER_SCALES = { walk: 1, jump: 1, attack: 1.35, idle: 1 };
const DEFAULT_ISOMETRIC_SCALES = {
  walkDown: 1, walkUp: 1, walkSide: 1,
  attackDown: 1, attackUp: 1, attackSide: 1.45,
  idle: 1,
};

// Lightweight local mark used for the Codex-backed UI and loading state.
const AgentLogo = ({ className = "", size = 32 }: { className?: string; size?: number }) => (
  <svg 
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    className={className}
  >
    <rect x="3" y="3" width="26" height="26" rx="8" stroke="currentColor" strokeWidth="2.5" />
    <path d="M10 12L6.5 16L10 20M22 12L25.5 16L22 20M18.5 9L13.5 23" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AgentSpinner = ({ size = 48 }: { size?: number }) => (
  <AgentLogo className="agent-spinner" size={size} />
);

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type GameMode = "side-scroller" | "isometric";
type GptImageQuality = "low" | "medium" | "high";

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Frame {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // Bounding box of actual content (non-transparent pixels) within this frame
  contentBounds: BoundingBox;
}

interface ApiResponsePayload {
  error: string;
  imageUrl: string;
  width: number;
  height: number;
  layer1Url: string;
  layer2Url: string;
  layer3Url: string;
  mapUrl: string;
}

interface CharacterCatalogSnapshot {
  gameMode: GameMode;
  characterPrompt: string;
  characterImageUrl: string | null;
  spriteSheets: {
    walk: string | null;
    jump: string | null;
    attack: string | null;
    idle: string | null;
  };
  backgroundRemoved: {
    walk: string | null;
    jump: string | null;
    attack: string | null;
    idle: string | null;
  };
  isometric: {
    idle: string | null;
    idleBackgroundRemoved: string | null;
    attackDown: string | null;
    attackUp: string | null;
    attackSide: string | null;
    attackDownBackgroundRemoved: string | null;
    attackUpBackgroundRemoved: string | null;
    attackSideBackgroundRemoved: string | null;
  };
  grids: Record<"walk" | "jump" | "attack" | "idle", {
    cols: number;
    rows: number;
    vertical: number[];
    horizontal: number[];
    dimensions: { width: number; height: number };
  }>;
  sideScrollerScales: typeof DEFAULT_SIDE_SCROLLER_SCALES;
  isometricScales: typeof DEFAULT_ISOMETRIC_SCALES;
  characterYOffset: number;
}

interface WorldCatalogSnapshot {
  gameMode: GameMode;
  character: CharacterCatalogSnapshot;
  backgroundMode: "default" | "custom";
  customBackgroundLayers: {
    layer1Url: string | null;
    layer2Url: string | null;
    layer3Url: string | null;
  };
  isometricMapUrl: string | null;
  customBgLayerOffsets: [number, number, number];
  customBgLayerVisibility: [boolean, boolean, boolean];
  isometricMapScale: number;
  characterYOffset: number;
}

async function readApiResponse(response: Response): Promise<ApiResponsePayload> {
  return (await response.json()) as ApiResponsePayload;
}

// Get bounding box of non-transparent pixels in image data
function getContentBounds(ctx: CanvasRenderingContext2D, width: number, height: number): BoundingBox {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) { // Threshold for "visible" pixel
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  // If no content found, return full frame
  if (minX > maxX || minY > maxY) {
    return { x: 0, y: 0, width, height };
  }
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export default function Home() {
  // Step management
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Game mode: side-scroller or isometric
  const [gameMode, setGameMode] = useState<GameMode>("side-scroller");

  // The image backend is fixed to the VPS Codex Agent.
  const [imageModel, setImageModel] = useState("codex-agent");
  const [gptImageQuality, setGptImageQuality] = useState<GptImageQuality>("high");

  // Per-sprite manual scale multipliers for the sandbox
  const [sideScrollerScales, setSideScrollerScales] = useState(DEFAULT_SIDE_SCROLLER_SCALES);
  const [isometricScales, setIsometricScales] = useState(DEFAULT_ISOMETRIC_SCALES);

  // Map zoom multiplier (isometric only)
  const [isometricMapScale, setIsometricMapScale] = useState(1);

  // Per-layer vertical offsets for side-scroller custom background (px)
  const [customBgLayerOffsets, setCustomBgLayerOffsets] = useState<[number, number, number]>([0, 0, 0]);

  // Vertical offset for the side-scroller character (px, positive = down)
  const [characterYOffset, setCharacterYOffset] = useState(0);

  // Per-layer on/off toggle for the side-scroller custom background
  const [customBgLayerVisibility, setCustomBgLayerVisibility] = useState<[boolean, boolean, boolean]>([true, true, true]);

  const toggleCustomBgLayer = (idx: 0 | 1 | 2) => {
    setCustomBgLayerVisibility((prev) => {
      const copy = [...prev] as [boolean, boolean, boolean];
      copy[idx] = !copy[idx];
      return copy;
    });
  };

  // Step 1: Character generation
  const [characterInputMode, setCharacterInputMode] = useState<"text" | "image">("text");
  const [characterPrompt, setCharacterPrompt] = useState("");
  const [inputImageUrl, setInputImageUrl] = useState("");
  const [characterImageUrl, setCharacterImageUrl] = useState<string | null>(null);
  const [isGeneratingCharacter, setIsGeneratingCharacter] = useState(false);

  // Step 2: Sprite sheet generation (walk + jump + attack + idle)
  const [walkSpriteSheetUrl, setWalkSpriteSheetUrl] = useState<string | null>(null);
  const [jumpSpriteSheetUrl, setJumpSpriteSheetUrl] = useState<string | null>(null);
  const [attackSpriteSheetUrl, setAttackSpriteSheetUrl] = useState<string | null>(null);
  const [idleSpriteSheetUrl, setIdleSpriteSheetUrl] = useState<string | null>(null);
  const [isGeneratingSpriteSheet, setIsGeneratingSpriteSheet] = useState(false);

  // Step 3: Background removal (walk + jump + attack + idle)
  const [walkBgRemovedUrl, setWalkBgRemovedUrl] = useState<string | null>(null);
  const [jumpBgRemovedUrl, setJumpBgRemovedUrl] = useState<string | null>(null);
  const [attackBgRemovedUrl, setAttackBgRemovedUrl] = useState<string | null>(null);
  const [idleBgRemovedUrl, setIdleBgRemovedUrl] = useState<string | null>(null);
  const [isRemovingBg, setIsRemovingBg] = useState(false);

  // Step 4: Frame extraction (grid-based) - walk
  const [walkGridCols, setWalkGridCols] = useState(2);
  const [walkGridRows, setWalkGridRows] = useState(2);
  const [walkVerticalDividers, setWalkVerticalDividers] = useState<number[]>([]);
  const [walkHorizontalDividers, setWalkHorizontalDividers] = useState<number[]>([]);
  const [walkExtractedFrames, setWalkExtractedFrames] = useState<Frame[]>([]);
  const [walkSpriteSheetDimensions, setWalkSpriteSheetDimensions] = useState({ width: 0, height: 0 });
  const walkSpriteSheetRef = useRef<HTMLImageElement>(null);

  // Step 4: Frame extraction (grid-based) - jump
  const [jumpGridCols, setJumpGridCols] = useState(2);
  const [jumpGridRows, setJumpGridRows] = useState(2);
  const [jumpVerticalDividers, setJumpVerticalDividers] = useState<number[]>([]);
  const [jumpHorizontalDividers, setJumpHorizontalDividers] = useState<number[]>([]);
  const [jumpExtractedFrames, setJumpExtractedFrames] = useState<Frame[]>([]);
  const [jumpSpriteSheetDimensions, setJumpSpriteSheetDimensions] = useState({ width: 0, height: 0 });
  const jumpSpriteSheetRef = useRef<HTMLImageElement>(null);

  // Step 4: Frame extraction (grid-based) - attack
  const [attackGridCols, setAttackGridCols] = useState(2);
  const [attackGridRows, setAttackGridRows] = useState(2);
  const [attackVerticalDividers, setAttackVerticalDividers] = useState<number[]>([]);
  const [attackHorizontalDividers, setAttackHorizontalDividers] = useState<number[]>([]);
  const [attackExtractedFrames, setAttackExtractedFrames] = useState<Frame[]>([]);
  const [attackSpriteSheetDimensions, setAttackSpriteSheetDimensions] = useState({ width: 0, height: 0 });
  const attackSpriteSheetRef = useRef<HTMLImageElement>(null);

  // Step 4: Frame extraction (grid-based) - idle
  const [idleGridCols, setIdleGridCols] = useState(2);
  const [idleGridRows, setIdleGridRows] = useState(2);
  const [idleVerticalDividers, setIdleVerticalDividers] = useState<number[]>([]);
  const [idleHorizontalDividers, setIdleHorizontalDividers] = useState<number[]>([]);
  const [idleExtractedFrames, setIdleExtractedFrames] = useState<Frame[]>([]);
  const [idleSpriteSheetDimensions, setIdleSpriteSheetDimensions] = useState({ width: 0, height: 0 });
  const idleSpriteSheetRef = useRef<HTMLImageElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  
  // Which sprite sheet is being edited
  const [activeSheet, setActiveSheet] = useState<"walk" | "jump" | "attack" | "idle">("walk");

  // Step 5: Animation preview
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [direction, setDirection] = useState<"right" | "left">("right");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Step 6: Sandbox
  const [backgroundMode, setBackgroundMode] = useState<"default" | "custom">("default");
  const [customBackgroundLayers, setCustomBackgroundLayers] = useState<{
    layer1Url: string | null;
    layer2Url: string | null;
    layer3Url: string | null;
  }>({ layer1Url: null, layer2Url: null, layer3Url: null });
  const [isGeneratingBackground, setIsGeneratingBackground] = useState(false);

  // Isometric map
  const [isometricMapUrl, setIsometricMapUrl] = useState<string | null>(null);

  // Isometric idle sprite (front-facing)
  const [isoIdleUrl, setIsoIdleUrl] = useState<string | null>(null);
  const [isoIdleBgUrl, setIsoIdleBgUrl] = useState<string | null>(null);
  const [isoIdleFrames, setIsoIdleFrames] = useState<Frame[]>([]);
  const [isoIdleDimensions, setIsoIdleDimensions] = useState({ width: 0, height: 0 });

  // Isometric attack sprites (3 directions: down, up, side — right is flipped side)
  const [isoAttackDownUrl, setIsoAttackDownUrl] = useState<string | null>(null);
  const [isoAttackUpUrl, setIsoAttackUpUrl] = useState<string | null>(null);
  const [isoAttackSideUrl, setIsoAttackSideUrl] = useState<string | null>(null);
  const [isoAttackDownBgUrl, setIsoAttackDownBgUrl] = useState<string | null>(null);
  const [isoAttackUpBgUrl, setIsoAttackUpBgUrl] = useState<string | null>(null);
  const [isoAttackSideBgUrl, setIsoAttackSideBgUrl] = useState<string | null>(null);
  const [isoAttackDownFrames, setIsoAttackDownFrames] = useState<Frame[]>([]);
  const [isoAttackUpFrames, setIsoAttackUpFrames] = useState<Frame[]>([]);
  const [isoAttackSideFrames, setIsoAttackSideFrames] = useState<Frame[]>([]);
  const [isoAttackDownDimensions, setIsoAttackDownDimensions] = useState({ width: 0, height: 0 });
  const [isoAttackUpDimensions, setIsoAttackUpDimensions] = useState({ width: 0, height: 0 });
  const [isoAttackSideDimensions, setIsoAttackSideDimensions] = useState({ width: 0, height: 0 });

  // Error handling
  const [error, setError] = useState<string | null>(null);

  // Persistent project catalog (metadata + GitHub-backed generated assets)
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [catalogTab, setCatalogTab] = useState<CatalogKind>("character");
  const [catalog, setCatalog] = useState<CatalogResponse>({ characters: [], worlds: [] });
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [isCatalogSaving, setIsCatalogSaving] = useState<CatalogKind | null>(null);
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  const [loadedCatalogIds, setLoadedCatalogIds] = useState<{
    character?: string;
    world?: string;
  }>({});

  // Initialize walk divider positions when grid changes
  useEffect(() => {
    if (walkSpriteSheetDimensions.width > 0) {
      const vPositions: number[] = [];
      for (let i = 1; i < walkGridCols; i++) {
        vPositions.push((i / walkGridCols) * 100);
      }
      setWalkVerticalDividers(vPositions);

      const hPositions: number[] = [];
      for (let i = 1; i < walkGridRows; i++) {
        hPositions.push((i / walkGridRows) * 100);
      }
      setWalkHorizontalDividers(hPositions);
    }
  }, [walkGridCols, walkGridRows, walkSpriteSheetDimensions.width]);

  // Initialize jump divider positions when grid changes
  useEffect(() => {
    if (jumpSpriteSheetDimensions.width > 0) {
      const vPositions: number[] = [];
      for (let i = 1; i < jumpGridCols; i++) {
        vPositions.push((i / jumpGridCols) * 100);
      }
      setJumpVerticalDividers(vPositions);

      const hPositions: number[] = [];
      for (let i = 1; i < jumpGridRows; i++) {
        hPositions.push((i / jumpGridRows) * 100);
      }
      setJumpHorizontalDividers(hPositions);
    }
  }, [jumpGridCols, jumpGridRows, jumpSpriteSheetDimensions.width]);

  // Initialize attack divider positions when grid changes
  useEffect(() => {
    if (attackSpriteSheetDimensions.width > 0) {
      const vPositions: number[] = [];
      for (let i = 1; i < attackGridCols; i++) {
        vPositions.push((i / attackGridCols) * 100);
      }
      setAttackVerticalDividers(vPositions);

      const hPositions: number[] = [];
      for (let i = 1; i < attackGridRows; i++) {
        hPositions.push((i / attackGridRows) * 100);
      }
      setAttackHorizontalDividers(hPositions);
    }
  }, [attackGridCols, attackGridRows, attackSpriteSheetDimensions.width]);

  // Initialize idle divider positions when grid changes
  useEffect(() => {
    if (idleSpriteSheetDimensions.width > 0) {
      const vPositions: number[] = [];
      for (let i = 1; i < idleGridCols; i++) {
        vPositions.push((i / idleGridCols) * 100);
      }
      setIdleVerticalDividers(vPositions);

      const hPositions: number[] = [];
      for (let i = 1; i < idleGridRows; i++) {
        hPositions.push((i / idleGridRows) * 100);
      }
      setIdleHorizontalDividers(hPositions);
    }
  }, [idleGridCols, idleGridRows, idleSpriteSheetDimensions.width]);

  // Extract walk frames when divider positions change
  // Guard: wait for dividers to be initialized (non-empty) before extracting
  useEffect(() => {
    if (walkBgRemovedUrl && walkSpriteSheetDimensions.width > 0 && walkVerticalDividers.length > 0 && walkHorizontalDividers.length > 0) {
      extractWalkFrames();
    }
  }, [walkBgRemovedUrl, walkVerticalDividers, walkHorizontalDividers, walkSpriteSheetDimensions]);

  // Extract jump frames when divider positions change
  useEffect(() => {
    if (jumpBgRemovedUrl && jumpSpriteSheetDimensions.width > 0 && jumpVerticalDividers.length > 0 && jumpHorizontalDividers.length > 0) {
      extractJumpFrames();
    }
  }, [jumpBgRemovedUrl, jumpVerticalDividers, jumpHorizontalDividers, jumpSpriteSheetDimensions]);

  // Extract attack frames when divider positions change
  useEffect(() => {
    if (attackBgRemovedUrl && attackSpriteSheetDimensions.width > 0 && attackVerticalDividers.length > 0 && attackHorizontalDividers.length > 0) {
      extractAttackFrames();
    }
  }, [attackBgRemovedUrl, attackVerticalDividers, attackHorizontalDividers, attackSpriteSheetDimensions]);

  // Extract idle frames when divider positions change
  useEffect(() => {
    if (idleBgRemovedUrl && idleSpriteSheetDimensions.width > 0 && idleVerticalDividers.length > 0 && idleHorizontalDividers.length > 0) {
      extractIdleFrames();
    }
  }, [idleBgRemovedUrl, idleVerticalDividers, idleHorizontalDividers, idleSpriteSheetDimensions]);

  // Auto-extract isometric attack frames (always 2x2 grid, no manual dividers)
  const autoExtractFrames = useCallback((
    bgRemovedUrl: string,
    setFrames: (frames: Frame[]) => void,
    setDimensions: (dims: { width: number; height: number }) => void,
  ) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      const frames: Frame[] = [];
      const cols = 2, rows = 2;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const startX = Math.round((col / cols) * img.width);
          const endX = Math.round(((col + 1) / cols) * img.width);
          const startY = Math.round((row / rows) * img.height);
          const endY = Math.round(((row + 1) / rows) * img.height);
          const frameWidth = endX - startX;
          const frameHeight = endY - startY;
          const canvas = document.createElement("canvas");
          canvas.width = frameWidth;
          canvas.height = frameHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, startX, startY, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            const contentBounds = getContentBounds(ctx, frameWidth, frameHeight);
            frames.push({ dataUrl: canvas.toDataURL("image/png"), x: startX, y: startY, width: frameWidth, height: frameHeight, contentBounds });
          }
        }
      }
      setFrames(frames);
    };
    img.src = bgRemovedUrl;
  }, []);

  useEffect(() => {
    if (isoAttackDownBgUrl) autoExtractFrames(isoAttackDownBgUrl, setIsoAttackDownFrames, setIsoAttackDownDimensions);
  }, [isoAttackDownBgUrl, autoExtractFrames]);

  useEffect(() => {
    if (isoAttackUpBgUrl) autoExtractFrames(isoAttackUpBgUrl, setIsoAttackUpFrames, setIsoAttackUpDimensions);
  }, [isoAttackUpBgUrl, autoExtractFrames]);

  useEffect(() => {
    if (isoAttackSideBgUrl) autoExtractFrames(isoAttackSideBgUrl, setIsoAttackSideFrames, setIsoAttackSideDimensions);
  }, [isoAttackSideBgUrl, autoExtractFrames]);

  useEffect(() => {
    if (isoIdleBgUrl) autoExtractFrames(isoIdleBgUrl, setIsoIdleFrames, setIsoIdleDimensions);
  }, [isoIdleBgUrl, autoExtractFrames]);

  // Animation loop (uses walk frames for preview)
  useEffect(() => {
    if (!isPlaying || walkExtractedFrames.length === 0) return;

    const interval = setInterval(() => {
      setCurrentFrameIndex((prev) => (prev + 1) % walkExtractedFrames.length);
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [isPlaying, fps, walkExtractedFrames.length]);

  // Draw current frame on canvas (uses walk frames for preview)
  useEffect(() => {
    if (walkExtractedFrames.length === 0 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const frame = walkExtractedFrames[currentFrameIndex];
    if (!frame) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (direction === "left") {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(img, -canvas.width, 0);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0);
      }
    };
    img.src = frame.dataUrl;
  }, [currentFrameIndex, walkExtractedFrames, direction]);

  // Keyboard controls for Step 5
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentStep !== 5) return;

      if (e.key === "d" || e.key === "D" || e.key === "ArrowRight") {
        setDirection("right");
        if (!isPlaying) setIsPlaying(true);
      } else if (e.key === "a" || e.key === "A" || e.key === "ArrowLeft") {
        setDirection("left");
        if (!isPlaying) setIsPlaying(true);
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying(false);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (currentStep !== 5) return;

      if (
        e.key === "d" ||
        e.key === "D" ||
        e.key === "ArrowRight" ||
        e.key === "a" ||
        e.key === "A" ||
        e.key === "ArrowLeft"
      ) {
        setIsPlaying(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [currentStep, isPlaying]);

  // Sandbox keyboard controls and game loop are now handled inside PixiSandbox component

  // API calls
  const generateCharacter = async () => {
    // Validate based on input mode
    if (characterInputMode === "text" && !characterPrompt.trim()) {
      setError("Please enter a prompt");
      return;
    }
    if (characterInputMode === "image" && !inputImageUrl.trim()) {
      setError("Please enter an image URL");
      return;
    }

    setError(null);
    setIsGeneratingCharacter(true);

    try {
      const requestBody = characterInputMode === "image"
        ? { imageUrl: inputImageUrl, prompt: characterPrompt || undefined }
        : { prompt: characterPrompt };

      const response = await fetch("/api/generate-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate character");
      }

      setCharacterImageUrl(data.imageUrl);
      setLoadedCatalogIds({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate character");
    } finally {
      setIsGeneratingCharacter(false);
    }
  };

  const generateSpriteSheet = async () => {
    if (!characterImageUrl) return;

    setError(null);
    setIsGeneratingSpriteSheet(true);

    try {
      if (gameMode === "isometric") {
        // Phase 1: Generate 3 walk directions + attack-down + idle in parallel
        const [downResponse, upResponse, sideResponse, atkDownResponse, idleIsoResponse] = await Promise.all([
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "walk-down" }),
          }),
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "walk-up" }),
          }),
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "walk-side" }),
          }),
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "attack-down" }),
          }),
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "idle-iso" }),
          }),
        ]);

        const downData = await readApiResponse(downResponse);
        const upData = await readApiResponse(upResponse);
        const sideData = await readApiResponse(sideResponse);
        const atkDownData = await readApiResponse(atkDownResponse);
        const idleIsoData = await readApiResponse(idleIsoResponse);

        if (!downResponse.ok) throw new Error(downData.error || "Failed to generate walk-down sprite sheet");
        if (!upResponse.ok) throw new Error(upData.error || "Failed to generate walk-up sprite sheet");
        if (!sideResponse.ok) throw new Error(sideData.error || "Failed to generate walk-side sprite sheet");
        if (!atkDownResponse.ok) throw new Error(atkDownData.error || "Failed to generate attack-down sprite sheet");
        if (!idleIsoResponse.ok) throw new Error(idleIsoData.error || "Failed to generate idle sprite sheet");

        // Walk slots: walk=down, jump=up, attack=side(left), idle=side(right, flipped in sandbox)
        setWalkSpriteSheetUrl(downData.imageUrl);
        setJumpSpriteSheetUrl(upData.imageUrl);
        setAttackSpriteSheetUrl(sideData.imageUrl);
        setIdleSpriteSheetUrl(sideData.imageUrl);
        setIsoAttackDownUrl(atkDownData.imageUrl);
        setIsoIdleUrl(idleIsoData.imageUrl);

        // Phase 2: Generate attack-up and attack-side using attack-down as reference for consistency
        const [atkUpResponse, atkSideResponse] = await Promise.all([
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "attack-up", referenceImageUrls: [atkDownData.imageUrl] }),
          }),
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "attack-side", referenceImageUrls: [atkDownData.imageUrl] }),
          }),
        ]);

        const atkUpData = await readApiResponse(atkUpResponse);
        const atkSideData = await readApiResponse(atkSideResponse);

        if (!atkUpResponse.ok) throw new Error(atkUpData.error || "Failed to generate attack-up sprite sheet");
        if (!atkSideResponse.ok) throw new Error(atkSideData.error || "Failed to generate attack-side sprite sheet");

        setIsoAttackUpUrl(atkUpData.imageUrl);
        setIsoAttackSideUrl(atkSideData.imageUrl);
      } else {
        // Side-scroller: generate all 4 types
        const [walkResponse, jumpResponse, attackResponse, idleResponse] = await Promise.all([
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "walk" }),
          }),
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "jump" }),
          }),
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "attack" }),
          }),
          fetch("/api/generate-sprite-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ characterImageUrl, type: "idle" }),
          }),
        ]);

        const walkData = await readApiResponse(walkResponse);
        const jumpData = await readApiResponse(jumpResponse);
        const attackData = await readApiResponse(attackResponse);
        const idleData = await readApiResponse(idleResponse);

        if (!walkResponse.ok) throw new Error(walkData.error || "Failed to generate walk sprite sheet");
        if (!jumpResponse.ok) throw new Error(jumpData.error || "Failed to generate jump sprite sheet");
        if (!attackResponse.ok) throw new Error(attackData.error || "Failed to generate attack sprite sheet");
        if (!idleResponse.ok) throw new Error(idleData.error || "Failed to generate idle sprite sheet");

        setWalkSpriteSheetUrl(walkData.imageUrl);
        setJumpSpriteSheetUrl(jumpData.imageUrl);
        setAttackSpriteSheetUrl(attackData.imageUrl);
        setIdleSpriteSheetUrl(idleData.imageUrl);
      }

      setCompletedSteps((prev) => new Set([...prev, 1]));
      setCurrentStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate sprite sheets");
    } finally {
      setIsGeneratingSpriteSheet(false);
    }
  };

  const [regeneratingSpriteSheet, setRegeneratingSpriteSheet] = useState<string | null>(null);

  // Map internal slot names to API sprite types based on game mode
  const getSpriteType = (slot: "walk" | "jump" | "attack" | "idle"): string => {
    if (gameMode === "isometric") {
      const map: Record<string, string> = { walk: "walk-down", jump: "walk-up", attack: "walk-side", idle: "walk-side" };
      return map[slot];
    }
    return slot;
  };

  // Labels for display based on game mode
  const getSheetLabel = (slot: "walk" | "jump" | "attack" | "idle"): string => {
    if (gameMode === "isometric") {
      // walk=down, jump=up, attack=side(right), idle=side(left is flipped right)
      const map: Record<string, string> = { walk: "Walk Down", jump: "Walk Up", attack: "Walk Right", idle: "Walk Left" };
      return map[slot];
    }
    const map: Record<string, string> = { walk: "Walk", jump: "Jump", attack: "Attack", idle: "Idle" };
    return map[slot];
  };

  const regenerateSpriteSheet = async (type: "walk" | "jump" | "attack" | "idle") => {
    if (!characterImageUrl) return;

    setError(null);
    setRegeneratingSpriteSheet(type);

    try {
      const response = await fetch("/api/generate-sprite-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterImageUrl, type: getSpriteType(type) }),
      });

      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || `Failed to generate ${type} sprite sheet`);
      }

      if (type === "walk") {
        setWalkSpriteSheetUrl(data.imageUrl);
      } else if (type === "jump") {
        setJumpSpriteSheetUrl(data.imageUrl);
      } else if (type === "attack") {
        setAttackSpriteSheetUrl(data.imageUrl);
        // In isometric mode, idle slot mirrors attack slot (walk-right = flipped walk-left)
        if (gameMode === "isometric") setIdleSpriteSheetUrl(data.imageUrl);
      } else if (type === "idle") {
        setIdleSpriteSheetUrl(data.imageUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to regenerate ${type} sprite sheet`);
    } finally {
      setRegeneratingSpriteSheet(null);
    }
  };

  const regenerateIsoAttack = async (dir: "attack-down" | "attack-up" | "attack-side") => {
    if (!characterImageUrl) return;

    setError(null);
    setRegeneratingSpriteSheet(dir);

    try {
      // attack-up and attack-side use attack-down as reference for consistency
      const refUrls = dir !== "attack-down" && isoAttackDownUrl ? [isoAttackDownUrl] : undefined;

      const response = await fetch("/api/generate-sprite-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterImageUrl, type: dir, referenceImageUrls: refUrls }),
      });

      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || `Failed to regenerate ${dir}`);

      if (dir === "attack-down") setIsoAttackDownUrl(data.imageUrl);
      else if (dir === "attack-up") setIsoAttackUpUrl(data.imageUrl);
      else setIsoAttackSideUrl(data.imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to regenerate ${dir}`);
    } finally {
      setRegeneratingSpriteSheet(null);
    }
  };

  const removeBackground = async () => {
    if (!walkSpriteSheetUrl || !jumpSpriteSheetUrl || !attackSpriteSheetUrl || !idleSpriteSheetUrl) return;

    setError(null);
    setIsRemovingBg(true);

    try {
      // Build list of URLs to remove backgrounds from
      const bgRemovalUrls = [walkSpriteSheetUrl, jumpSpriteSheetUrl, attackSpriteSheetUrl, idleSpriteSheetUrl];

      // In isometric mode, also remove bg from attack sheets
      if (gameMode === "isometric" && isoAttackDownUrl && isoAttackUpUrl && isoAttackSideUrl && isoIdleUrl) {
        bgRemovalUrls.push(isoAttackDownUrl, isoAttackUpUrl, isoAttackSideUrl, isoIdleUrl);
      }

      const responses = await Promise.all(
        bgRemovalUrls.map((url) =>
          fetch("/api/remove-background", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: url }),
          })
        )
      );

      const results = await Promise.all(responses.map(readApiResponse));

      // Check for errors
      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].ok) throw new Error(results[i].error || "Failed to remove background");
      }

      // Set walk/jump/attack/idle bg removed URLs
      setWalkBgRemovedUrl(results[0].imageUrl);
      setJumpBgRemovedUrl(results[1].imageUrl);
      setAttackBgRemovedUrl(results[2].imageUrl);
      setIdleBgRemovedUrl(results[3].imageUrl);
      setWalkSpriteSheetDimensions({ width: results[0].width, height: results[0].height });
      setJumpSpriteSheetDimensions({ width: results[1].width, height: results[1].height });
      setAttackSpriteSheetDimensions({ width: results[2].width, height: results[2].height });
      setIdleSpriteSheetDimensions({ width: results[3].width, height: results[3].height });

      // Set isometric attack bg removed URLs
      if (gameMode === "isometric" && results.length >= 8) {
        setIsoAttackDownBgUrl(results[4].imageUrl);
        setIsoAttackUpBgUrl(results[5].imageUrl);
        setIsoAttackSideBgUrl(results[6].imageUrl);
        setIsoIdleBgUrl(results[7].imageUrl);
      }

      setCompletedSteps((prev) => new Set([...prev, 2]));
      setCurrentStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove background");
    } finally {
      setIsRemovingBg(false);
    }
  };

  const generateBackground = async () => {
    if (!characterImageUrl) return;

    setError(null);
    setIsGeneratingBackground(true);

    try {
      const response = await fetch("/api/generate-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterImageUrl,
          characterPrompt: characterPrompt || "pixel art game character",
        }),
      });

      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate background");
      }

      setCustomBackgroundLayers({
        layer1Url: data.layer1Url,
        layer2Url: data.layer2Url,
        layer3Url: data.layer3Url,
      });
      setBackgroundMode("custom");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate background");
    } finally {
      setIsGeneratingBackground(false);
    }
  };

  const generateIsometricMap = async () => {
    if (!characterImageUrl) return;

    setError(null);
    setIsGeneratingBackground(true);

    try {
      const response = await fetch("/api/generate-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterImageUrl,
          characterPrompt: characterPrompt || "pixel art game character",
          mode: "isometric",
        }),
      });

      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate isometric map");
      }

      setIsometricMapUrl(data.mapUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate isometric map");
    } finally {
      setIsGeneratingBackground(false);
    }
  };

  const [regeneratingLayer, setRegeneratingLayer] = useState<number | null>(null);

  const regenerateBackgroundLayer = async (layerNumber: 1 | 2 | 3) => {
    if (!characterImageUrl || !characterPrompt || !customBackgroundLayers.layer1Url) return;

    setError(null);
    setRegeneratingLayer(layerNumber);

    try {
      const response = await fetch("/api/generate-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterImageUrl,
          characterPrompt,
          regenerateLayer: layerNumber,
          existingLayers: customBackgroundLayers,
        }),
      });

      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Failed to regenerate layer");
      }

      setCustomBackgroundLayers({
        layer1Url: data.layer1Url,
        layer2Url: data.layer2Url,
        layer3Url: data.layer3Url,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate layer");
    } finally {
      setRegeneratingLayer(null);
    }
  };

  const extractWalkFrames = useCallback(async () => {
    if (!walkBgRemovedUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const frames: Frame[] = [];
      const colPositions = [0, ...walkVerticalDividers, 100];
      const rowPositions = [0, ...walkHorizontalDividers, 100];

      for (let row = 0; row < rowPositions.length - 1; row++) {
        const startY = Math.round((rowPositions[row] / 100) * img.height);
        const endY = Math.round((rowPositions[row + 1] / 100) * img.height);
        const frameHeight = endY - startY;

        for (let col = 0; col < colPositions.length - 1; col++) {
          const startX = Math.round((colPositions[col] / 100) * img.width);
          const endX = Math.round((colPositions[col + 1] / 100) * img.width);
          const frameWidth = endX - startX;

          const canvas = document.createElement("canvas");
          canvas.width = frameWidth;
          canvas.height = frameHeight;
          const ctx = canvas.getContext("2d");

          if (ctx) {
            ctx.drawImage(img, startX, startY, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            const contentBounds = getContentBounds(ctx, frameWidth, frameHeight);
            frames.push({
              dataUrl: canvas.toDataURL("image/png"),
              x: startX,
              y: startY,
              width: frameWidth,
              height: frameHeight,
              contentBounds,
            });
          }
        }
      }

      setWalkExtractedFrames(frames);
    };

    img.src = walkBgRemovedUrl;
  }, [walkBgRemovedUrl, walkVerticalDividers, walkHorizontalDividers]);

  const extractJumpFrames = useCallback(async () => {
    if (!jumpBgRemovedUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const frames: Frame[] = [];
      const colPositions = [0, ...jumpVerticalDividers, 100];
      const rowPositions = [0, ...jumpHorizontalDividers, 100];

      for (let row = 0; row < rowPositions.length - 1; row++) {
        const startY = Math.round((rowPositions[row] / 100) * img.height);
        const endY = Math.round((rowPositions[row + 1] / 100) * img.height);
        const frameHeight = endY - startY;

        for (let col = 0; col < colPositions.length - 1; col++) {
          const startX = Math.round((colPositions[col] / 100) * img.width);
          const endX = Math.round((colPositions[col + 1] / 100) * img.width);
          const frameWidth = endX - startX;

          const canvas = document.createElement("canvas");
          canvas.width = frameWidth;
          canvas.height = frameHeight;
          const ctx = canvas.getContext("2d");

          if (ctx) {
            ctx.drawImage(img, startX, startY, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            const contentBounds = getContentBounds(ctx, frameWidth, frameHeight);
            frames.push({
              dataUrl: canvas.toDataURL("image/png"),
              x: startX,
              y: startY,
              width: frameWidth,
              height: frameHeight,
              contentBounds,
            });
          }
        }
      }

      setJumpExtractedFrames(frames);
    };

    img.src = jumpBgRemovedUrl;
  }, [jumpBgRemovedUrl, jumpVerticalDividers, jumpHorizontalDividers]);

  const extractAttackFrames = useCallback(async () => {
    if (!attackBgRemovedUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const frames: Frame[] = [];
      const colPositions = [0, ...attackVerticalDividers, 100];
      const rowPositions = [0, ...attackHorizontalDividers, 100];

      for (let row = 0; row < rowPositions.length - 1; row++) {
        const startY = Math.round((rowPositions[row] / 100) * img.height);
        const endY = Math.round((rowPositions[row + 1] / 100) * img.height);
        const frameHeight = endY - startY;

        for (let col = 0; col < colPositions.length - 1; col++) {
          const startX = Math.round((colPositions[col] / 100) * img.width);
          const endX = Math.round((colPositions[col + 1] / 100) * img.width);
          const frameWidth = endX - startX;

          const canvas = document.createElement("canvas");
          canvas.width = frameWidth;
          canvas.height = frameHeight;
          const ctx = canvas.getContext("2d");

          if (ctx) {
            ctx.drawImage(img, startX, startY, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            const contentBounds = getContentBounds(ctx, frameWidth, frameHeight);
            frames.push({
              dataUrl: canvas.toDataURL("image/png"),
              x: startX,
              y: startY,
              width: frameWidth,
              height: frameHeight,
              contentBounds,
            });
          }
        }
      }

      setAttackExtractedFrames(frames);
    };

    img.src = attackBgRemovedUrl;
  }, [attackBgRemovedUrl, attackVerticalDividers, attackHorizontalDividers]);

  const extractIdleFrames = useCallback(async () => {
    if (!idleBgRemovedUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const frames: Frame[] = [];
      const colPositions = [0, ...idleVerticalDividers, 100];
      const rowPositions = [0, ...idleHorizontalDividers, 100];

      for (let row = 0; row < rowPositions.length - 1; row++) {
        const startY = Math.round((rowPositions[row] / 100) * img.height);
        const endY = Math.round((rowPositions[row + 1] / 100) * img.height);
        const frameHeight = endY - startY;

        for (let col = 0; col < colPositions.length - 1; col++) {
          const startX = Math.round((colPositions[col] / 100) * img.width);
          const endX = Math.round((colPositions[col + 1] / 100) * img.width);
          const frameWidth = endX - startX;

          const canvas = document.createElement("canvas");
          canvas.width = frameWidth;
          canvas.height = frameHeight;
          const ctx = canvas.getContext("2d");

          if (ctx) {
            ctx.drawImage(img, startX, startY, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            const contentBounds = getContentBounds(ctx, frameWidth, frameHeight);
            frames.push({
              dataUrl: canvas.toDataURL("image/png"),
              x: startX,
              y: startY,
              width: frameWidth,
              height: frameHeight,
              contentBounds,
            });
          }
        }
      }

      setIdleExtractedFrames(frames);
    };

    img.src = idleBgRemovedUrl;
  }, [idleBgRemovedUrl, idleVerticalDividers, idleHorizontalDividers]);

  // Walk vertical divider drag handling
  const handleWalkVerticalDividerDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const imgRect = walkSpriteSheetRef.current?.getBoundingClientRect();
    if (!imgRect) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const relativeX = moveEvent.clientX - imgRect.left;
      const percentage = Math.max(0, Math.min(100, (relativeX / imgRect.width) * 100));

      const newPositions = [...walkVerticalDividers];
      const minPos = index > 0 ? newPositions[index - 1] + 2 : 2;
      const maxPos = index < newPositions.length - 1 ? newPositions[index + 1] - 2 : 98;
      newPositions[index] = Math.max(minPos, Math.min(maxPos, percentage));
      setWalkVerticalDividers(newPositions);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Walk horizontal divider drag handling
  const handleWalkHorizontalDividerDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const imgRect = walkSpriteSheetRef.current?.getBoundingClientRect();
    if (!imgRect) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const relativeY = moveEvent.clientY - imgRect.top;
      const percentage = Math.max(0, Math.min(100, (relativeY / imgRect.height) * 100));

      const newPositions = [...walkHorizontalDividers];
      const minPos = index > 0 ? newPositions[index - 1] + 2 : 2;
      const maxPos = index < newPositions.length - 1 ? newPositions[index + 1] - 2 : 98;
      newPositions[index] = Math.max(minPos, Math.min(maxPos, percentage));
      setWalkHorizontalDividers(newPositions);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Jump vertical divider drag handling
  const handleJumpVerticalDividerDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const imgRect = jumpSpriteSheetRef.current?.getBoundingClientRect();
    if (!imgRect) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const relativeX = moveEvent.clientX - imgRect.left;
      const percentage = Math.max(0, Math.min(100, (relativeX / imgRect.width) * 100));

      const newPositions = [...jumpVerticalDividers];
      const minPos = index > 0 ? newPositions[index - 1] + 2 : 2;
      const maxPos = index < newPositions.length - 1 ? newPositions[index + 1] - 2 : 98;
      newPositions[index] = Math.max(minPos, Math.min(maxPos, percentage));
      setJumpVerticalDividers(newPositions);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Jump horizontal divider drag handling
  const handleJumpHorizontalDividerDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const imgRect = jumpSpriteSheetRef.current?.getBoundingClientRect();
    if (!imgRect) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const relativeY = moveEvent.clientY - imgRect.top;
      const percentage = Math.max(0, Math.min(100, (relativeY / imgRect.height) * 100));

      const newPositions = [...jumpHorizontalDividers];
      const minPos = index > 0 ? newPositions[index - 1] + 2 : 2;
      const maxPos = index < newPositions.length - 1 ? newPositions[index + 1] - 2 : 98;
      newPositions[index] = Math.max(minPos, Math.min(maxPos, percentage));
      setJumpHorizontalDividers(newPositions);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Attack vertical divider drag handling
  const handleAttackVerticalDividerDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const imgRect = attackSpriteSheetRef.current?.getBoundingClientRect();
    if (!imgRect) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const relativeX = moveEvent.clientX - imgRect.left;
      const percentage = Math.max(0, Math.min(100, (relativeX / imgRect.width) * 100));

      const newPositions = [...attackVerticalDividers];
      const minPos = index > 0 ? newPositions[index - 1] + 2 : 2;
      const maxPos = index < newPositions.length - 1 ? newPositions[index + 1] - 2 : 98;
      newPositions[index] = Math.max(minPos, Math.min(maxPos, percentage));
      setAttackVerticalDividers(newPositions);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Attack horizontal divider drag handling
  const handleAttackHorizontalDividerDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const imgRect = attackSpriteSheetRef.current?.getBoundingClientRect();
    if (!imgRect) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const relativeY = moveEvent.clientY - imgRect.top;
      const percentage = Math.max(0, Math.min(100, (relativeY / imgRect.height) * 100));

      const newPositions = [...attackHorizontalDividers];
      const minPos = index > 0 ? newPositions[index - 1] + 2 : 2;
      const maxPos = index < newPositions.length - 1 ? newPositions[index + 1] - 2 : 98;
      newPositions[index] = Math.max(minPos, Math.min(maxPos, percentage));
      setAttackHorizontalDividers(newPositions);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Idle vertical divider drag handling
  const handleIdleVerticalDividerDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const imgRect = idleSpriteSheetRef.current?.getBoundingClientRect();
    if (!imgRect) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const relativeX = moveEvent.clientX - imgRect.left;
      const percentage = Math.max(0, Math.min(100, (relativeX / imgRect.width) * 100));

      const newPositions = [...idleVerticalDividers];
      const minPos = index > 0 ? newPositions[index - 1] + 2 : 2;
      const maxPos = index < newPositions.length - 1 ? newPositions[index + 1] - 2 : 98;
      newPositions[index] = Math.max(minPos, Math.min(maxPos, percentage));
      setIdleVerticalDividers(newPositions);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Idle horizontal divider drag handling
  const handleIdleHorizontalDividerDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const imgRect = idleSpriteSheetRef.current?.getBoundingClientRect();
    if (!imgRect) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const relativeY = moveEvent.clientY - imgRect.top;
      const percentage = Math.max(0, Math.min(100, (relativeY / imgRect.height) * 100));

      const newPositions = [...idleHorizontalDividers];
      const minPos = index > 0 ? newPositions[index - 1] + 2 : 2;
      const maxPos = index < newPositions.length - 1 ? newPositions[index + 1] - 2 : 98;
      newPositions[index] = Math.max(minPos, Math.min(maxPos, percentage));
      setIdleHorizontalDividers(newPositions);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Export functions
  const exportWalkSpriteSheet = () => {
    if (!walkBgRemovedUrl) return;
    const link = document.createElement("a");
    link.href = walkBgRemovedUrl;
    link.download = "walk-sprite-sheet.png";
    link.click();
  };

  const exportJumpSpriteSheet = () => {
    if (!jumpBgRemovedUrl) return;
    const link = document.createElement("a");
    link.href = jumpBgRemovedUrl;
    link.download = "jump-sprite-sheet.png";
    link.click();
  };

  const exportAttackSpriteSheet = () => {
    if (!attackBgRemovedUrl) return;
    const link = document.createElement("a");
    link.href = attackBgRemovedUrl;
    link.download = "attack-sprite-sheet.png";
    link.click();
  };

  const exportIdleSpriteSheet = () => {
    if (!idleBgRemovedUrl) return;
    const link = document.createElement("a");
    link.href = idleBgRemovedUrl;
    link.download = "idle-sprite-sheet.png";
    link.click();
  };

  const exportAllFrames = () => {
    walkExtractedFrames.forEach((frame, index) => {
      const link = document.createElement("a");
      link.href = frame.dataUrl;
      link.download = `walk-frame-${index + 1}.png`;
      link.click();
    });
    jumpExtractedFrames.forEach((frame, index) => {
      const link = document.createElement("a");
      link.href = frame.dataUrl;
      link.download = `jump-frame-${index + 1}.png`;
      link.click();
    });
    attackExtractedFrames.forEach((frame, index) => {
      const link = document.createElement("a");
      link.href = frame.dataUrl;
      link.download = `attack-frame-${index + 1}.png`;
      link.click();
    });
    idleExtractedFrames.forEach((frame, index) => {
      const link = document.createElement("a");
      link.href = frame.dataUrl;
      link.download = `idle-frame-${index + 1}.png`;
      link.click();
    });
  };

  const proceedToFrameExtraction = () => {
    setCompletedSteps((prev) => new Set([...prev, 3]));
    setCurrentStep(4);
  };

  const proceedToSandbox = () => {
    setCompletedSteps((prev) => new Set([...prev, 4, 5]));
    setCurrentStep(6);
  };

  const createCharacterCatalogSnapshot = (): CharacterCatalogSnapshot => ({
    gameMode,
    characterPrompt,
    characterImageUrl,
    spriteSheets: {
      walk: walkSpriteSheetUrl,
      jump: jumpSpriteSheetUrl,
      attack: attackSpriteSheetUrl,
      idle: idleSpriteSheetUrl,
    },
    backgroundRemoved: {
      walk: walkBgRemovedUrl,
      jump: jumpBgRemovedUrl,
      attack: attackBgRemovedUrl,
      idle: idleBgRemovedUrl,
    },
    isometric: {
      idle: isoIdleUrl,
      idleBackgroundRemoved: isoIdleBgUrl,
      attackDown: isoAttackDownUrl,
      attackUp: isoAttackUpUrl,
      attackSide: isoAttackSideUrl,
      attackDownBackgroundRemoved: isoAttackDownBgUrl,
      attackUpBackgroundRemoved: isoAttackUpBgUrl,
      attackSideBackgroundRemoved: isoAttackSideBgUrl,
    },
    grids: {
      walk: { cols: walkGridCols, rows: walkGridRows, vertical: walkVerticalDividers, horizontal: walkHorizontalDividers, dimensions: walkSpriteSheetDimensions },
      jump: { cols: jumpGridCols, rows: jumpGridRows, vertical: jumpVerticalDividers, horizontal: jumpHorizontalDividers, dimensions: jumpSpriteSheetDimensions },
      attack: { cols: attackGridCols, rows: attackGridRows, vertical: attackVerticalDividers, horizontal: attackHorizontalDividers, dimensions: attackSpriteSheetDimensions },
      idle: { cols: idleGridCols, rows: idleGridRows, vertical: idleVerticalDividers, horizontal: idleHorizontalDividers, dimensions: idleSpriteSheetDimensions },
    },
    sideScrollerScales,
    isometricScales,
    characterYOffset,
  });

  const createWorldCatalogSnapshot = (): WorldCatalogSnapshot => ({
    gameMode,
    character: createCharacterCatalogSnapshot(),
    backgroundMode,
    customBackgroundLayers,
    isometricMapUrl,
    customBgLayerOffsets,
    customBgLayerVisibility,
    isometricMapScale,
    characterYOffset,
  });

  const loadCatalog = async () => {
    setIsCatalogLoading(true);
    setCatalogNotice(null);
    try {
      const response = await fetch("/api/catalog", { cache: "no-store" });
      const data = (await response.json()) as CatalogResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load catalog");
      setCatalog({ characters: data.characters || [], worlds: data.worlds || [] });
    } catch (err) {
      setCatalogNotice(err instanceof Error ? err.message : "Could not load catalog");
    } finally {
      setIsCatalogLoading(false);
    }
  };

  const openCatalog = () => {
    setIsCatalogOpen(true);
    void loadCatalog();
  };

  const saveCurrentToCatalog = async (kind: CatalogKind) => {
    const hasWorld = Boolean(
      isometricMapUrl ||
      customBackgroundLayers.layer1Url ||
      customBackgroundLayers.layer2Url ||
      customBackgroundLayers.layer3Url
    );
    if (!characterImageUrl || (kind === "world" && !hasWorld)) return;

    const defaultName = kind === "character"
      ? characterPrompt.trim().slice(0, 60) || "Untitled character"
      : `${characterPrompt.trim().slice(0, 48) || "Untitled"} world`;
    const name = window.prompt(
      kind === "character" ? "Character name" : "World name",
      defaultName
    );
    if (!name?.trim()) return;

    setIsCatalogSaving(kind);
    setCatalogNotice(null);
    try {
      const snapshot = kind === "character"
        ? createCharacterCatalogSnapshot()
        : createWorldCatalogSnapshot();
      const thumbnailUrl = kind === "character"
        ? characterImageUrl
        : isometricMapUrl || customBackgroundLayers.layer2Url || customBackgroundLayers.layer1Url || characterImageUrl;
      const response = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: loadedCatalogIds[kind],
          kind,
          name,
          thumbnailUrl,
          snapshot,
        }),
      });
      const data = (await response.json()) as { entry?: CatalogEntry; error?: string };
      if (!response.ok || !data.entry) {
        throw new Error(data.error || "Could not save catalog entry");
      }
      setLoadedCatalogIds((prev) => ({ ...prev, [kind]: data.entry!.id }));
      setCatalogTab(kind);
      await loadCatalog();
      setCatalogNotice(`${kind === "character" ? "Character" : "World"} saved to project catalog.`);
    } catch (err) {
      setCatalogNotice(err instanceof Error ? err.message : "Could not save catalog entry");
    } finally {
      setIsCatalogSaving(null);
    }
  };

  const applyCharacterCatalogSnapshot = (raw: Partial<CharacterCatalogSnapshot>) => {
    const sprites = raw.spriteSheets || {} as CharacterCatalogSnapshot["spriteSheets"];
    const removed = raw.backgroundRemoved || {} as CharacterCatalogSnapshot["backgroundRemoved"];
    const iso = raw.isometric || {} as CharacterCatalogSnapshot["isometric"];
    const grids = raw.grids || {} as CharacterCatalogSnapshot["grids"];
    const safeUrl = (value: unknown) => typeof value === "string" ? value : null;
    const safeNumber = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? value : fallback;
    const safeNumbers = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
    const safeDimensions = (value: unknown) => {
      const dimensions = value && typeof value === "object" ? value as { width?: unknown; height?: unknown } : {};
      return {
        width: safeNumber(dimensions.width, 0),
        height: safeNumber(dimensions.height, 0),
      };
    };
    const grid = (key: keyof CharacterCatalogSnapshot["grids"]) => {
      const value = grids[key] || {} as CharacterCatalogSnapshot["grids"][typeof key];
      return {
        cols: Math.max(1, Math.round(safeNumber(value.cols, 2))),
        rows: Math.max(1, Math.round(safeNumber(value.rows, 2))),
        vertical: safeNumbers(value.vertical),
        horizontal: safeNumbers(value.horizontal),
        dimensions: safeDimensions(value.dimensions),
      };
    };
    const walkGrid = grid("walk");
    const jumpGrid = grid("jump");
    const attackGrid = grid("attack");
    const idleGrid = grid("idle");

    const nextCharacterUrl = safeUrl(raw.characterImageUrl);
    const nextWalk = safeUrl(sprites.walk);
    const nextJump = safeUrl(sprites.jump);
    const nextAttack = safeUrl(sprites.attack);
    const nextIdle = safeUrl(sprites.idle);
    const nextWalkRemoved = safeUrl(removed.walk);
    const nextJumpRemoved = safeUrl(removed.jump);
    const nextAttackRemoved = safeUrl(removed.attack);
    const nextIdleRemoved = safeUrl(removed.idle);

    setGameMode(raw.gameMode === "isometric" ? "isometric" : "side-scroller");
    setCharacterPrompt(typeof raw.characterPrompt === "string" ? raw.characterPrompt : "");
    setCharacterInputMode("text");
    setInputImageUrl("");
    setCharacterImageUrl(nextCharacterUrl);
    setWalkSpriteSheetUrl(nextWalk);
    setJumpSpriteSheetUrl(nextJump);
    setAttackSpriteSheetUrl(nextAttack);
    setIdleSpriteSheetUrl(nextIdle);
    setWalkBgRemovedUrl(nextWalkRemoved);
    setJumpBgRemovedUrl(nextJumpRemoved);
    setAttackBgRemovedUrl(nextAttackRemoved);
    setIdleBgRemovedUrl(nextIdleRemoved);
    setIsoIdleUrl(safeUrl(iso.idle));
    setIsoIdleBgUrl(safeUrl(iso.idleBackgroundRemoved));
    setIsoAttackDownUrl(safeUrl(iso.attackDown));
    setIsoAttackUpUrl(safeUrl(iso.attackUp));
    setIsoAttackSideUrl(safeUrl(iso.attackSide));
    setIsoAttackDownBgUrl(safeUrl(iso.attackDownBackgroundRemoved));
    setIsoAttackUpBgUrl(safeUrl(iso.attackUpBackgroundRemoved));
    setIsoAttackSideBgUrl(safeUrl(iso.attackSideBackgroundRemoved));
    setWalkGridCols(walkGrid.cols); setWalkGridRows(walkGrid.rows); setWalkSpriteSheetDimensions(walkGrid.dimensions);
    setJumpGridCols(jumpGrid.cols); setJumpGridRows(jumpGrid.rows); setJumpSpriteSheetDimensions(jumpGrid.dimensions);
    setAttackGridCols(attackGrid.cols); setAttackGridRows(attackGrid.rows); setAttackSpriteSheetDimensions(attackGrid.dimensions);
    setIdleGridCols(idleGrid.cols); setIdleGridRows(idleGrid.rows); setIdleSpriteSheetDimensions(idleGrid.dimensions);
    setSideScrollerScales({ ...DEFAULT_SIDE_SCROLLER_SCALES, ...(raw.sideScrollerScales || {}) });
    setIsometricScales({ ...DEFAULT_ISOMETRIC_SCALES, ...(raw.isometricScales || {}) });
    setCharacterYOffset(safeNumber(raw.characterYOffset, 0));
    setWalkExtractedFrames([]); setJumpExtractedFrames([]); setAttackExtractedFrames([]); setIdleExtractedFrames([]);
    setIsoIdleFrames([]); setIsoAttackDownFrames([]); setIsoAttackUpFrames([]); setIsoAttackSideFrames([]);

    // Grid initialization effects run after dimensions change, so restore custom dividers last.
    window.setTimeout(() => {
      setWalkVerticalDividers(walkGrid.vertical); setWalkHorizontalDividers(walkGrid.horizontal);
      setJumpVerticalDividers(jumpGrid.vertical); setJumpHorizontalDividers(jumpGrid.horizontal);
      setAttackVerticalDividers(attackGrid.vertical); setAttackHorizontalDividers(attackGrid.horizontal);
      setIdleVerticalDividers(idleGrid.vertical); setIdleHorizontalDividers(idleGrid.horizontal);
    }, 0);

    const hasSprites = Boolean(nextWalk || nextJump || nextAttack || nextIdle);
    const hasRemoved = Boolean(nextWalkRemoved || nextJumpRemoved || nextAttackRemoved || nextIdleRemoved);
    setCompletedSteps(new Set([
      ...(nextCharacterUrl ? [1] : []),
      ...(hasSprites ? [2] : []),
      ...(hasRemoved ? [3] : []),
    ]));
    setCurrentStep(hasRemoved ? 4 : hasSprites ? 2 : 1);
  };

  const restoreCatalogEntry = (entry: CatalogEntry) => {
    if (entry.kind === "character") {
      applyCharacterCatalogSnapshot(entry.snapshot as unknown as Partial<CharacterCatalogSnapshot>);
      setLoadedCatalogIds({ character: entry.id });
    } else {
      const world = entry.snapshot as unknown as Partial<WorldCatalogSnapshot>;
      applyCharacterCatalogSnapshot(world.character || {});
      const layers = world.customBackgroundLayers;
      setBackgroundMode(world.backgroundMode === "custom" ? "custom" : "default");
      setCustomBackgroundLayers({
        layer1Url: typeof layers?.layer1Url === "string" ? layers.layer1Url : null,
        layer2Url: typeof layers?.layer2Url === "string" ? layers.layer2Url : null,
        layer3Url: typeof layers?.layer3Url === "string" ? layers.layer3Url : null,
      });
      setIsometricMapUrl(typeof world.isometricMapUrl === "string" ? world.isometricMapUrl : null);
      if (Array.isArray(world.customBgLayerOffsets) && world.customBgLayerOffsets.length === 3) {
        setCustomBgLayerOffsets(world.customBgLayerOffsets);
      }
      if (Array.isArray(world.customBgLayerVisibility) && world.customBgLayerVisibility.length === 3) {
        setCustomBgLayerVisibility(world.customBgLayerVisibility);
      }
      if (typeof world.isometricMapScale === "number") setIsometricMapScale(world.isometricMapScale);
      if (typeof world.characterYOffset === "number") setCharacterYOffset(world.characterYOffset);
      setCompletedSteps(new Set([1, 2, 3, 4, 5, 6]));
      setCurrentStep(6);
      setLoadedCatalogIds({ world: entry.id });
    }
    setError(null);
    setIsCatalogOpen(false);
  };

  const removeCatalogEntry = async (entry: CatalogEntry) => {
    if (!window.confirm(`Delete “${entry.name}” from the catalog? Generated assets will remain in project storage.`)) return;
    setCatalogNotice(null);
    try {
      const response = await fetch(
        `/api/catalog?kind=${encodeURIComponent(entry.kind)}&id=${encodeURIComponent(entry.id)}`,
        { method: "DELETE" }
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not delete catalog entry");
      setLoadedCatalogIds((prev) => ({
        ...prev,
        [entry.kind]: prev[entry.kind] === entry.id ? undefined : prev[entry.kind],
      }));
      await loadCatalog();
      setCatalogNotice("Catalog entry deleted. Stored images were kept.");
    } catch (err) {
      setCatalogNotice(err instanceof Error ? err.message : "Could not delete catalog entry");
    }
  };

  return (
    <main className="container">
      <header className="header">
        <div className="header-logo">
          <AgentLogo size={36} />
          <h1>Sprite Sheet Creator</h1>
        </div>
        <p>Create pixel art sprite sheets with your VPS Codex Agent</p>
        <button className="btn btn-secondary catalog-open-button" onClick={openCatalog}>
          <span aria-hidden="true">▦</span> Project Catalog
        </button>
      </header>

      {isCatalogOpen && (
        <div className="catalog-overlay" role="presentation" onMouseDown={() => setIsCatalogOpen(false)}>
          <section
            className="catalog-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="catalog-header">
              <div>
                <h2 id="catalog-title">Project Catalog</h2>
                <p>Characters, sprite sheets, and worlds stored in the BRANDPASTE GitHub project.</p>
              </div>
              <button className="catalog-close" onClick={() => setIsCatalogOpen(false)} aria-label="Close catalog">×</button>
            </div>

            <div className="catalog-save-actions">
              <button
                className="btn btn-primary"
                disabled={!characterImageUrl || isCatalogSaving !== null}
                onClick={() => void saveCurrentToCatalog("character")}
              >
                {isCatalogSaving === "character" ? "Saving…" : loadedCatalogIds.character ? "Update Character" : "Save Current Character"}
              </button>
              <button
                className="btn btn-success"
                disabled={
                  !characterImageUrl ||
                  !(isometricMapUrl || customBackgroundLayers.layer1Url || customBackgroundLayers.layer2Url || customBackgroundLayers.layer3Url) ||
                  isCatalogSaving !== null
                }
                onClick={() => void saveCurrentToCatalog("world")}
              >
                {isCatalogSaving === "world" ? "Saving…" : loadedCatalogIds.world ? "Update World" : "Save Current World"}
              </button>
            </div>

            <div className="catalog-tabs" role="tablist" aria-label="Catalog type">
              <button
                role="tab"
                aria-selected={catalogTab === "character"}
                className={catalogTab === "character" ? "active" : ""}
                onClick={() => setCatalogTab("character")}
              >
                Characters <span>{catalog.characters.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={catalogTab === "world"}
                className={catalogTab === "world" ? "active" : ""}
                onClick={() => setCatalogTab("world")}
              >
                Worlds <span>{catalog.worlds.length}</span>
              </button>
            </div>

            {catalogNotice && <div className="catalog-notice">{catalogNotice}</div>}

            <div className="catalog-content">
              {isCatalogLoading ? (
                <div className="catalog-empty"><AgentSpinner size={38} /><span>Loading project catalog…</span></div>
              ) : (catalogTab === "character" ? catalog.characters : catalog.worlds).length === 0 ? (
                <div className="catalog-empty">
                  <span className="catalog-empty-icon">◇</span>
                  <strong>No {catalogTab === "character" ? "characters" : "worlds"} saved yet</strong>
                  <span>Generate one, then use the save button above.</span>
                </div>
              ) : (
                <div className="catalog-grid">
                  {(catalogTab === "character" ? catalog.characters : catalog.worlds).map((entry) => (
                    <article className="catalog-card" key={entry.id}>
                      <div className="catalog-thumbnail">
                        {entry.thumbnailUrl ? (
                          <img src={entry.thumbnailUrl} alt="" />
                        ) : (
                          <span>◇</span>
                        )}
                        {loadedCatalogIds[entry.kind] === entry.id && <span className="catalog-current">Current</span>}
                      </div>
                      <div className="catalog-card-body">
                        <strong title={entry.name}>{entry.name}</strong>
                        <span>{new Date(entry.updatedAt).toLocaleString()}</span>
                        <div className="catalog-card-actions">
                          <button className="btn btn-primary" onClick={() => restoreCatalogEntry(entry)}>Open</button>
                          <button className="btn btn-secondary catalog-delete" onClick={() => void removeCatalogEntry(entry)}>Delete</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Steps indicator */}
      <div className="steps-indicator">
        {[1, 2, 3, 4, 5].map((displayStep) => {
          // Map display step 5 to internal step 6 (sandbox)
          const internalStep = displayStep === 5 ? 6 : displayStep;
          return (
            <div
              key={displayStep}
              className={`step-dot ${currentStep === internalStep ? "active" : ""} ${
                completedSteps.has(internalStep) ? "completed" : ""
              }`}
              style={{ cursor: completedSteps.has(internalStep) || currentStep === internalStep ? "pointer" : "default" }}
              onClick={() => {
                if (completedSteps.has(internalStep) || currentStep === internalStep) {
                  setCurrentStep(internalStep as Step);
                }
              }}
            />
          );
        })}
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Step 1: Generate Character */}
      {currentStep === 1 && (
        <div className="step-container">
          <h2 className="step-title">
            <span className="step-number">1</span>
            Generate Character
          </h2>

          {/* Image model toggle — segmented control */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-tertiary)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Image Model</label>
            <div style={{ display: "inline-flex", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border-color)" }}>
              {([
                ["codex-agent", "VPS Codex Agent"],
              ] as const).map(([value, label], i) => (
                <button
                  key={value}
                  onClick={() => setImageModel(value)}
                  style={{
                    padding: "0.5rem 1.25rem",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    border: "none",
                    borderLeft: i === 0 ? "none" : "1px solid var(--border-color)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    background: imageModel === value ? "var(--fal-purple-deep)" : "var(--bg-secondary)",
                    color: imageModel === value ? "#fff" : "var(--text-secondary)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {imageModel === "gpt-image-2" && (
              <div style={{ marginTop: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-tertiary)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Quality</label>
                <select
                  value={gptImageQuality}
                  onChange={(e) => setGptImageQuality(e.target.value as GptImageQuality)}
                  style={{
                    padding: "0.5rem 2.25rem 0.5rem 0.75rem",
                    fontFamily: "inherit",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    cursor: "pointer",
                    minWidth: "160px",
                    outline: "none",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    background: "var(--bg-secondary) url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,255,255,0.6)' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") no-repeat right 0.85rem center",
                  }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            )}
          </div>

          {/* Game mode toggle — segmented control */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-tertiary)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Game Style</label>
            <div style={{ display: "inline-flex", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border-color)" }}>
              <button
                onClick={() => setGameMode("side-scroller")}
                style={{
                  padding: "0.5rem 1.25rem",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  background: gameMode === "side-scroller" ? "var(--accent-color)" : "var(--bg-secondary)",
                  color: gameMode === "side-scroller" ? "#fff" : "var(--text-secondary)",
                }}
              >
                Side-Scroller
              </button>
              <button
                onClick={() => setGameMode("isometric")}
                style={{
                  padding: "0.5rem 1.25rem",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  border: "none",
                  borderLeft: "1px solid var(--border-color)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  background: gameMode === "isometric" ? "var(--accent-color)" : "var(--bg-secondary)",
                  color: gameMode === "isometric" ? "#fff" : "var(--text-secondary)",
                }}
              >
                Isometric (RPG)
              </button>
            </div>
          </div>

          {/* Input mode tabs */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button
              className={`btn ${characterInputMode === "text" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCharacterInputMode("text")}
            >
              Text Prompt
            </button>
            <button
              className={`btn ${characterInputMode === "image" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCharacterInputMode("image")}
            >
              From Image
            </button>
          </div>

          {characterInputMode === "text" ? (
            <div className="input-group">
              <label htmlFor="prompt">Character Prompt</label>
              <textarea
                id="prompt"
                className="text-input"
                rows={3}
                spellCheck={false}
                placeholder="Describe your pixel art character (e.g., 'pixel art knight with sword and shield, medieval armor, 32-bit style')"
                value={characterPrompt}
                onChange={(e) => setCharacterPrompt(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="input-group">
                <label>Upload Image</label>
                {!inputImageUrl ? (
                  <label
                    htmlFor="imageUpload"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "2rem",
                      border: "2px dashed var(--border-color)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      transition: "border-color 0.2s, background 0.2s",
                      background: "var(--bg-secondary)",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = "var(--accent-color)";
                      e.currentTarget.style.background = "var(--bg-tertiary)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-color)";
                      e.currentTarget.style.background = "var(--bg-secondary)";
                    }}
                  >
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: "var(--text-tertiary)", marginBottom: "0.75rem" }}
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                      Click to upload an image
                    </span>
                    <span style={{ color: "var(--text-tertiary)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
                      PNG, JPG, WEBP supported
                    </span>
                    <input
                      id="imageUpload"
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            setInputImageUrl(event.target?.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      style={{ display: "none" }}
                    />
                  </label>
                ) : (
                  <div
                    style={{
                      position: "relative",
                      display: "inline-block",
                      padding: "1rem",
                      border: "2px solid var(--border-color)",
                      borderRadius: "8px",
                      background: "var(--bg-secondary)",
                    }}
                  >
                    <img
                      src={inputImageUrl}
                      alt="Uploaded preview"
                      style={{ maxWidth: "250px", maxHeight: "250px", borderRadius: "4px", display: "block" }}
                    />
                    <button
                      onClick={() => setInputImageUrl("")}
                      style={{
                        position: "absolute",
                        top: "0.5rem",
                        right: "0.5rem",
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        border: "none",
                        background: "var(--bg-primary)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1.2rem",
                        lineHeight: 1,
                      }}
                      title="Remove image"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
              <div className="input-group" style={{ marginTop: "1rem" }}>
                <label htmlFor="promptOptional">Additional Instructions (optional)</label>
                <textarea
                  id="promptOptional"
                  className="text-input"
                  rows={2}
                  spellCheck={false}
                  placeholder="Any additional instructions for the pixel art conversion..."
                  value={characterPrompt}
                  onChange={(e) => setCharacterPrompt(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="button-group">
            <button
              className="btn btn-primary"
              onClick={generateCharacter}
              disabled={
                isGeneratingCharacter ||
                (characterInputMode === "text" && !characterPrompt.trim()) ||
                (characterInputMode === "image" && !inputImageUrl.trim())
              }
            >
              {isGeneratingCharacter
                ? "Generating..."
                : characterInputMode === "image"
                ? "Convert to Pixel Art"
                : "Generate Character"}
            </button>
          </div>

          {isGeneratingCharacter && (
            <div className="loading">
              <AgentSpinner />
              <span className="loading-text">
                {characterInputMode === "image"
                  ? "Converting to pixel art..."
                  : "Generating your character..."}
              </span>
            </div>
          )}

          {characterImageUrl && (
            <>
              <div className="image-preview">
                <img src={characterImageUrl} alt="Generated character" />
              </div>

              <div className="button-group">
                <button
                  className="btn btn-secondary"
                  onClick={generateCharacter}
                  disabled={isGeneratingCharacter}
                >
                  Regenerate
                </button>
                <button
                  className="btn btn-success"
                  onClick={generateSpriteSheet}
                  disabled={isGeneratingSpriteSheet}
                >
                  {isGeneratingSpriteSheet ? "Creating Sprite Sheet..." : "Use for Sprite Sheet →"}
                </button>
              </div>

              {isGeneratingSpriteSheet && (
                <div className="loading">
                  <AgentSpinner />
                  <span className="loading-text">
                    {gameMode === "isometric"
                      ? "Creating walk & attack sprite sheets (this takes a moment)..."
                      : "Creating sprite sheets..."}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 2: Sprite Sheets Generated */}
      {currentStep === 2 && (
        <div className="step-container">
          <h2 className="step-title">
            <span className="step-number">2</span>
            Sprite Sheets Generated
          </h2>

          <p className="description-text">
            {gameMode === "isometric"
              ? "Directional walk & attack sprite sheets have been generated. If poses don't look right, try regenerating."
              : "Walk, jump, and attack sprite sheets have been generated. If poses don\u0027t look right, try regenerating."}
          </p>

          {gameMode === "isometric" ? (
            <>
              {/* Walk sheets */}
              <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Walk Sprites</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "0.5rem" }}>
                {(["walk", "jump", "attack"] as const).map((slot) => {
                  const url = slot === "walk" ? walkSpriteSheetUrl : slot === "jump" ? jumpSpriteSheetUrl : attackSpriteSheetUrl;
                  return (
                    <div key={slot}>
                      <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>{getSheetLabel(slot)}</h4>
                      {url && (
                        <div className="image-preview" style={{ margin: 0, opacity: regeneratingSpriteSheet === slot ? 0.5 : 1 }}>
                          <img src={url} alt={`${getSheetLabel(slot)} sprite sheet`} />
                        </div>
                      )}
                      <button
                        className="btn btn-secondary"
                        onClick={() => regenerateSpriteSheet(slot)}
                        disabled={isGeneratingSpriteSheet || regeneratingSpriteSheet !== null || isRemovingBg}
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.5rem", width: "100%" }}
                      >
                        {regeneratingSpriteSheet === slot ? "Regenerating..." : `Regen`}
                      </button>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-tertiary)", fontStyle: "italic", marginBottom: "1.25rem" }}>
                Walk Left is auto-flipped from Walk Right.
              </p>

              {/* Idle sheet */}
              <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Idle Sprite</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
                <div>
                  <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>Idle</h4>
                  {isoIdleUrl && (
                    <div className="image-preview" style={{ margin: 0, opacity: regeneratingSpriteSheet === "idle-iso" ? 0.5 : 1 }}>
                      <img src={isoIdleUrl} alt="Idle sprite sheet" />
                    </div>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      if (!characterImageUrl) return;
                      setRegeneratingSpriteSheet("idle-iso");
                      try {
                        const res = await fetch("/api/generate-sprite-sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterImageUrl, type: "idle-iso" }) });
                        const data = await readApiResponse(res);
                        if (!res.ok) throw new Error(data.error);
                        setIsoIdleUrl(data.imageUrl);
                      } catch (err) { setError(err instanceof Error ? err.message : "Failed to regenerate idle"); }
                      finally { setRegeneratingSpriteSheet(null); }
                    }}
                    disabled={isGeneratingSpriteSheet || regeneratingSpriteSheet !== null || isRemovingBg}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.5rem", width: "100%" }}
                  >
                    {regeneratingSpriteSheet === "idle-iso" ? "Regenerating..." : "Regen"}
                  </button>
                </div>
              </div>

              {/* Attack sheets */}
              <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Attack Sprites</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "0.5rem" }}>
                {(["attack-down", "attack-up", "attack-side"] as const).map((dir) => {
                  const url = dir === "attack-down" ? isoAttackDownUrl : dir === "attack-up" ? isoAttackUpUrl : isoAttackSideUrl;
                  const label = dir === "attack-down" ? "Attack Down" : dir === "attack-up" ? "Attack Up" : "Attack Side";
                  return (
                    <div key={dir}>
                      <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>{label}</h4>
                      {url && (
                        <div className="image-preview" style={{ margin: 0, opacity: regeneratingSpriteSheet === dir ? 0.5 : 1 }}>
                          <img src={url} alt={`${label} sprite sheet`} />
                        </div>
                      )}
                      <button
                        className="btn btn-secondary"
                        onClick={() => regenerateIsoAttack(dir)}
                        disabled={isGeneratingSpriteSheet || regeneratingSpriteSheet !== null || isRemovingBg}
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.5rem", width: "100%" }}
                      >
                        {regeneratingSpriteSheet === dir ? "Regenerating..." : `Regen`}
                      </button>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-tertiary)", fontStyle: "italic", marginBottom: "1rem" }}>
                Attack Left is auto-flipped from Attack Side.
              </p>
            </>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              {(["walk", "jump", "attack", "idle"] as const).map((slot) => (
                <div key={slot}>
                  <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                    {getSheetLabel(slot)} (4 frames)
                  </h4>
                  {(slot === "walk" ? walkSpriteSheetUrl : slot === "jump" ? jumpSpriteSheetUrl : slot === "attack" ? attackSpriteSheetUrl : idleSpriteSheetUrl) && (
                    <div className="image-preview" style={{ margin: 0, opacity: regeneratingSpriteSheet === slot ? 0.5 : 1 }}>
                      <img
                        src={(slot === "walk" ? walkSpriteSheetUrl : slot === "jump" ? jumpSpriteSheetUrl : slot === "attack" ? attackSpriteSheetUrl : idleSpriteSheetUrl)!}
                        alt={`${getSheetLabel(slot)} sprite sheet`}
                      />
                    </div>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={() => regenerateSpriteSheet(slot)}
                    disabled={isGeneratingSpriteSheet || regeneratingSpriteSheet !== null || isRemovingBg}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.5rem", width: "100%" }}
                  >
                    {regeneratingSpriteSheet === slot ? "Regenerating..." : `Regen ${getSheetLabel(slot)}`}
                  </button>
                </div>
              ))}
            </div>
          )}

          {(isGeneratingSpriteSheet || regeneratingSpriteSheet) && (
            <div className="loading">
              <AgentSpinner />
              <span className="loading-text">
                {isGeneratingSpriteSheet ? "Regenerating all sprite sheets..." : `Regenerating ${regeneratingSpriteSheet} sprite sheet...`}
              </span>
            </div>
          )}

          <div className="button-group">
            <button className="btn btn-secondary" onClick={() => setCurrentStep(1)}>
              ← Back to Character
            </button>
            <button
              className="btn btn-secondary"
              onClick={generateSpriteSheet}
              disabled={isGeneratingSpriteSheet || isRemovingBg}
            >
              Regenerate All
            </button>
            <button
              className="btn btn-success"
              onClick={removeBackground}
              disabled={isRemovingBg || isGeneratingSpriteSheet || !walkSpriteSheetUrl || !jumpSpriteSheetUrl || !attackSpriteSheetUrl || (gameMode === "isometric" && (!isoAttackDownUrl || !isoAttackUpUrl || !isoAttackSideUrl || !isoIdleUrl))}
            >
              {isRemovingBg ? "Removing Backgrounds..." : "Remove Backgrounds →"}
            </button>
          </div>

          {isRemovingBg && (
            <div className="loading">
              <AgentSpinner />
              <span className="loading-text">Removing backgrounds from all sheets...</span>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Background Removed */}
      {currentStep === 3 && (
        <div className="step-container">
          <h2 className="step-title">
            <span className="step-number">3</span>
            Backgrounds Removed
          </h2>

          <p className="description-text">
            Backgrounds have been removed. Now let&apos;s extract the individual frames.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            {(["walk", "jump", "attack", ...(gameMode === "isometric" ? [] : ["idle"])] as ("walk" | "jump" | "attack" | "idle")[]).map((slot) => {
              const url = slot === "walk" ? walkBgRemovedUrl : slot === "jump" ? jumpBgRemovedUrl : slot === "attack" ? attackBgRemovedUrl : idleBgRemovedUrl;
              return (
                <div key={slot}>
                  <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>{getSheetLabel(slot)}</h4>
                  {url && (
                    <div className="image-preview" style={{ margin: 0 }}>
                      <img src={url} alt={`${getSheetLabel(slot)} sprite sheet with background removed`} />
                    </div>
                  )}
                </div>
              );
            })}
            {gameMode === "isometric" && ([
              { label: "Attack Down", url: isoAttackDownBgUrl },
              { label: "Attack Up", url: isoAttackUpBgUrl },
              { label: "Attack Side", url: isoAttackSideBgUrl },
              { label: "Idle", url: isoIdleBgUrl },
            ]).map(({ label, url }) => (
              <div key={label}>
                <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>{label}</h4>
                {url && (
                  <div className="image-preview" style={{ margin: 0 }}>
                    <img src={url} alt={`${label} with background removed`} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="button-group">
            <button className="btn btn-secondary" onClick={() => setCurrentStep(2)}>
              ← Back
            </button>
            <button className="btn btn-success" onClick={proceedToFrameExtraction}>
              Extract Frames →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Frame Extraction */}
      {currentStep === 4 && (
        <div className="step-container">
          <h2 className="step-title">
            <span className="step-number">4</span>
            Extract Frames
          </h2>

          <p className="description-text">
            Drag the dividers to adjust frame boundaries. Purple = columns, pink = rows.
          </p>

          {/* Tab buttons */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            {(["walk", "jump", "attack", ...(gameMode === "isometric" ? [] : ["idle"])] as ("walk" | "jump" | "attack" | "idle")[]).map((slot) => (
              <button
                key={slot}
                className={`btn ${activeSheet === slot ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveSheet(slot)}
              >
                {getSheetLabel(slot)}
              </button>
            ))}
          </div>

          {/* Walk frame extraction */}
          {activeSheet === "walk" && (
            <>
              <div className="frame-controls">
                <label htmlFor="walkGridCols">Columns:</label>
                <input
                  id="walkGridCols"
                  type="number"
                  className="frame-count-input"
                  min={1}
                  max={8}
                  value={walkGridCols}
                  onChange={(e) => setWalkGridCols(Math.max(1, Math.min(8, parseInt(e.target.value) || 3)))}
                />
                <label htmlFor="walkGridRows" style={{ marginLeft: "1rem" }}>Rows:</label>
                <input
                  id="walkGridRows"
                  type="number"
                  className="frame-count-input"
                  min={1}
                  max={8}
                  value={walkGridRows}
                  onChange={(e) => setWalkGridRows(Math.max(1, Math.min(8, parseInt(e.target.value) || 2)))}
                />
                <span style={{ marginLeft: "1rem", color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
                  ({walkGridCols * walkGridRows} frames)
                </span>
              </div>

              {walkBgRemovedUrl && (
                <div className="frame-extractor" ref={containerRef}>
                  <div className="sprite-sheet-container">
                    <img
                      ref={walkSpriteSheetRef}
                      src={walkBgRemovedUrl}
                      alt="Walk sprite sheet"
                      onLoad={(e) => {
                        const img = e.target as HTMLImageElement;
                        setWalkSpriteSheetDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                      }}
                    />
                    <div className="divider-overlay">
                      {walkVerticalDividers.map((pos, index) => (
                        <div
                          key={`wv-${index}`}
                          className="divider-line divider-vertical"
                          style={{ left: `${pos}%` }}
                          onMouseDown={(e) => handleWalkVerticalDividerDrag(index, e)}
                        />
                      ))}
                      {walkHorizontalDividers.map((pos, index) => (
                        <div
                          key={`wh-${index}`}
                          className="divider-line divider-horizontal"
                          style={{ top: `${pos}%` }}
                          onMouseDown={(e) => handleWalkHorizontalDividerDrag(index, e)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {walkExtractedFrames.length > 0 && (
                <div className="frames-preview">
                  {walkExtractedFrames.map((frame, index) => (
                    <div key={index} className="frame-thumb">
                      <img src={frame.dataUrl} alt={`Walk frame ${index + 1}`} />
                      <div className="frame-label">{getSheetLabel("walk")} {index + 1}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Jump frame extraction */}
          {activeSheet === "jump" && (
            <>
              <div className="frame-controls">
                <label htmlFor="jumpGridCols">Columns:</label>
                <input
                  id="jumpGridCols"
                  type="number"
                  className="frame-count-input"
                  min={1}
                  max={8}
                  value={jumpGridCols}
                  onChange={(e) => setJumpGridCols(Math.max(1, Math.min(8, parseInt(e.target.value) || 2)))}
                />
                <label htmlFor="jumpGridRows" style={{ marginLeft: "1rem" }}>Rows:</label>
                <input
                  id="jumpGridRows"
                  type="number"
                  className="frame-count-input"
                  min={1}
                  max={8}
                  value={jumpGridRows}
                  onChange={(e) => setJumpGridRows(Math.max(1, Math.min(8, parseInt(e.target.value) || 2)))}
                />
                <span style={{ marginLeft: "1rem", color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
                  ({jumpGridCols * jumpGridRows} frames)
                </span>
              </div>

              {jumpBgRemovedUrl && (
                <div className="frame-extractor">
                  <div className="sprite-sheet-container">
                    <img
                      ref={jumpSpriteSheetRef}
                      src={jumpBgRemovedUrl}
                      alt="Jump sprite sheet"
                      onLoad={(e) => {
                        const img = e.target as HTMLImageElement;
                        setJumpSpriteSheetDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                      }}
                    />
                    <div className="divider-overlay">
                      {jumpVerticalDividers.map((pos, index) => (
                        <div
                          key={`jv-${index}`}
                          className="divider-line divider-vertical"
                          style={{ left: `${pos}%` }}
                          onMouseDown={(e) => handleJumpVerticalDividerDrag(index, e)}
                        />
                      ))}
                      {jumpHorizontalDividers.map((pos, index) => (
                        <div
                          key={`jh-${index}`}
                          className="divider-line divider-horizontal"
                          style={{ top: `${pos}%` }}
                          onMouseDown={(e) => handleJumpHorizontalDividerDrag(index, e)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {jumpExtractedFrames.length > 0 && (
                <div className="frames-preview">
                  {jumpExtractedFrames.map((frame, index) => (
                    <div key={index} className="frame-thumb">
                      <img src={frame.dataUrl} alt={`Jump frame ${index + 1}`} />
                      <div className="frame-label">{getSheetLabel("jump")} {index + 1}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Attack frame extraction */}
          {activeSheet === "attack" && (
            <>
              <div className="frame-controls">
                <label htmlFor="attackGridCols">Columns:</label>
                <input
                  id="attackGridCols"
                  type="number"
                  className="frame-count-input"
                  min={1}
                  max={8}
                  value={attackGridCols}
                  onChange={(e) => setAttackGridCols(Math.max(1, Math.min(8, parseInt(e.target.value) || 2)))}
                />
                <label htmlFor="attackGridRows" style={{ marginLeft: "1rem" }}>Rows:</label>
                <input
                  id="attackGridRows"
                  type="number"
                  className="frame-count-input"
                  min={1}
                  max={8}
                  value={attackGridRows}
                  onChange={(e) => setAttackGridRows(Math.max(1, Math.min(8, parseInt(e.target.value) || 2)))}
                />
                <span style={{ marginLeft: "1rem", color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
                  ({attackGridCols * attackGridRows} frames)
                </span>
              </div>

              {attackBgRemovedUrl && (
                <div className="frame-extractor">
                  <div className="sprite-sheet-container">
                    <img
                      ref={attackSpriteSheetRef}
                      src={attackBgRemovedUrl}
                      alt="Attack sprite sheet"
                      onLoad={(e) => {
                        const img = e.target as HTMLImageElement;
                        setAttackSpriteSheetDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                      }}
                    />
                    <div className="divider-overlay">
                      {attackVerticalDividers.map((pos, index) => (
                        <div
                          key={`av-${index}`}
                          className="divider-line divider-vertical"
                          style={{ left: `${pos}%` }}
                          onMouseDown={(e) => handleAttackVerticalDividerDrag(index, e)}
                        />
                      ))}
                      {attackHorizontalDividers.map((pos, index) => (
                        <div
                          key={`ah-${index}`}
                          className="divider-line divider-horizontal"
                          style={{ top: `${pos}%` }}
                          onMouseDown={(e) => handleAttackHorizontalDividerDrag(index, e)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {attackExtractedFrames.length > 0 && (
                <div className="frames-preview">
                  {attackExtractedFrames.map((frame, index) => (
                    <div key={index} className="frame-thumb">
                      <img src={frame.dataUrl} alt={`Attack frame ${index + 1}`} />
                      <div className="frame-label">{getSheetLabel("attack")} {index + 1}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Idle frame extraction */}
          {activeSheet === "idle" && (
            <>
              <div className="frame-controls">
                <label htmlFor="idleGridCols">Columns:</label>
                <input
                  id="idleGridCols"
                  type="number"
                  className="frame-count-input"
                  min={1}
                  max={8}
                  value={idleGridCols}
                  onChange={(e) => setIdleGridCols(Math.max(1, Math.min(8, parseInt(e.target.value) || 2)))}
                />
                <label htmlFor="idleGridRows" style={{ marginLeft: "1rem" }}>Rows:</label>
                <input
                  id="idleGridRows"
                  type="number"
                  className="frame-count-input"
                  min={1}
                  max={8}
                  value={idleGridRows}
                  onChange={(e) => setIdleGridRows(Math.max(1, Math.min(8, parseInt(e.target.value) || 2)))}
                />
                <span style={{ marginLeft: "1rem", color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
                  ({idleGridCols * idleGridRows} frames)
                </span>
              </div>

              {idleBgRemovedUrl && (
                <div className="frame-extractor">
                  <div className="sprite-sheet-container">
                    <img
                      ref={idleSpriteSheetRef}
                      src={idleBgRemovedUrl}
                      alt="Idle sprite sheet"
                      onLoad={(e) => {
                        const img = e.target as HTMLImageElement;
                        setIdleSpriteSheetDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                      }}
                    />
                    <div className="divider-overlay">
                      {idleVerticalDividers.map((pos, index) => (
                        <div
                          key={`iv-${index}`}
                          className="divider-line divider-vertical"
                          style={{ left: `${pos}%` }}
                          onMouseDown={(e) => handleIdleVerticalDividerDrag(index, e)}
                        />
                      ))}
                      {idleHorizontalDividers.map((pos, index) => (
                        <div
                          key={`ih-${index}`}
                          className="divider-line divider-horizontal"
                          style={{ top: `${pos}%` }}
                          onMouseDown={(e) => handleIdleHorizontalDividerDrag(index, e)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {idleExtractedFrames.length > 0 && (
                <div className="frames-preview">
                  {idleExtractedFrames.map((frame, index) => (
                    <div key={index} className="frame-thumb">
                      <img src={frame.dataUrl} alt={`Idle frame ${index + 1}`} />
                      <div className="frame-label">{getSheetLabel("idle")} {index + 1}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="button-group">
            <button className="btn btn-secondary" onClick={() => setCurrentStep(3)}>
              ← Back
            </button>
            <button
              className="btn btn-success"
              onClick={proceedToSandbox}
              disabled={walkExtractedFrames.length === 0 || jumpExtractedFrames.length === 0 || attackExtractedFrames.length === 0 || idleExtractedFrames.length === 0}
            >
              Try in Sandbox →
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Animation Preview & Export */}
      {currentStep === 5 && (
        <div className="step-container">
          <h2 className="step-title">
            <span className="step-number">5</span>
            Preview & Export
          </h2>

          <p className="description-text">
            {gameMode === "isometric"
              ? "Walk animation preview. Test all directions in the sandbox!"
              : "Walk animation preview. Test both walk and jump in the sandbox!"}
          </p>

          <div className="animation-preview">
            <div className="animation-canvas-container">
              <canvas ref={canvasRef} className="animation-canvas" />
              <div className="direction-indicator">
                {direction === "right" ? "→ Walking Right" : "← Walking Left"}
              </div>
            </div>

            <div className="keyboard-hint">
              Hold <kbd>D</kbd> or <kbd>→</kbd> to walk right | Hold <kbd>A</kbd> or <kbd>←</kbd> to walk left | <kbd>Space</kbd> to stop
            </div>

            <div className="animation-controls">
              <button
                className={`btn ${isPlaying ? "btn-secondary" : "btn-primary"}`}
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? "Stop" : "Play"}
              </button>

              <div className="fps-control">
                <label>FPS: {fps}</label>
                <input
                  type="range"
                  className="fps-slider"
                  min={1}
                  max={24}
                  value={fps}
                  onChange={(e) => setFps(parseInt(e.target.value))}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", margin: "1rem 0" }}>
            {(["walk", "jump", "attack", ...(gameMode === "isometric" ? [] : ["idle"])] as ("walk" | "jump" | "attack" | "idle")[]).map((slot) => {
              const frames = slot === "walk" ? walkExtractedFrames : slot === "jump" ? jumpExtractedFrames : slot === "attack" ? attackExtractedFrames : idleExtractedFrames;
              return (
                <div key={slot}>
                  <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>{getSheetLabel(slot)} Frames</h4>
                  <div className="frames-preview" style={{ margin: 0, justifyContent: "flex-start" }}>
                    {frames.map((frame, index) => (
                      <div
                        key={index}
                        className={`frame-thumb ${slot === "walk" && currentFrameIndex === index ? "active" : ""}`}
                        onClick={slot === "walk" ? () => setCurrentFrameIndex(index) : undefined}
                      >
                        <img src={frame.dataUrl} alt={`${getSheetLabel(slot)} ${index + 1}`} />
                        <div className="frame-label">{index + 1}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {gameMode === "isometric" && ([
              { label: "Atk Down", frames: isoAttackDownFrames },
              { label: "Atk Up", frames: isoAttackUpFrames },
              { label: "Atk Side", frames: isoAttackSideFrames },
              { label: "Idle", frames: isoIdleFrames },
            ]).map(({ label, frames }) => (
              <div key={label}>
                <h4 style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>{label} Frames</h4>
                <div className="frames-preview" style={{ margin: 0, justifyContent: "flex-start" }}>
                  {frames.map((frame, index) => (
                    <div key={index} className="frame-thumb">
                      <img src={frame.dataUrl} alt={`${label} ${index + 1}`} />
                      <div className="frame-label">{index + 1}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="export-section">
            <h3 style={{ marginBottom: "0.75rem" }}>Export</h3>
            <div className="export-options">
              <button className="btn btn-primary" onClick={exportWalkSpriteSheet}>
                {getSheetLabel("walk")} Sheet
              </button>
              <button className="btn btn-primary" onClick={exportJumpSpriteSheet}>
                {getSheetLabel("jump")} Sheet
              </button>
              <button className="btn btn-primary" onClick={exportAttackSpriteSheet}>
                {getSheetLabel("attack")} Sheet
              </button>
              {gameMode !== "isometric" && (
                <button className="btn btn-primary" onClick={exportIdleSpriteSheet}>
                  {getSheetLabel("idle")} Sheet
                </button>
              )}
              <button className="btn btn-secondary" onClick={exportAllFrames}>
                All Frames
              </button>
            </div>
          </div>

          <div className="button-group" style={{ marginTop: "1.5rem" }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(4)}>
              ← Back to Frame Extraction
            </button>
            <button
              className="btn btn-success"
              onClick={() => {
                setCompletedSteps((prev) => new Set([...prev, 5]));
                setCurrentStep(6);
              }}
            >
              Try in Sandbox →
            </button>
          </div>
        </div>
      )}

      {/* Step 6: Sandbox */}
      {currentStep === 6 && (
        <div className="step-container">
          <h2 className="step-title">
            <span className="step-number">5</span>
            Sandbox
          </h2>

          <p className="description-text">
            {gameMode === "isometric"
              ? "Explore the world with your character! Use WASD or arrow keys to move in all directions."
              : "Walk, jump, and attack with your character! Use the keyboard to control movement."}
          </p>

          {/* Side-scroller background controls */}
          {gameMode === "side-scroller" && (
            <>
              {/* Background mode tabs */}
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <button
                  className={`btn ${backgroundMode === "default" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setBackgroundMode("default")}
                >
                  Default Background
                </button>
                <button
                  className={`btn ${backgroundMode === "custom" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setBackgroundMode("custom")}
                >
                  Custom Background
                </button>
              </div>

              {/* Custom background generation UI */}
              {backgroundMode === "custom" && (
                <div style={{ marginBottom: "1rem", padding: "1rem", background: "var(--bg-secondary)", borderRadius: "8px" }}>
                  {!customBackgroundLayers.layer1Url ? (
                    <>
                      <p style={{ marginBottom: "0.75rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                        Generate a custom parallax background that matches your character&apos;s world.
                      </p>
                      <button
                        className="btn btn-success"
                        onClick={generateBackground}
                        disabled={isGeneratingBackground}
                      >
                        {isGeneratingBackground ? "Generating Background..." : "Generate Custom Background"}
                      </button>
                      {isGeneratingBackground && (
                        <div className="loading" style={{ marginTop: "1rem" }}>
                          <AgentSpinner />
                          <span className="loading-text">Creating 3-layer parallax background (this may take a moment)...</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p style={{ marginBottom: "0.75rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                        Custom background generated! Click on a layer to regenerate just that one.
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.75rem" }}>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.25rem" }}>Layer 1 (Sky)</div>
                          <img src={customBackgroundLayers.layer1Url} alt="Background layer" style={{ width: "100%", borderRadius: "4px", opacity: regeneratingLayer === 1 ? 0.5 : customBgLayerVisibility[0] ? 1 : 0.3 }} />
                          <button
                            className="btn btn-secondary"
                            onClick={() => regenerateBackgroundLayer(1)}
                            disabled={isGeneratingBackground || regeneratingLayer !== null}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem", width: "100%" }}
                          >
                            {regeneratingLayer === 1 ? "..." : "Regen"}
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => toggleCustomBgLayer(0)}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem", width: "100%", opacity: customBgLayerVisibility[0] ? 1 : 0.6 }}
                          >
                            {customBgLayerVisibility[0] ? "Hide" : "Show"}
                          </button>
                        </div>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.25rem" }}>Layer 2 (Mid)</div>
                          <img src={customBackgroundLayers.layer2Url!} alt="Midground layer" style={{ width: "100%", borderRadius: "4px", background: "#333", opacity: regeneratingLayer === 2 ? 0.5 : customBgLayerVisibility[1] ? 1 : 0.3 }} />
                          <button
                            className="btn btn-secondary"
                            onClick={() => regenerateBackgroundLayer(2)}
                            disabled={isGeneratingBackground || regeneratingLayer !== null}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem", width: "100%" }}
                          >
                            {regeneratingLayer === 2 ? "..." : "Regen"}
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => toggleCustomBgLayer(1)}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem", width: "100%", opacity: customBgLayerVisibility[1] ? 1 : 0.6 }}
                          >
                            {customBgLayerVisibility[1] ? "Hide" : "Show"}
                          </button>
                        </div>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.25rem" }}>Layer 3 (Front)</div>
                          <img src={customBackgroundLayers.layer3Url!} alt="Foreground layer" style={{ width: "100%", borderRadius: "4px", background: "#333", opacity: regeneratingLayer === 3 ? 0.5 : customBgLayerVisibility[2] ? 1 : 0.3 }} />
                          <button
                            className="btn btn-secondary"
                            onClick={() => regenerateBackgroundLayer(3)}
                            disabled={isGeneratingBackground || regeneratingLayer !== null}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem", width: "100%" }}
                          >
                            {regeneratingLayer === 3 ? "..." : "Regen"}
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => toggleCustomBgLayer(2)}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem", width: "100%", opacity: customBgLayerVisibility[2] ? 1 : 0.6 }}
                          >
                            {customBgLayerVisibility[2] ? "Hide" : "Show"}
                          </button>
                        </div>
                      </div>
                      <button
                        className="btn btn-secondary"
                        onClick={generateBackground}
                        disabled={isGeneratingBackground || regeneratingLayer !== null}
                        style={{ fontSize: "0.85rem" }}
                      >
                        {isGeneratingBackground ? "Regenerating All..." : "Regenerate All Layers"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Isometric map controls */}
          {gameMode === "isometric" && (
            <div style={{ marginBottom: "1rem", padding: "1rem", background: "var(--bg-secondary)", borderRadius: "8px" }}>
              {!isometricMapUrl ? (
                <>
                  <p style={{ marginBottom: "0.75rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                    Generate an isometric world map for your character to explore.
                  </p>
                  <button
                    className="btn btn-success"
                    onClick={generateIsometricMap}
                    disabled={isGeneratingBackground}
                  >
                    {isGeneratingBackground ? "Generating Map..." : "Generate Isometric Map"}
                  </button>
                  {isGeneratingBackground && (
                    <div className="loading" style={{ marginTop: "1rem" }}>
                      <AgentSpinner />
                      <span className="loading-text">Creating isometric world map...</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p style={{ marginBottom: "0.75rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                    Isometric map generated! Your character can explore the world below.
                  </p>
                  <div style={{ marginBottom: "0.75rem" }}>
                    <img src={isometricMapUrl} alt="Isometric map" style={{ width: "100%", maxWidth: "400px", borderRadius: "4px", opacity: isGeneratingBackground ? 0.5 : 1 }} />
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={generateIsometricMap}
                    disabled={isGeneratingBackground}
                    style={{ fontSize: "0.85rem" }}
                  >
                    {isGeneratingBackground ? "Regenerating..." : "Regenerate Map"}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="sandbox-container">
            <Suspense fallback={
              <div className="loading">
                <AgentSpinner />
                <span className="loading-text">Loading sandbox...</span>
              </div>
            }>
              {gameMode === "isometric" ? (
                <IsometricSandbox
                  walkDownFrames={walkExtractedFrames}
                  walkUpFrames={jumpExtractedFrames}
                  walkLeftFrames={attackExtractedFrames}
                  walkRightFrames={idleExtractedFrames}
                  attackDownFrames={isoAttackDownFrames}
                  attackUpFrames={isoAttackUpFrames}
                  attackSideFrames={isoAttackSideFrames}
                  idleFrames={isoIdleFrames}
                  fps={fps}
                  mapUrl={isometricMapUrl}
                  spriteScales={isometricScales}
                  mapScale={isometricMapScale}
                />
              ) : (
                <PixiSandbox
                  walkFrames={walkExtractedFrames}
                  jumpFrames={jumpExtractedFrames}
                  attackFrames={attackExtractedFrames}
                  idleFrames={idleExtractedFrames}
                  fps={fps}
                  customBackgroundLayers={backgroundMode === "custom" ? customBackgroundLayers : undefined}
                  spriteScales={sideScrollerScales}
                  customBgLayerOffsets={customBgLayerOffsets}
                  characterYOffset={characterYOffset}
                  customBgLayerVisibility={customBgLayerVisibility}
                />
              )}
            </Suspense>
          </div>

          <div className="keyboard-hint" style={{ marginTop: "1rem" }}>
            {gameMode === "isometric" ? (
              <>
                <kbd>W</kbd>/<kbd>↑</kbd> up | <kbd>S</kbd>/<kbd>↓</kbd> down | <kbd>A</kbd>/<kbd>←</kbd> left | <kbd>D</kbd>/<kbd>→</kbd> right | <kbd>J</kbd> attack
              </>
            ) : (
              <>
                <kbd>A</kbd>/<kbd>←</kbd> walk left | <kbd>D</kbd>/<kbd>→</kbd> walk right | <kbd>W</kbd>/<kbd>↑</kbd> jump | <kbd>J</kbd> attack
              </>
            )}
          </div>

          <div className="animation-controls" style={{ marginTop: "1rem" }}>
            <div className="fps-control">
              <label>Animation Speed (FPS): {fps}</label>
              <input
                type="range"
                className="fps-slider"
                min={4}
                max={16}
                value={fps}
                onChange={(e) => setFps(parseInt(e.target.value))}
              />
            </div>
          </div>

          {/* Custom Background Layer Offsets (side-scroller only, when layers exist) */}
          {gameMode === "side-scroller" && backgroundMode === "custom" && customBackgroundLayers.layer1Url && (
            <div style={{
              marginTop: "1.5rem",
              padding: "1rem 1.25rem",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
            }}>
              <div style={{
                fontSize: "0.8rem",
                color: "var(--text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "0.75rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
                <span>Layer Positions</span>
                <button
                  onClick={() => setCustomBgLayerOffsets([0, 0, 0])}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-secondary)",
                    fontSize: "0.7rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "4px",
                    cursor: "pointer",
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  Reset
                </button>
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "0.75rem 1.25rem",
              }}>
                {([
                  ["Layer 1 (Sky)", 0],
                  ["Layer 2 (Mid)", 1],
                  ["Layer 3 (Front)", 2],
                ] as const).map(([label, idx]) => {
                  const value = customBgLayerOffsets[idx];
                  return (
                    <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        fontSize: "0.8rem",
                      }}>
                        <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                        <span style={{ color: "var(--text-tertiary)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                          {value > 0 ? `+${value}` : value} px
                        </span>
                      </div>
                      <input
                        type="range"
                        className="fps-slider"
                        style={{ width: "100%", accentColor: "var(--fal-purple-light)" }}
                        min={-200}
                        max={200}
                        step={1}
                        value={value}
                        onChange={(e) => {
                          const next = parseInt(e.target.value);
                          setCustomBgLayerOffsets((prev) => {
                            const copy = [...prev] as [number, number, number];
                            copy[idx] = next;
                            return copy;
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sprite Size controls */}
          <div style={{
            marginTop: "1.5rem",
            padding: "1rem 1.25rem",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
          }}>
            <div style={{
              fontSize: "0.8rem",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.75rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span>Sprite Sizes</span>
              <button
                onClick={() => {
                  if (gameMode === "isometric") {
                    setIsometricScales(DEFAULT_ISOMETRIC_SCALES);
                    setIsometricMapScale(1);
                  } else {
                    setSideScrollerScales(DEFAULT_SIDE_SCROLLER_SCALES);
                    setCharacterYOffset(0);
                  }
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-secondary)",
                  fontSize: "0.7rem",
                  padding: "0.2rem 0.5rem",
                  borderRadius: "4px",
                  cursor: "pointer",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                Reset
              </button>
            </div>
            {gameMode === "isometric" && (
              <div style={{
                marginBottom: "1rem",
                paddingBottom: "1rem",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  fontSize: "0.8rem",
                }}>
                  <span style={{ color: "var(--text-secondary)" }}>Map Size</span>
                  <span style={{ color: "var(--text-tertiary)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {isometricMapScale.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  className="fps-slider"
                  style={{ width: "100%", accentColor: "var(--fal-purple-light)" }}
                  min={0.5}
                  max={3}
                  step={0.05}
                  value={isometricMapScale}
                  onChange={(e) => setIsometricMapScale(parseFloat(e.target.value))}
                />
              </div>
            )}

            {gameMode === "side-scroller" && (
              <div style={{
                marginBottom: "1rem",
                paddingBottom: "1rem",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  fontSize: "0.8rem",
                }}>
                  <span style={{ color: "var(--text-secondary)" }}>Character Position</span>
                  <span style={{ color: "var(--text-tertiary)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {characterYOffset > 0 ? `+${characterYOffset}` : characterYOffset} px
                  </span>
                </div>
                <input
                  type="range"
                  className="fps-slider"
                  style={{ width: "100%", accentColor: "var(--fal-purple-light)" }}
                  min={-200}
                  max={200}
                  step={1}
                  value={characterYOffset}
                  onChange={(e) => setCharacterYOffset(parseInt(e.target.value))}
                />
              </div>
            )}

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.75rem 1.25rem",
            }}>
              {(gameMode === "side-scroller"
                ? ([
                    ["Walk", "walk"],
                    ["Jump", "jump"],
                    ["Attack", "attack"],
                    ["Idle", "idle"],
                  ] as const)
                : ([
                    ["Walk Down", "walkDown"],
                    ["Walk Up", "walkUp"],
                    ["Walk Side", "walkSide"],
                    ["Attack Down", "attackDown"],
                    ["Attack Up", "attackUp"],
                    ["Attack Side", "attackSide"],
                    ["Idle", "idle"],
                  ] as const)
              ).map(([label, key]) => {
                const value = gameMode === "side-scroller"
                  ? sideScrollerScales[key as keyof typeof sideScrollerScales]
                  : isometricScales[key as keyof typeof isometricScales];
                return (
                  <div key={key} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      fontSize: "0.8rem",
                    }}>
                      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                      <span style={{ color: "var(--text-tertiary)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                        {value.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      type="range"
                      className="fps-slider"
                      style={{ width: "100%", accentColor: "var(--fal-purple-light)" }}
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={value}
                      onChange={(e) => {
                        const next = parseFloat(e.target.value);
                        if (gameMode === "side-scroller") {
                          setSideScrollerScales((prev) => ({ ...prev, [key]: next }));
                        } else {
                          setIsometricScales((prev) => ({ ...prev, [key]: next }));
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="button-group" style={{ marginTop: "1.5rem" }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(4)}>
              ← Back to Frame Extraction
            </button>
            <button className="btn btn-secondary" onClick={() => {
              // Reset everything
              setCurrentStep(1);
              setCompletedSteps(new Set());
              setCharacterImageUrl(null);
              setWalkSpriteSheetUrl(null);
              setJumpSpriteSheetUrl(null);
              setAttackSpriteSheetUrl(null);
              setIdleSpriteSheetUrl(null);
              setWalkBgRemovedUrl(null);
              setJumpBgRemovedUrl(null);
              setAttackBgRemovedUrl(null);
              setIdleBgRemovedUrl(null);
              setWalkExtractedFrames([]);
              setJumpExtractedFrames([]);
              setAttackExtractedFrames([]);
              setIdleExtractedFrames([]);
              setCharacterPrompt("");
              setInputImageUrl("");
              setCharacterInputMode("text");
              setGameMode("side-scroller");
              setBackgroundMode("default");
              setCharacterYOffset(0);
              setCustomBackgroundLayers({ layer1Url: null, layer2Url: null, layer3Url: null });
              setCustomBgLayerVisibility([true, true, true]);
              setIsometricMapUrl(null);
              setIsoIdleUrl(null);
              setIsoIdleBgUrl(null);
              setIsoIdleFrames([]);
              setIsoAttackDownUrl(null);
              setIsoAttackUpUrl(null);
              setIsoAttackSideUrl(null);
              setIsoAttackDownBgUrl(null);
              setIsoAttackUpBgUrl(null);
              setIsoAttackSideBgUrl(null);
              setIsoAttackDownFrames([]);
              setIsoAttackUpFrames([]);
              setIsoAttackSideFrames([]);
            }}>
              Start New Sprite
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
