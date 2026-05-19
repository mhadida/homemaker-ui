import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowed = new Set(["walls_only", "windows_only", "roofs_only"]);

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("f") || "walls_only";
  if (!allowed.has(name)) {
    return NextResponse.json({ error: "bad name" }, { status: 400 });
  }
  try {
    const buf = await readFile(`/tmp/${name}.glb`);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 404 });
  }
}
