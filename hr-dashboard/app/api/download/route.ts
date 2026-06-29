import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url  = req.nextUrl.searchParams.get("url");
  const name = req.nextUrl.searchParams.get("name") || "document";

  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: "Upstream error" }, { status: res.status });

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("Content-Type") || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch file" }, { status: 500 });
  }
}
