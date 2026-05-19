import { NextRequest, NextResponse } from "next/server";
import { pyServer } from "@/lib/python-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BuildParams {
  footprint: [number, number][];
  storeys: number;
  storeyHeight: number;
  style: string;
  roof: string;
  ridgeHeight: number;
  rooms: { type: string; label: string }[];
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const params = (await req.json()) as BuildParams;

    if (!Array.isArray(params.footprint) || params.footprint.length < 3) {
      return NextResponse.json(
        { error: "footprint must have at least 3 points" },
        { status: 400 },
      );
    }

    const glb = await pyServer.generate(params);
    const ms = Date.now() - started;

    return new Response(new Uint8Array(glb), {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(glb.length),
        "X-Generation-Ms": String(ms),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/generate-building]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
