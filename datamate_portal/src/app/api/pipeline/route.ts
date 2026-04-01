import { NextRequest, NextResponse } from "next/server";
import { querySostenedores } from "@/lib/desafio-queries";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const page = parseInt(searchParams.get("page") || "0");
    const pageSize = parseInt(searchParams.get("pageSize") || "50");
    const search = searchParams.get("search") || undefined;
    const sortField = searchParams.get("sortField") || "nombre";
    const sortDir = (searchParams.get("sortDir") || "asc") as "asc" | "desc";
    const region = searchParams.get("region") || undefined;
    const dependencia = searchParams.get("dependencia") || undefined;
    const periodo = searchParams.get("periodo") || undefined;
    const subvencion = searchParams.get("subvencion") || undefined;

    const result = await querySostenedores({
      page, pageSize, search, sortField, sortDir,
      region, dependencia, periodo, subvencion,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
