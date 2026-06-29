import { NextRequest, NextResponse } from "next/server";
import { getRegularization, upsertRegularization, updateRegularizationStatus } from "@/lib/firebaseService";
import { create } from "@/lib/notificationStore";

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET() {
  const docs = await getRegularization();
  return cors(NextResponse.json(docs.map((d) => ({
    id:            d.id,
    empId:         d.empId,
    empName:       d.empName,
    date:          d.date,
    day:           d.day,
    reason:        d.reason,
    actualArrival: d.actualArrival,
    status:        d.status,
    hrComment:     d.hrComment,
  }))));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const existing = (await getRegularization()).find((d) => d.id === body.id);
  const isNew = !existing;

  await upsertRegularization(body.id, {
    empId:         body.empId,
    empName:       body.empName,
    date:          body.date,
    day:           body.day,
    reason:        body.reason,
    actualArrival: body.actualArrival,
    status:        body.status ?? "Pending",
    hrComment:     body.hrComment ?? "",
  });

  if (isNew) {
    await create({
      userId: "HR",
      type: "attendance",
      title: `Attendance Correction — ${body.empName ?? "Employee"}`,
      message: `${body.empName ?? "An employee"} requested attendance correction for ${body.date}. Actual arrival: ${body.actualArrival}.`,
    });
  }
  return cors(NextResponse.json({ ok: true }));
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const allReg = await getRegularization();
  const rec = allReg.find((d) => d.id === body.id);

  await updateRegularizationStatus(body.id, body.status, body.hrComment ?? "");

  if (rec && (body.status === "Approved" || body.status === "Rejected")) {
    await create({
      userId: String(rec.empId ?? ""),
      type: "attendance",
      title: `Attendance Correction ${body.status}`,
      message: `Your attendance correction request for ${rec.date} has been ${body.status.toLowerCase()} by HR.${body.hrComment ? ` Comment: "${body.hrComment}"` : ""}`,
    });
  }
  return cors(NextResponse.json({ ok: true }));
}
