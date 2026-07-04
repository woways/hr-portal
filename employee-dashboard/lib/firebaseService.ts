import {
  collection, doc, addDoc, updateDoc, getDocs, getDoc,
  query, where, onSnapshot
} from "firebase/firestore";
import { db } from "./firebase";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  requestDate: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  workingHours: string;
  status: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
  targetRole?: string;
}

export interface Goal {
  id: string;
  employeeId: string;
  goalName: string;
  description: string;
  kpi: string;
  deadline: string;
  progress: number;
  status: "Not Started" | "In Progress" | "Completed";
}

// Submit leave request (employee → HR sees it in real-time)
export async function submitLeaveRequest(data: Omit<LeaveRequest, "id">): Promise<string> {
  const ref = await addDoc(collection(db, "leaveRequests"), data);
  return ref.id;
}

// Get my leave requests
export async function getMyLeaveRequests(employeeId: string): Promise<LeaveRequest[]> {
  const q = query(collection(db, "leaveRequests"), where("employeeId", "==", employeeId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
}

// Listen to my leave requests (real-time — HR approval reflects instantly)
export function listenToMyLeaves(employeeId: string, callback: (data: LeaveRequest[]) => void) {
  const q = query(collection(db, "leaveRequests"), where("employeeId", "==", employeeId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest)));
  });
}

// Get my attendance
export async function getMyAttendance(employeeId: string): Promise<AttendanceRecord[]> {
  const q = query(collection(db, "attendance"), where("employeeId", "==", employeeId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
}

// Get my goals (real-time — HR goal assignment reflects instantly)
export function listenToMyGoals(employeeId: string, callback: (data: Goal[]) => void) {
  const q = query(collection(db, "goals"), where("employeeId", "==", employeeId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
  });
}

// Update goal progress
export async function updateGoalProgress(id: string, progress: number, status: string): Promise<void> {
  await updateDoc(doc(db, "goals", id), { progress, status });
}

// Get notifications
export function listenToNotifications(callback: (data: Notification[]) => void) {
  const q = query(collection(db, "notifications"), where("targetRole", "in", ["employee", "all"]));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Notification)));
  });
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, "notifications", id), { read: true });
}

export async function markEmpNotifRead(type: string, empId: string): Promise<void> {
  try {
    const [personal, broadcast] = await Promise.all([
      getDocs(query(collection(db, "notifications"), where("userId", "==", empId))),
      getDocs(query(collection(db, "notifications"), where("userId", "==", "all"))),
    ]);
    const toMark = [...personal.docs, ...broadcast.docs].filter(
      (d) => d.data().type === type && d.data().read !== true,
    );
    if (!toMark.length) return;
    await Promise.all(toMark.map((d) => updateDoc(d.ref, { read: true })));
  } catch { /* non-critical */ }
}

// Get holidays from the shared HR settings collection
export interface Holiday {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  type: string;
}

export async function getHolidays(): Promise<Holiday[]> {
  const snap = await getDoc(doc(db, "settings", "holidays"));
  if (!snap.exists()) return [];
  const data = snap.data() as { list?: Holiday[] };
  return (data.list ?? []).sort((a, b) => a.date.localeCompare(b.date));
}

// Get attendance by empId — queries employees collection field "empId" or by doc ID
export async function getMyAttendanceAll(empId: string): Promise<Record<string, unknown>[]> {
  // Try empId field first (matches how HR marks attendance)
  const q1 = query(collection(db, "attendance"), where("empId", "==", empId));
  const snap1 = await getDocs(q1);
  if (!snap1.empty) return snap1.docs.map(d => ({ ...d.data(), id: d.id }));
  // Fallback: employeeId field
  const q2 = query(collection(db, "attendance"), where("employeeId", "==", empId));
  const snap2 = await getDocs(q2);
  return snap2.docs.map(d => ({ ...d.data(), id: d.id }));
}

// Get leave requests for the employee (try both empId and employeeId fields)
export async function getMyLeaves(empId: string): Promise<LeaveRequest[]> {
  const q1 = query(collection(db, "leaveRequests"), where("empId", "==", empId));
  const snap1 = await getDocs(q1);
  if (!snap1.empty) return snap1.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
  const q2 = query(collection(db, "leaveRequests"), where("employeeId", "==", empId));
  const snap2 = await getDocs(q2);
  return snap2.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
}
