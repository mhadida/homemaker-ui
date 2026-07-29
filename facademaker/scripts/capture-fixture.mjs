#!/usr/bin/env node
// Captures one offline demo place by POSTing its bbox/anchor to a running
// Facademaker dev server, which performs the live Overpass + PDOK + AWS DEM
// fetches.
//
//   npm run dev
//   npm run fixture:utrecht
//
// Optional server override:
//   node scripts/capture-fixture.mjs utrecht http://127.0.0.1:4000
// Optional single layer:
//   node scripts/capture-fixture.mjs utrecht http://127.0.0.1:3000 parcels

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACES = {
  amsterdam: {
    bbox: { west: 4.8952, south: 52.3643, east: 4.913, north: 52.3709 },
    anchor: { lat0: 52.3676, lon0: 4.9041 },
  },
  utrecht: {
    bbox: { west: 5.1035, south: 52.0915, east: 5.1135, north: 52.0962 },
    anchor: { lat0: 52.09385, lon0: 5.1085 },
  },
};

const placeId = process.argv[2];
const place = PLACES[placeId];
if (!place) {
  console.error(`Choose a fixture: ${Object.keys(PLACES).join(" | ")}`);
  process.exit(1);
}

const baseUrl =
  process.argv[3] ?? process.env.FIXTURE_BASE_URL ?? "http://127.0.0.1:3000";
const onlyTarget = process.argv[4] ?? process.env.FIXTURE_ONLY;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(
  scriptDir,
  "..",
  "public",
  "fixtures",
  placeId,
);

const targets = [
  {
    name: "terrain",
    endpoint: "/api/terrain",
    file: "terrain.json",
    key: "heightfield",
  },
  {
    name: "buildings",
    endpoint: "/api/buildings",
    file: "buildings.json",
    key: "buildings",
  },
  {
    name: "parcels",
    endpoint: "/api/parcels",
    file: "parcels.json",
    key: "parcels",
  },
  {
    name: "streets",
    endpoint: "/api/streets",
    file: "streets.json",
    key: "streets",
  },
];

const retries = 4;
const retryDelayMs = 15_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(target) {
  const url = `${baseUrl}${target.endpoint}`;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(place),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json || !(target.key in json)) {
        const detail =
          json && typeof json.error === "string"
            ? json.error
            : `HTTP ${response.status}`;
        throw new Error(detail);
      }
      return json;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[${target.name}] attempt ${attempt}/${retries} failed: ${message}`,
      );
      if (attempt < retries) await sleep(retryDelayMs);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log(`Capturing ${placeId} from ${baseUrl} for bbox`, place.bbox);
  const selectedTargets = onlyTarget
    ? targets.filter((target) => target.name === onlyTarget)
    : targets;
  if (selectedTargets.length === 0)
    throw new Error(
      `Unknown fixture layer "${onlyTarget}". Choose: ${targets
        .map((target) => target.name)
        .join(" | ")}`,
    );
  for (const target of selectedTargets) {
    const json = await fetchWithRetry(target);
    const text = JSON.stringify(json);
    await writeFile(path.join(outDir, target.file), text);
    const sizeKb = (Buffer.byteLength(text) / 1024).toFixed(0);
    const count =
      target.name === "terrain"
        ? `${json.heightfield.cols}×${json.heightfield.rows} cells`
        : `${json[target.key].length} ${target.name}${
            json.truncated ? " (truncated!)" : ""
          }`;
    console.log(`  wrote ${target.file}: ${sizeKb} KB, ${count}`);
  }
}

main().catch((error) => {
  console.error(
    "Fixture capture failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
