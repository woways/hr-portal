import { NextRequest, NextResponse } from "next/server";
import { getAttendance, upsertAttendance, updateAttendance, getAttendanceByEmpId } from "@/lib/firebaseService";

export type AttStatus = "Present" | "Absent" | "Half Day" | "Leave" | "Week Off";
export type WorkLoc   = "Office" | "WFH" | "Client Site";

export interface AttRecord {
  id: string; empId: string; name: string; dept: string; manager: string;
  location: WorkLoc; shift: string; date: string;
  clockIn: string; clockOut: string; workingHours: string;
  overtimeHours: string; status: AttStatus; late: boolean;
}

function toRecord(d: Record<string, unknown>): AttRecord {
  return {
    id:            d.id as string,
    empId:         d.empId as string,
    name:          d.name as string,
    dept:          d.dept as string,
    manager:       (d.manager as string) ?? "",
    location:      (d.location as WorkLoc) ?? "Office",
    shift:         (d.shift as string) ?? "9AM-6PM",
    date:          d.date as string,
    clockIn:       (d.clockIn as string) ?? "",
    clockOut:      (d.clockOut as string) ?? "",
    workingHours:  (d.workingHours as string) ?? "-",
    overtimeHours: (d.overtimeHours as string) ?? "-",
    status:        (d.status as AttStatus) ?? "Absent",
    late:          (d.late as boolean) ?? false,
  };
}

function today() { return new Date().toISOString().slice(0, 10); }

export async function GET(req: NextRequest) {
  const date  = req.nextUrl.searchParams.get("date");
  const empId = req.nextUrl.searchParams.get("empId");
  if (empId) {
    const docs = await getAttendanceByEmpId(empId);
    return NextResponse.json(docs.map(d => toRecord(d as Record<string, unknown>)));
  }
  const docs = await getAttendance(date ?? today());
  return NextResponse.json(docs.map(d => toRecord(d as Record<string, unknown>)));
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Partial<AttRecord> & { id: string };
  const update: Record<string, unknown> = {};
  if (body.clockIn       !== undefined) update.clockIn       = body.clockIn;
  if (body.clockOut      !== undefined) update.clockOut      = body.clockOut;
  if (body.workingHours  !== undefined) update.workingHours  = body.workingHours;
  if (body.overtimeHours !== undefined) update.overtimeHours = body.overtimeHours;
  if (body.status        !== undefined) update.status        = body.status;
  if (body.late          !== undefined) update.late          = body.late;

  await updateAttendance(body.id, update);
  return NextResponse.json({ ok: true });
}
