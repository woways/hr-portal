import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  getDocs, getDoc, query, where, orderBy, onSnapshot,
  serverTimestamp, writeBatch,
} from "firebase/firestore";
import { ref as storageRef, deleteObject } from "firebase/storage";
import { db, storage } from "./firebase";

// ── Re-export types so consumers import from one place ───────────────────────
export type { Employee, AttendanceRecord, LeaveRequest, Candidate, Goal, PayrollRecord, Notification } from "./types";

// ─── Employees ────────────────────────────────────────────────────────────────
export async function getEmployees() {
  // Primary: ordered query (excludes docs without the field — handled by fallback)
  try {
    const orderedSnap = await getDocs(query(collection(db, "employees"), orderBy("employeeId")));
    if (!orderedSnap.empty) {
      return orderedSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
    }
  } catch {}

  // Fallback: full scan of employees collection (handles docs missing the employeeId field)
  const allSnap = await getDocs(collection(db, "employees"));
  return allSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => ((a as Record<string,string>).employeeId ?? (a as Record<string,string>).id ?? "")
      .localeCompare((b as Record<string,string>).employeeId ?? (b as Record<string,string>).id ?? ""));
}

export async function getEmployeeById(employeeId: string) {
  const snap = await getDocs(query(collection(db, "employees"), where("employeeId", "==", employeeId)));
  if (snap.empty) return null;
  return { ...snap.docs[0].data(), id: snap.docs[0].id };
}

