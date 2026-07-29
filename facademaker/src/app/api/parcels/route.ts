import { NextRequest, NextResponse } from "next/server";
import {
  parseCadastralRequest,
  PdokCadastralParcelProvider,
} from "@/lib/geo/cadastralParcelProvider";

export const runtime = "nodejs";

const provider = new PdokCadastralParcelProvider();

export async function POST(req: NextRequest) {
  try {
    const parsed = parseCadastralRequest(await req.json());
    if ("error" in parsed) {
      const message =
        parsed.error === "span"
          ? "Area too large for parcels — zoom in to roughly 5 km across."
          : "Bad request: need { bbox, anchor } with a small, well-ordered bbox.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json(
      await provider.fetchParcels(parsed.bbox, parsed.anchor),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/parcels]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
