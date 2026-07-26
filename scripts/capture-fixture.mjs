#!/usr/bin/env node
// Re-captures the committed Amsterdam demo-place fixture (public/fixtures/
// amsterdam/*.json) by POSTing the demo bbox/anchor to a locally running dev
// server, which does the real Overpass + AWS DEM fetches. Run:
//
//   npm run dev              # in one terminal (defaults to :3100 here)
//   npm run fixture:amsterdam
//
// Override the target with an env var or a positional argv:
//   FIXTURE_BASE_URL=http://localhost:4000 npm run fixture:amsterdam
//   node scripts/capture-fixture.mjs http://localhost:4000
//
// Plain Node script — NOT part of the app bundle (nothing under src/ imports
// it) and NOT part of the vitest suite (vitest.config.ts only globs
// src/**/*.test.ts).

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "fixtures", "amsterdam");

const BASE_URL =
  process.argv[2] ?? process.env.FIXTURE_BASE_URL ?? "http://localhost:3100";

// MUST match src/lib/geo/demoPlace.ts's DEMO_BBOX / DEMO_ANCHOR exactly — the
// committed fixture files are baked against this exact anchor. Changing
// either constant here without updating demoPlace.ts (or vice versa) and
// recapturing produces a fixture that is silently misaligned with the app's
// projection origin.
const BBOX = { west: 4.8952, south: 52.3643, east: 4.913, north: 52.3709 };
const ANCHOR = { lat0: 52.3676, lon0: 4.9041 };

const TARGETS = [
  { name: "terrain", endpoint: "/api/terrain", file: "terrain.json", key: "heightfield" },
  { name: "buildings", endpoint: "/api/buildings", file: "buildings.json", key: "buildings" },
  { name: "streets", endpoint: "/api/streets", file: "streets.json", key: "streets" },
];

// Overpass (buildings/streets) rate-limits hard — a handful of retries with a
// long cooldown rides out a transient 429/504 rather than failing the whole
// capture.
const RETRIES = 4;
const RETRY_DELAY_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetch one target, retrying on failure. Refuses to treat a non-200 or a
 * body missing the expected top-level key as success — never writes an error
 * body over the committed fixture. */
async function fetchWithRetry(target) {
  const url = `${BASE_URL}${target.endpoint}`;
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bbox: BBOX, anchor: ANCHOR }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !(target.key in json)) {
        const detail = json && typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
        throw new Error(detail);
      }
      return json;
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[${target.name}] attempt ${attempt}/${RETRIES} failed: ${message}`);
      if (attempt < RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function main() {
  console.log(`Capturing Amsterdam fixture from ${BASE_URL} for bbox`, BBOX);
  for (const target of TARGETS) {
    const json = await fetchWithRetry(target);
    const text = JSON.stringify(json);
    const outPath = path.join(OUT_DIR, target.file);
    await writeFile(outPath, text);
    const sizeKb = (Buffer.byteLength(text) / 1024).toFixed(0);
    const count =
      target.name === "terrain"
        ? `${json.heightfield.cols}×${json.heightfield.rows} cells`
        : `${json[target.key].length} ${target.name}${json.truncated ? " (truncated!)" : ""}`;
    console.log(`  wrote ${target.file}: ${sizeKb} KB, ${count}`);
  }
  console.log(
    "Done. If the area changed, update BBOX/ANCHOR here AND src/lib/geo/demoPlace.ts together, " +
      "and refresh public/fixtures/amsterdam/ATTRIBUTION.md's capture date.",
  );
}

main().catch((e) => {
  console.error("Fixture capture failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
