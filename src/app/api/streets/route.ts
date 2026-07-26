import { NextRequest, NextResponse } from "next/server";
import { OsmStreetProvider, parseStreetsRequest } from "@/lib/geo/streetProvider";

export const runtime = "nodejs";

const provider = new OsmStreetProvider();

export async function POST(req: NextRequest) {
  try {
    const parsed = parseStreetsRequest(await req.json());
    if ("error" in parsed) {
      return NextResponse.json(
        {
          error:
            parsed.error === "span"
              ? "Area too large for streets — zoom in to roughly 5 km across."
              : "Bad request: need { bbox, anchor } with a small, well-ordered bbox.",
        },
        { status: 400 },
      );
    }
    const result = await provider.fetchStreets(parsed.bbox, parsed.anchor);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/streets]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
