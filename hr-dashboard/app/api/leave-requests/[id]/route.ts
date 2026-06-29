import { NextRequest, NextResponse } from "next/server";
import { patch, getAll } from "@/lib/leaveStore";
import { create } from "@/lib/notificationStore";

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "PATCH,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const ok = await patch(id, body);
  if (!ok) return cors(NextResponse.json({ error: "Not found" }, { status: 404 }));

  const allLeaves = await getAll();
  const req2 = allLeaves.find((r) => r.id === id);
  if (req2 && body.status) {
    await create({
      userId: req2.empId,
      type: "leave",
      title: `Leave ${body.status} — ${req2.leaveType}`,
      message: `Your ${req2.leaveType} leave from ${req2.startDate} to ${req2.endDate} has been ${body.status.toLowerCase()} by HR.${body.hrComment ? ` Comment: "${body.hrComment}"` : ""}`,
    });
  }
  return cors(NextResponse.json({ ok: true }));
}
