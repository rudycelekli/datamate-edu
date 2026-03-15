import { NextRequest, NextResponse } from "next/server";
import { getAttachmentSignedUrls } from "@/lib/encompass";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ loanId: string; attachmentId: string }> },
) {
  try {
    const { loanId, attachmentId } = await params;
    const result = await getAttachmentSignedUrls(loanId, [attachmentId]);
    const att = result.attachments?.[0];

    if (!att || !att.pages?.length) {
      return NextResponse.json(
        { error: "No pages found for this attachment" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      id: att.id,
      pages: att.pages.map((p) => p.url),
      thumbnails: att.pages.map((p) => p.thumbnail?.url).filter(Boolean),
      pageCount: att.pages.length,
      originalUrls: att.originalUrls ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get URLs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
