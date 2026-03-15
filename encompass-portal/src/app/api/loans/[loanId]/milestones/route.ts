import { NextRequest, NextResponse } from "next/server";
import { getMilestones } from "@/lib/encompass";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ loanId: string }> },
) {
  try {
    const { loanId } = await params;
    const milestones = await getMilestones(loanId);
    return NextResponse.json(milestones);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
