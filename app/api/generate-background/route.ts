import { NextRequest, NextResponse } from "next/server";
import { codexErrorDetails } from "../../lib/codex-agent";
import { AspectRatio, generateImage } from "../../lib/generate-image";

export const runtime = "nodejs";
export const maxDuration = 700;

const LAYER1_PROMPT = (worldPrompt: string) =>
  `Create the SKY/BACKDROP layer for a side-scrolling pixel art game parallax background.

World description: "${worldPrompt}"

Create an environment that fits this world. This is the FURTHEST layer: only sky and very distant elements such as distant mountains, clouds, and horizon.

Style: polished 32-bit retro pixel art with a cohesive visual language. Fill the entire wide panoramic canvas; this layer is fully opaque.`;

const LAYER2_PROMPT = (worldPrompt: string) => `Create the MIDDLE layer of a 3-layer parallax background for a side-scrolling pixel art game.

World description: "${worldPrompt}"
Reference images show the already-created layers and may optionally include a style character.

Create the world's iconic location: recognizable buildings, landmarks, trees, cliffs, or scenery. Elements should fill the frame from the middle down to the bottom while leaving clear open space above.

Style: polished pixel art matching the references.
BACKGROUND REMOVAL REQUIREMENT: Render all empty/background areas as one perfectly flat solid chroma-key magenta (#FF00FF). Do not use #FF00FF inside the actual artwork. Do not draw checkerboards, sky, or scenery in those empty areas.`;

const LAYER3_PROMPT = (worldPrompt: string) => `Create the FOREGROUND layer of a 3-layer parallax background for a side-scrolling pixel art game.

World description: "${worldPrompt}"
Reference images show the already-created layers and may optionally include a style character.

Draw only the closest foreground elements: a narrow strip of ground, grass, rocks, or platform edges along the BOTTOM 25-30% of the image. Do not redraw buildings or distant scenery.

Style: polished pixel art matching the references.
BACKGROUND REMOVAL REQUIREMENT: The TOP 70-75% and every empty area must be one perfectly flat solid chroma-key magenta (#FF00FF). Do not use #FF00FF inside the actual artwork. Do not draw a checkerboard.`;

const ISOMETRIC_MAP_PROMPT = (worldPrompt: string) =>
  `Create a large, detailed top-down isometric pixel art game world map.

World description: "${worldPrompt}"

Do not place any character on the map.

Style: classic RPG top-down map in a consistent 3/4 overhead perspective.

Include a cohesive world with winding paths, a small body of water, a few buildings fitting the character's world, rocky areas or hills, and varied terrain. This is one continuous explorable map, not a tileset. Fill the entire image with colorful, detailed 32-bit pixel art and leave no empty borders.`;

interface ImageResult {
  url: string;
  width: number;
  height: number;
}

interface ExistingLayers {
  layer1Url?: string;
  layer2Url?: string;
  layer3Url?: string;
}

async function generateLayer(
  prompt: string,
  imageUrls: string[],
  aspectRatio: AspectRatio = "21:9"
): Promise<ImageResult> {
  return generateImage({ prompt, imageUrls, aspectRatio });
}

function readExistingLayers(value: unknown): ExistingLayers {
  if (!value || typeof value !== "object") return {};
  const layers = value as Record<string, unknown>;
  return {
    layer1Url: typeof layers.layer1Url === "string" ? layers.layer1Url : undefined,
    layer2Url: typeof layers.layer2Url === "string" ? layers.layer2Url : undefined,
    layer3Url: typeof layers.layer3Url === "string" ? layers.layer3Url : undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const {
      characterImageUrl,
      characterPrompt,
      worldPrompt,
      mode,
      generateLayer: requestedGenerateLayer,
      regenerateLayer,
      existingLayers,
    } = body;

    const description = typeof worldPrompt === "string" && worldPrompt.trim()
      ? worldPrompt.trim()
      : typeof characterPrompt === "string" && characterPrompt.trim()
        ? characterPrompt.trim()
        : "";
    const characterReferences = typeof characterImageUrl === "string" && characterImageUrl
      ? [characterImageUrl]
      : [];

    if (!description) {
      return NextResponse.json(
        { error: "World description is required" },
        { status: 400 }
      );
    }

    if (mode === "isometric") {
      const map = await generateLayer(
        ISOMETRIC_MAP_PROMPT(description),
        characterReferences,
        "1:1"
      );
      return NextResponse.json({
        mapUrl: map.url,
        width: map.width,
        height: map.height,
      });
    }

    const requestedLayer = requestedGenerateLayer ?? regenerateLayer;
    if (requestedLayer !== 1 && requestedLayer !== 2 && requestedLayer !== 3) {
      return NextResponse.json(
        { error: "generateLayer must be 1, 2, or 3 for a side-scroller world" },
        { status: 400 }
      );
    }

    const layers = readExistingLayers(existingLayers);

    if (requestedLayer === 1) {
      const layer1 = await generateLayer(
        LAYER1_PROMPT(description),
        characterReferences
      );
      return NextResponse.json({
        layer1Url: layer1.url,
        width: layer1.width,
        height: layer1.height,
      });
    }

    if (!layers.layer1Url) {
      return NextResponse.json(
        { error: "Layer 1 is required before generating this layer" },
        { status: 400 }
      );
    }

    if (requestedLayer === 2) {
      const layer2 = await generateLayer(LAYER2_PROMPT(description), [
        ...characterReferences,
        layers.layer1Url,
      ]);
      return NextResponse.json({
        layer2Url: layer2.url,
        width: layer2.width,
        height: layer2.height,
        needsBackgroundRemoval: true,
      });
    }

    if (!layers.layer2Url) {
      return NextResponse.json(
        { error: "Layers 1 and 2 are required before generating layer 3" },
        { status: 400 }
      );
    }

    const layer3 = await generateLayer(LAYER3_PROMPT(description), [
      ...characterReferences,
      layers.layer1Url,
      layers.layer2Url,
    ]);
    return NextResponse.json({
      layer3Url: layer3.url,
      width: layer3.width,
      height: layer3.height,
      needsBackgroundRemoval: true,
    });
  } catch (error) {
    console.error("Error generating background layers with Codex Agent:", error);
    const details = codexErrorDetails(error);
    return NextResponse.json(
      {
        error: details.message,
        retryAfterSec: details.retryAfterSec,
        retryAt: details.retryAt,
      },
      {
        status: details.status,
        headers: details.retryAfterSec
          ? { "Retry-After": String(Math.ceil(details.retryAfterSec)) }
          : undefined,
      }
    );
  }
}
