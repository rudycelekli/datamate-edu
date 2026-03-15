import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";

const DOCS_DIR = join(process.cwd(), "docs", "MIlo AI");
const CHUNKS_DIR = join(DOCS_DIR, ".chunks");

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "file parameter required" }, { status: 400 });
  }

  // Sanitize: only allow filenames, no path traversal
  const safe = basename(file);
  if (safe !== file || file.includes("..")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  // Check chunks dir first, then main docs dir
  const chunkPath = join(CHUNKS_DIR, safe);
  const mainPath = join(DOCS_DIR, safe);
  const filepath = existsSync(chunkPath) ? chunkPath : mainPath;

  if (!existsSync(filepath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const buf = readFileSync(filepath);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safe}"`,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}
