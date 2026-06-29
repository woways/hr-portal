import { NextRequest, NextResponse } from "next/server";
import { getAll, getByEmpId, upsert, ClockRecord } from "@/lib/clockStore";
import { upsertAttendance, getEmployeeById } from "@/lib/firebaseService";

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

// GET /api/clock          → all records for today
// GET /api/clock?empId=x  → specific employee today
export async function GET(req: NextRequest) {
  const empId = req.nextUrl.searchParams.get("empId");
  const data = empId ? await getByEmpId(empId) : await getAll();
  return cors(NextResponse.json(data));
}

// POST /api/clock  → clock in (creates record)
export async function POST(req: NextRequest) {
  const body = (await req.json()) as ClockRecord;
  if (!body.empId || !body.date || !body.clockInTs) {
    return cors(NextResponse.json({ error: "empId, date, clockInTs required" }, { status: 400 }));
  }
  await upsert({ ...body, status: "clocked-in" });

  // Look up full employee record for manager, shift, department
  const emp = await getEmployeeById(body.empId).catch(() => null) as Record<string, string> | null;

  // Mirror into attendance collection so HR dashboard sees it immediately
  await upsertAttendance(`${body.date}-${body.empId}`, {
    empId:         body.empId,
    name:          emp?.name          ?? body.empName    ?? "",
    dept:          emp?.department    ?? body.department ?? "",
    manager:       emp?.reportingManager ?? "",
    location:      "Office",
    shift:         emp?.shift         ?? "9AM-6PM",
    date:          body.date,
    clockIn:       body.clockInStr,
    clockOut:      "",
    workingHours:  "",
    overtimeHours: "-",
    status:        "Present",
    late:          body.isLate ?? false,
  });

  return cors(NextResponse.json({ ok: true }));
}
