import { NextRequest, NextResponse } from "next/server";
import { getAll, getByEmpId, upsert, LeaveRequest } from "@/lib/leaveStore";
import { create } from "@/lib/notificationStore";

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET(req: NextRequest) {
  const empId = req.nextUrl.searchParams.get("empId");
  const data = empId ? await getByEmpId(empId) : await getAll();
  return cors(NextResponse.json(data));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as LeaveRequest;
  if (!body.id || !body.empId || !body.empName) {
    return cors(NextResponse.json({ error: "id, empId, empName required" }, { status: 400 }));
  }
  await upsert(body);
  await create({
    userId: "HR",
    type: "leave",
    title: `Leave Request — ${body.empName}`,
    message: `${body.empName} applied for ${body.leaveType} leave from ${body.startDate} to ${body.endDate} (${body.days} day${body.days > 1 ? "s" : ""}).`,
  });
  return cors(NextResponse.json({ ok: true }));
}
