import { NextRequest, NextResponse } from "next/server";
import { OsmBuildingProvider, parseBuildingsRequest } from "@/lib/geo/buildingProvider";

export const runtime = "nodejs";

const provider = new OsmBuildingProvider();

export async function POST(req: NextRequest) {
  try {
    const parsed = parseBuildingsRequest(await req.json());
    if (!parsed) {
      return NextResponse.json(
        { error: "Bad request: need { bbox, anchor } with a small, well-ordered bbox." },
        { status: 400 },
      );
    }
    const result = await provider.fetchBuildings(parsed.bbox, parsed.anchor);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/buildings]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
