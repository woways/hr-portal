import { NextRequest, NextResponse } from "next/server";
import { getByEmpId, patchClock } from "@/lib/clockStore";
import { upsertAttendance } from "@/lib/firebaseService";

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,PATCH,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

// GET /api/clock/:empId → today's record for that employee
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empId: string }> }) {
  const { empId } = await params;
  const rec = await getByEmpId(empId);
  return cors(NextResponse.json(rec ?? null));
}

// PATCH /api/clock/:empId → clock out  { date, clockOutTs, clockOutStr, totalSeconds }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ empId: string }> }) {
  const { empId } = await params;
  const body = await req.json();
  const ok = await patchClock(empId, body.date, {
    ...body,
    status: "clocked-out",
  });
  if (!ok) return cors(NextResponse.json({ error: "Record not found" }, { status: 404 }));

  // Mirror clock-out into attendance collection
  const secs = body.totalSeconds ?? 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const workingHours = secs > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : "-";
  await upsertAttendance(`${body.date}-${empId}`, {
    clockOut:     body.clockOutStr ?? "",
    workingHours,
    status:       "Present",
  });

  return cors(NextResponse.json({ ok: true }));
}
