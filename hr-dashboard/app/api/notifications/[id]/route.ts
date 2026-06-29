import { NextRequest, NextResponse } from "next/server";
import { markRead } from "@/lib/notificationStore";

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await markRead(id);
  return NextResponse.json({ ok });
}
