import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/encompass";

export async function GET() {
  try {
    const token = await getAccessToken();
    return NextResponse.json({
      success: true,
      tokenPrefix: token.slice(0, 8) + "...",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
