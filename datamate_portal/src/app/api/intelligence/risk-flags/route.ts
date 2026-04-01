import { NextRequest, NextResponse } from "next/server";
import { getRiskFlags } from "@/lib/desafio-queries";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const result = await getRiskFlags({
      region: sp.get("region") || undefined,
      dependencia: sp.get("dependencia") || undefined,
      periodo: sp.get("periodo") || undefined,
      subvencion: sp.get("subvencion") || undefined,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
