import { getClockRecord, getAllClockRecords, upsertClockRecord } from "./firebaseService";

export interface ClockRecord {
  empId: string;
  empName: string;
  department: string;
  date: string;
  clockInTs: number;
  clockInStr: string;
  clockOutTs?: number;
  clockOutStr?: string;
  totalSeconds?: number;
  status: "clocked-in" | "clocked-out";
  isLate: boolean;
}

function toClock(d: Record<string, unknown>): ClockRecord {
  return {
    empId:        d.empId as string,
    empName:      d.empName as string,
    department:   d.department as string,
    date:         d.date as string,
    clockInTs:    d.clockInTs as number,
    clockInStr:   d.clockInStr as string,
    clockOutTs:   d.clockOutTs as number | undefined,
    clockOutStr:  d.clockOutStr as string | undefined,
    totalSeconds: d.totalSeconds as number | undefined,
    status:       d.status as "clocked-in" | "clocked-out",
    isLate:       (d.isLate ?? false) as boolean,
  };
}

export async function getAll(): Promise<ClockRecord[]> {
  const today = new Date().toISOString().slice(0, 10);
  const docs = await getAllClockRecords(today);
  return docs.map(toClock);
}

export async function getByEmpId(empId: string): Promise<ClockRecord | undefined> {
  const today = new Date().toISOString().slice(0, 10);
  const d = await getClockRecord(empId, today);
  return d ? toClock(d as Record<string, unknown>) : undefined;
}

export async function upsert(rec: ClockRecord): Promise<void> {
  await upsertClockRecord(rec.empId, rec.date, {
    empName:      rec.empName,
    department:   rec.department,
    clockInTs:    rec.clockInTs,
    clockInStr:   rec.clockInStr,
    clockOutTs:   rec.clockOutTs ?? null,
    clockOutStr:  rec.clockOutStr ?? null,
    totalSeconds: rec.totalSeconds ?? null,
    status:       rec.status,
    isLate:       rec.isLate,
  });
}

export async function patchClock(empId: string, date: string, update: Partial<ClockRecord>): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = {};
    if (update.clockOutTs   !== undefined) patch.clockOutTs   = update.clockOutTs;
    if (update.clockOutStr  !== undefined) patch.clockOutStr  = update.clockOutStr;
    if (update.totalSeconds !== undefined) patch.totalSeconds = update.totalSeconds;
    if (update.status       !== undefined) patch.status       = update.status;
    await upsertClockRecord(empId, date, patch);
    return true;
  } catch { return false; }
}
