import { NextRequest, NextResponse } from "next/server";
import { OpenTerrainProvider, parseTerrainRequest } from "@/lib/geo/terrainProvider";

export const runtime = "nodejs";

const provider = new OpenTerrainProvider();

export async function POST(req: NextRequest) {
  try {
    const parsed = parseTerrainRequest(await req.json());
    if (!parsed) {
      return NextResponse.json({ error: "Bad request: need { bbox, anchor }." }, { status: 400 });
    }
    const heightfield = await provider.fetchHeightfield(parsed.bbox, parsed.anchor);
    return NextResponse.json({ heightfield });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/terrain]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
