import { NextRequest, NextResponse } from "next/server";
import { getForUser, create, markAllRead } from "@/lib/notificationStore";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const notifs = await getForUser(userId);
  return NextResponse.json(notifs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const notif = await create(body);
  return NextResponse.json(notif, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { userId } = await req.json();
  await markAllRead(userId);
  return NextResponse.json({ ok: true });
}
