import { NextRequest, NextResponse } from "next/server";
import { getAttachmentSignedUrls } from "@/lib/encompass";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ loanId: string; attachmentId: string }> },
) {
  try {
    const { loanId, attachmentId } = await params;
    const { searchParams } = new URL(req.url);
    const pageParam = searchParams.get("page");

    // Get signed download URLs from Encompass V3
    const result = await getAttachmentSignedUrls(loanId, [attachmentId]);
    const att = result.attachments?.[0];

    if (!att) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 },
      );
    }

    // Prefer original file URL (PDF/native) when no specific page is requested
    const origUrls = att.originalUrls as string[] | undefined;
    let downloadUrl: string | undefined;
    let fallbackName = "attachment";

    if (!pageParam && origUrls?.length) {
      downloadUrl = origUrls[0];
      // Extract extension from the URL path (e.g. ...attachment-id.pdf)
      const urlPath = new URL(downloadUrl).pathname;
      const extMatch = urlPath.match(/\.(\w+)$/);
      fallbackName = extMatch ? `attachment.${extMatch[1]}` : "attachment.pdf";
    } else {
      // Serve a specific page image
      const pageIndex = parseInt(pageParam || "0");
      const page = att.pages?.[Math.min(pageIndex, (att.pages?.length || 1) - 1)];
      downloadUrl = page?.url;
      fallbackName = `attachment_page${pageIndex + 1}.png`;
    }

    if (!downloadUrl) {
      return NextResponse.json(
        { error: "No downloadable content found" },
        { status: 404 },
      );
    }

    // Proxy the actual file bytes from the signed streaming URL
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `Upstream download failed: ${fileRes.status}` },
        { status: 502 },
      );
    }

    const arrayBuf = await fileRes.arrayBuffer();
    const contentType =
      fileRes.headers.get("content-type") || "application/octet-stream";

    return new NextResponse(new Uint8Array(arrayBuf), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fallbackName}"`,
        "Content-Length": String(arrayBuf.byteLength),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
