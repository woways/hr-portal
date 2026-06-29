import { getLeaveRequests, upsertLeaveRequest, updateLeaveStatus } from "./firebaseService";

export type LeaveStatus = "Pending" | "Approved" | "Rejected";

export interface LeaveRequest {
  id: string;
  empId: string;
  empName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  appliedOn: string;
  hrComment?: string;
}

function toLeave(d: Record<string, unknown>): LeaveRequest {
  return {
    id:        d.id as string,
    empId:     d.empId as string,
    empName:   d.empName as string,
    leaveType: d.leaveType as string,
    startDate: d.startDate as string,
    endDate:   d.endDate as string,
    days:      d.days as number,
    reason:    d.reason as string,
    status:    d.status as LeaveStatus,
    appliedOn: d.appliedOn as string,
    hrComment: d.hrComment as string | undefined,
  };
}

export async function getAll(): Promise<LeaveRequest[]> {
  const docs = await getLeaveRequests();
  return docs.map(toLeave).sort((a, b) => b.appliedOn.localeCompare(a.appliedOn));
}

export async function getByEmpId(empId: string): Promise<LeaveRequest[]> {
  const docs = await getLeaveRequests(empId);
  return docs.map(toLeave).sort((a, b) => b.appliedOn.localeCompare(a.appliedOn));
}

export async function upsert(req: LeaveRequest): Promise<void> {
  await upsertLeaveRequest(req.id, {
    empId: req.empId, empName: req.empName, leaveType: req.leaveType,
    startDate: req.startDate, endDate: req.endDate, days: req.days,
    reason: req.reason, status: req.status, appliedOn: req.appliedOn,
    hrComment: req.hrComment ?? "",
  });
}

export async function patch(id: string, update: Partial<LeaveRequest>): Promise<boolean> {
  try {
    await updateLeaveStatus(id, update.status ?? "Pending", update.hrComment ?? "");
    return true;
  } catch { return false; }
}
