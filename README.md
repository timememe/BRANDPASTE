# Sprite Sheet Creator

Sprite sheet generator for 2D pixel-art characters, animations, parallax backgrounds, and isometric maps. Image generation and background processing run through a private VPS Codex Agent HTTP bridge.

## Features

- Catalog-first workspace for creating, reopening, and editing characters and worlds.
- Side-scroller/isometric tags and filters on characters, animation capabilities, and worlds.
- Generated sprite sheets belong to their character and can be added, edited, regenerated, or removed from its catalog card.
- A separate Animation Types catalog documents the reusable side-scroller and isometric motions that can be generated for compatible characters.
- The original character-to-sprite-to-background workflow remains available through the classic Creator button.
- Side-scroller and isometric RPG modes.
- Character generation from text or an uploaded reference image.
- Walk, jump, attack, and idle sprite sheets.
- Three-layer parallax backgrounds and isometric world maps.
- Persistent character and world catalog backed by the project GitHub repository.
- Codex-driven background removal with local pixel processing on the VPS.
- Frame extraction, animation preview, scale controls, and playable sandboxes.

## Architecture

The browser talks only to the Next.js API routes. Server-side code sends authenticated requests to the Codex bridge, copies each completed PNG to the `catalog-data` branch of this GitHub repository, and then removes the temporary VPS files:

```text
Browser -> Next.js API -> VPS Codex Agent /task
                         -> GitHub catalog-data/brandpaste-storage
Browser <- raw GitHub PNG + catalog metadata
```

The app opens on the catalog. Character snapshots contain their generated sprite-sheet URLs, grid settings, and editor state; world snapshots contain their character context plus parallax layers or the isometric map. The Animation Types section is a capability catalog rather than a list of generated PNGs. Older catalog JSON is normalized on read, so entries created before mode and animation metadata were introduced remain usable.

The service tokens are read only by server-side modules. They must never use a `NEXT_PUBLIC_*` environment variable or be embedded in client code.

Codex temporarily writes each PNG plus a JSON manifest and base64 chunks in `/workspace/sprite-sheet-creator-vps`. The server verifies the chunks, commits the PNG under `brandpaste-storage/assets/`, and deletes the temporary output. Catalog snapshots live under `brandpaste-storage/catalog/` in the same data branch. Application code remains on `main`.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Copy `.dev.vars.example` to `.dev.vars` and configure the server-only bridge values. Do not put the service token in a Next.js `.env*` file: OpenNext serializes those files into its build output. `.dev.vars` is loaded as a local Wrangler binding and is excluded from production bundles:

```dotenv
NEXTJS_ENV=development
CODEX_AGENT_BASE_URL=https://agent.worldorder.online
CODEX_AGENT_SERVICE_TOKEN=replace_with_service_token
CODEX_AGENT_CWD=/workspace/sprite-sheet-creator-vps
CODEX_AGENT_REPO=sprite-sheet-creator-vps
CODEX_AGENT_TIMEOUT_MS=650000
CODEX_AGENT_MAX_RETRIES=2
GITHUB_STORAGE_TOKEN=replace_with_fine_grained_token
GITHUB_STORAGE_OWNER=timememe
GITHUB_STORAGE_REPO=BRANDPASTE
GITHUB_STORAGE_BRANCH=catalog-data
GITHUB_STORAGE_PREFIX=brandpaste-storage
```

The timeout is intentionally at least 650 seconds because `/task` is synchronous. HTTP 429 responses use `retryAfterSec` or `retryAt` and are retried automatically.

Because the bridge hostname is proxied by Cloudflare, an individual `/task` request can receive HTTP 524 before Codex reaches the bridge's 10-minute limit. The server does not restart the task in that case: it polls the known output manifest through the repository API until completion, then continues the normal GitHub copy and VPS cleanup flow.

3. Start the app:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000).

## Cloudflare Workers deployment

The production deployment uses the OpenNext adapter and the dedicated Worker name `sprite-sheet-creator-codex` from `wrangler.jsonc`.

Build the Workers bundle locally:

```bash
npm run build:cloudflare
```

Store both credentials as Cloudflare Worker secrets, never as plain Wrangler variables. The GitHub token needs repository `Contents: Read and write` permission:

```bash
npx wrangler secret put CODEX_AGENT_SERVICE_TOKEN
npx wrangler secret put GITHUB_STORAGE_TOKEN
```

Deploy through OpenNext/Wrangler:

```bash
npm run deploy:cloudflare
```

The remaining bridge and catalog settings are non-secret runtime variables declared in `wrangler.jsonc`.

## Controls

- Side-scroller: `A`/`D` move, `W` jumps, `J` attacks.
- Isometric: `W`/`A`/`S`/`D` move, `J` attacks.
- Animation preview: `A`/`D` move and `Space` stops.

## Tech Stack

- Next.js 15
- React 18
- VPS Codex Agent HTTP bridge
- Sharp on the VPS for deterministic PNG processing
- PixiJS and HTML Canvas
