import { NextRequest, NextResponse } from "next/server";
import { OsmBuildingProvider, parseBuildingsRequest } from "@/lib/geo/buildingProvider";

export const runtime = "nodejs";

const provider = new OsmBuildingProvider();

export async function POST(req: NextRequest) {
  try {
    const parsed = parseBuildingsRequest(await req.json());
    if ("error" in parsed) {
      const message =
        parsed.error === "span"
          ? "Area too large for buildings — zoom in to roughly 5 km across."
          : "Bad request: need { bbox, anchor } with a small, well-ordered bbox.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const result = await provider.fetchBuildings(parsed.bbox, parsed.anchor);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/buildings]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
