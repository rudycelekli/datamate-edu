import { NextRequest, NextResponse } from "next/server";
import { readFields } from "@/lib/encompass";
import { ALL_FIELD_IDS } from "@/lib/field-definitions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ loanId: string }> },
) {
  try {
    const { loanId } = await params;
    const data = await readFields(loanId, ALL_FIELD_IDS);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