export async function addEmployee(data: Record<string, unknown>) {
  const ref = await addDoc(collection(db, "employees"), { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

export async function upsertEmployee(employeeId: string, data: Record<string, unknown>) {
  await setDoc(doc(db, "employees", employeeId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function updateEmployee(docId: string, data: Record<string, unknown>) {
  await updateDoc(doc(db, "employees", docId), { ...data, updatedAt: new Date().toISOString() });
}

export async function deleteEmployee(empId: string) {
  // Collections where employee data lives, keyed by the field that holds empId
  const relatedCollections: Array<{ col: string; field: string }> = [
    { col: "attendance",        field: "empId"      },
    { col: "leaveRequests",     field: "empId"      },
    { col: "personalGoals",     field: "empId"      },
    { col: "notifications",     field: "userId"     },
    { col: "helpQueries",       field: "empId"      },
    { col: "compensation",      field: "empId"      },
    { col: "performanceReviews",field: "empId"      },
    { col: "onboarding",        field: "empId"      },
    { col: "regularization",    field: "empId"      },
    { col: "clockRecords",      field: "empId"      },
    { col: "leaveBalances",     field: "empId"      },
    { col: "payroll",           field: "empId"      },
  ];

  // Delete docs in each related collection in batches of 500
  for (const { col, field } of relatedCollections) {
    try {
      const snap = await getDocs(query(collection(db, col), where(field, "==", empId)));
      const chunks: typeof snap.docs[] = [];
      for (let i = 0; i < snap.docs.length; i += 500) chunks.push(snap.docs.slice(i, i + 500));
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch { /* collection may not exist or have no docs */ }
  }

  // Delete the users/{uid} document where employeeId matches
  try {
    const userSnap = await getDocs(query(collection(db, "users"), where("employeeId", "==", empId)));
    if (!userSnap.empty) {
      const batch = writeBatch(db);
      userSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch { /* ignore */ }

  // Delete profile photo from Firebase Storage
  try {
    await deleteObject(storageRef(storage, `profile-photos/${empId}`));
  } catch { /* photo may not exist */ }

  // Finally delete the employee document itself
  await deleteDoc(doc(db, "employees", empId));
}

// ─── Candidates ──────────────────────────────────────────────────────────────
export async function getCandidates() {
  const snap = await getDocs(collection(db, "candidates"));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

// ─── Leave Requests ───────────────────────────────────────────────────────────
export async function getLeaveRequests(empId?: string) {
  const col = collection(db, "leaveRequests");
  const q = empId ? query(col, where("empId", "==", empId)) : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function upsertLeaveRequest(leaveId: string, data: Record<string, unknown>) {
  await setDoc(doc(db, "leaveRequests", leaveId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function updateLeaveStatus(leaveId: string, status: string, hrComment = "") {
  await updateDoc(doc(db, "leaveRequests", leaveId), { status, hrComment, updatedAt: new Date().toISOString() });
}

export async function deleteLeaveRequest(leaveId: string) {
  await deleteDoc(doc(db, "leaveRequests", leaveId));
}

// ─── Goals ────────────────────────────────────────────────────────────────────
export async function getGoals(empId?: string) {
  const col = collection(db, "goals");
  const q = empId ? query(col, where("empId", "==", empId)) : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function upsertGoal(goalId: string, data: Record<string, unknown>) {
  await setDoc(doc(db, "goals", goalId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function updateGoal(goalId: string, data: Record<string, unknown>) {
  await updateDoc(doc(db, "goals", goalId), { ...data, updatedAt: new Date().toISOString() });
}

export async function deleteGoal(goalId: string) {
  await deleteDoc(doc(db, "goals", goalId));
}

// ─── Attendance ───────────────────────────────────────────────────────────────
export async function getAttendance(date?: string) {
  const col = collection(db, "attendance");
  const q = date ? query(col, where("date", "==", date)) : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function getAttendanceByEmpId(empId: string) {
  const snap = await getDocs(query(collection(db, "attendance"), where("empId", "==", empId)));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function upsertAttendance(attId: string, data: Record<string, unknown>) {
  await setDoc(doc(db, "attendance", attId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function updateAttendance(attId: string, data: Record<string, unknown>) {
  await updateDoc(doc(db, "attendance", attId), { ...data, updatedAt: new Date().toISOString() });
}

// ─── Payroll ──────────────────────────────────────────────────────────────────
export async function getPayroll(month?: string, empId?: string) {
  const col = collection(db, "payroll");
  let q = query(col);
  if (month) q = query(col, where("month", "==", month));
  if (empId) q = query(col, where("empId", "==", empId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function upsertPayroll(payrollId: string, data: Record<string, unknown>) {
  await setDoc(doc(db, "payroll", payrollId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function updatePayrollStatus(payrollId: string, status: string, paymentDate = "") {
  await updateDoc(doc(db, "payroll", payrollId), { paymentStatus: status, paymentDate, updatedAt: new Date().toISOString() });
}

// ─── Notifications ────────────────────────────────────────────────────────────
export async function getNotifications(userId: string): Promise<Record<string, unknown>[]> {
  const snap = await getDocs(query(collection(db, "notifications"), where("userId", "==", userId)));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id })) as Record<string, unknown>[];
}

export async function addNotification(data: Record<string, unknown>) {
  const ref = await addDoc(collection(db, "notifications"), { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function markNotificationRead(notifId: string) {
  await updateDoc(doc(db, "notifications", notifId), { read: true });
}

export async function markAllNotificationsRead(userId: string) {
  const snap = await getDocs(query(collection(db, "notifications"), where("userId", "==", userId), where("read", "==", false)));
  await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { read: true })));
}

// ─── Regularization ───────────────────────────────────────────────────────────
export async function getRegularization(): Promise<Record<string, unknown>[]> {
  const snap = await getDocs(collection(db, "regularization"));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id })) as Record<string, unknown>[];
}

export async function upsertRegularization(regId: string, data: Record<string, unknown>) {
  await setDoc(doc(db, "regularization", regId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function updateRegularizationStatus(regId: string, status: string, hrComment = "") {
  await updateDoc(doc(db, "regularization", regId), { status, hrComment, updatedAt: new Date().toISOString() });
}

// ─── Clock Records ────────────────────────────────────────────────────────────
export async function getClockRecord(empId: string, date: string) {
  const id = `${date}-${empId}`;
  const snap = await getDoc(doc(db, "clockRecords", id));
  return snap.exists() ? { ...snap.data(), id: snap.id } : null;
}

export async function getAllClockRecords(date?: string) {
  const col = collection(db, "clockRecords");
  const q = date ? query(col, where("date", "==", date)) : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function upsertClockRecord(empId: string, date: string, data: Record<string, unknown>) {
  const id = `${date}-${empId}`;
  await setDoc(doc(db, "clockRecords", id), { ...data, empId, date, updatedAt: new Date().toISOString() }, { merge: true });
}

// ─── Compensation ─────────────────────────────────────────────────────────────
export async function getCompensation(empId?: string) {
  const col = collection(db, "compensation");
  const q = empId ? query(col, where("empId", "==", empId)) : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function addCompensation(data: Record<string, unknown>) {
  // Use empId_month as the document ID so records are human-readable and deduped per employee per month
  const empId = String(data.empId ?? "unknown").replace(/\s+/g, "_");
  const month = String(data.month ?? "unknown").replace(/\s+/g, "_");
  const docId = `${empId}_${month}`;
  await setDoc(doc(db, "compensation", docId), { ...data, createdAt: new Date().toISOString() }, { merge: true });
  return docId;
}

export async function updateCompensation(docId: string, data: Record<string, unknown>) {
  await updateDoc(doc(db, "compensation", docId), { ...data, updatedAt: new Date().toISOString() });
}

export async function deleteCompensation(docId: string) {
  await deleteDoc(doc(db, "compensation", docId));
}

// ─── Incentives ───────────────────────────────────────────────────────────────
export async function getIncentives(empId?: string) {
  const col = collection(db, "incentives");
  const q = empId ? query(col, where("empId", "==", empId)) : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function addIncentive(data: Record<string, unknown>) {
  const ref = await addDoc(collection(db, "incentives"), { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function updateIncentiveStatus(docId: string, status: string) {
  await updateDoc(doc(db, "incentives", docId), { status, updatedAt: new Date().toISOString() });
}

// ─── Real-time listeners ──────────────────────────────────────────────────────
export function listenToLeaveRequests(callback: (data: Record<string, unknown>[]) => void) {
  return onSnapshot(collection(db, "leaveRequests"), (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
  });
}

export function listenToNotifications(userId: string, callback: (data: Record<string, unknown>[]) => void) {
  const q = query(collection(db, "notifications"), where("userId", "==", userId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
  });
}

export function listenToAttendance(date: string, callback: (data: Record<string, unknown>[]) => void) {
  const q = query(collection(db, "attendance"), where("date", "==", date));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function getSettingsDoc(docId: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, "settings", docId));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

export async function saveSettingsDoc(docId: string, data: Record<string, unknown>): Promise<void> {
  await setDoc(doc(db, "settings", docId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
