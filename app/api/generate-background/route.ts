import { NextRequest, NextResponse } from "next/server";
import {
  codexErrorDetails,
  removeBackgroundWithCodex,
} from "../../lib/codex-agent";
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
  layer1Url: string;
  layer2Url: string;
  layer3Url: string;
}

async function generateLayer(
  prompt: string,
  imageUrls: string[],
  aspectRatio: AspectRatio = "21:9"
): Promise<ImageResult> {
  return generateImage({ prompt, imageUrls, aspectRatio });
}

function validExistingLayers(value: unknown): value is ExistingLayers {
  if (!value || typeof value !== "object") return false;
  const layers = value as Partial<ExistingLayers>;
  return (
    typeof layers.layer1Url === "string" &&
    typeof layers.layer2Url === "string" &&
    typeof layers.layer3Url === "string"
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const {
      characterImageUrl,
      characterPrompt,
      worldPrompt,
      mode,
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

    if (regenerateLayer !== undefined) {
      if (
        (regenerateLayer !== 1 && regenerateLayer !== 2 && regenerateLayer !== 3) ||
        !validExistingLayers(existingLayers)
      ) {
        return NextResponse.json(
          { error: "A valid layer number and all existing layers are required" },
          { status: 400 }
        );
      }

      if (regenerateLayer === 1) {
        const layer1 = await generateLayer(
          LAYER1_PROMPT(description),
          characterReferences
        );
        return NextResponse.json({
          layer1Url: layer1.url,
          layer2Url: existingLayers.layer2Url,
          layer3Url: existingLayers.layer3Url,
          width: layer1.width,
          height: layer1.height,
        });
      }

      if (regenerateLayer === 2) {
        const raw = await generateLayer(LAYER2_PROMPT(description), [
          ...characterReferences,
          existingLayers.layer1Url,
        ]);
        const layer2 = await removeBackgroundWithCodex(raw.url);
        return NextResponse.json({
          layer1Url: existingLayers.layer1Url,
          layer2Url: layer2.url,
          layer3Url: existingLayers.layer3Url,
          width: layer2.width,
          height: layer2.height,
        });
      }

      const raw = await generateLayer(LAYER3_PROMPT(description), [
        ...characterReferences,
        existingLayers.layer1Url,
        existingLayers.layer2Url,
      ]);
      const layer3 = await removeBackgroundWithCodex(raw.url);
      return NextResponse.json({
        layer1Url: existingLayers.layer1Url,
        layer2Url: existingLayers.layer2Url,
        layer3Url: layer3.url,
        width: layer3.width,
        height: layer3.height,
      });
    }

    const layer1 = await generateLayer(LAYER1_PROMPT(description), characterReferences);
    const layer2Raw = await generateLayer(LAYER2_PROMPT(description), [
      ...characterReferences,
      layer1.url,
    ]);
    const layer2 = await removeBackgroundWithCodex(layer2Raw.url);
    const layer3Raw = await generateLayer(LAYER3_PROMPT(description), [
      ...characterReferences,
      layer1.url,
      layer2.url,
    ]);
    const layer3 = await removeBackgroundWithCodex(layer3Raw.url);

    return NextResponse.json({
      layer1Url: layer1.url,
      layer2Url: layer2.url,
      layer3Url: layer3.url,
      width: layer1.width,
      height: layer1.height,
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
