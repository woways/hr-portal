import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  getDocs, getDoc, query, where, orderBy, onSnapshot,
  serverTimestamp, writeBatch,
} from "firebase/firestore";
import { ref as storageRef, deleteObject, listAll } from "firebase/storage";
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

// Firestore rejects any field whose value is `undefined`. Strip those out so a
// record missing an optional field (e.g. photoURL) doesn't crash the write.
function stripUndefined(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

export async function upsertEmployee(employeeId: string, data: Record<string, unknown>) {
  await setDoc(doc(db, "employees", employeeId), { ...stripUndefined(data), updatedAt: new Date().toISOString() }, { merge: true });
}

export async function updateEmployee(docId: string, data: Record<string, unknown>) {
  // Use setDoc+merge (not updateDoc) so an edit never fails with "No document to
  // update" when the doc id differs from the employeeId field. Merge keeps all
  // existing fields and only overwrites the ones provided.
  await setDoc(doc(db, "employees", docId), { ...stripUndefined(data), updatedAt: new Date().toISOString() }, { merge: true });
}

async function deleteStorageFolder(path: string) {
  try {
    const folder = storageRef(storage, path);
    const { items, prefixes } = await listAll(folder);
    await Promise.all([
      ...items.map((item) => deleteObject(item).catch(() => {})),
      ...prefixes.map((prefix) => deleteStorageFolder(prefix.fullPath)),
    ]);
  } catch { /* folder may not exist */ }
}

export async function deleteEmployee(empId: string) {
  // Fetch the employee doc first to get the employeeId field value (e.g. "EMP001")
  // which may differ from the Firestore doc ID used as empId parameter
  let fieldEmployeeId = empId; // default to same value
  let employeeName = "";
  try {
    const empDoc = await getDoc(doc(db, "employees", empId));
    if (empDoc.exists()) {
      const d = empDoc.data() as Record<string, unknown>;
      if (d.employeeId) fieldEmployeeId = String(d.employeeId);
      if (d.name) employeeName = String(d.name);
    }
  } catch { /* ignore */ }

  // Build the set of all IDs that might reference this employee
  const allEmpIds = Array.from(new Set([empId, fieldEmployeeId].filter(Boolean)));

  // All Firestore collections that reference this employee
  const relatedCollections: Array<{ col: string; field: string }> = [
    { col: "attendance",         field: "empId"  },
    { col: "leaveRequests",      field: "empId"  },
    { col: "leaveBalances",      field: "empId"  },
    { col: "personalGoals",      field: "empId"  },
    { col: "goals",              field: "empId"  },
    { col: "notifications",      field: "userId" },
    { col: "notifications",      field: "empId"  },
    { col: "helpQueries",        field: "empId"  },
    { col: "compensation",       field: "empId"  },
    { col: "incentives",         field: "empId"  },
    { col: "performanceReviews", field: "empId"  },
    { col: "onboarding",         field: "empId"  },
    { col: "regularization",     field: "empId"  },
    { col: "clockRecords",       field: "empId"  },
    { col: "payroll",            field: "empId"  },
    { col: "documents",          field: "empId"  },
    { col: "employeeDocuments",  field: "empId"  },
  ];

  // Delete using ALL possible ID values to cover any mismatch between doc ID and employeeId field
  for (const id of allEmpIds) {
    for (const { col, field } of relatedCollections) {
      try {
        const snap = await getDocs(query(collection(db, col), where(field, "==", id)));
        if (snap.empty) continue;
        const chunks: typeof snap.docs[] = [];
        for (let i = 0; i < snap.docs.length; i += 500) chunks.push(snap.docs.slice(i, i + 500));
        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      } catch { /* collection may not exist */ }
    }
  }

  // Delete HR_PORTAL notifications sent by this employee
  // Old records lack empId field — match by empId in message or employee name in title
  try {
    const hrNotifSnap = await getDocs(
      query(collection(db, "notifications"), where("userId", "==", "HR_PORTAL"))
    );
    const toDelete = hrNotifSnap.docs.filter(d => {
      const r = d.data() as Record<string, unknown>;
      if (allEmpIds.includes(String(r.empId ?? ""))) return true;
      const msg = String(r.message ?? "");
      if (allEmpIds.some(id => msg.includes(`(${id})`))) return true;
      // Match by employee name extracted from title "Something — EmployeeName"
      if (employeeName) {
        const title = String(r.title ?? "");
        const afterDash = title.split("—").pop()?.trim().toLowerCase() ?? "";
        if (afterDash && afterDash === employeeName.toLowerCase()) return true;
      }
      return false;
    });
    if (toDelete.length > 0) {
      const chunks: typeof toDelete[] = [];
      for (let i = 0; i < toDelete.length; i += 500) chunks.push(toDelete.slice(i, i + 500));
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
  } catch { /* ignore */ }

  // Delete the users/{uid} document — match by both possible employeeId values
  try {
    for (const id of allEmpIds) {
      const byEmpId = await getDocs(query(collection(db, "users"), where("employeeId", "==", id)));
      if (!byEmpId.empty) {
        const batch = writeBatch(db);
        byEmpId.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
  } catch { /* ignore */ }

  // Delete all Storage files for this employee (profile photos + documents + certificates)
  await Promise.all([
    deleteStorageFolder(`profile-photos/${empId}`),
    deleteStorageFolder(`employeePhotos/${empId}`),
    deleteStorageFolder(`documents/${empId}`),
    deleteStorageFolder(`employeeDocuments/${empId}`),
    deleteStorageFolder(`employeeCertificates/${empId}`),
  ]);

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

/**
 * Mark HR_PORTAL notifications as read after HR acts on them.
 * - type: notification type e.g. "leave", "attendance", "goal"
 * - empId: when present, narrows the query to that employee's notifications
 * - msgFilter: optional extra predicate on the message string (e.g. match date)
 */
export async function markHRNotifRead(
  type: string,
  empId?: string | null,
  msgFilter?: (msg: string) => boolean,
): Promise<void> {
  try {
    const constraints = [
      where("userId", "==", "HR_PORTAL"),
      where("type",   "==", type),
      where("read",   "==", false),
      ...(empId ? [where("empId", "==", empId)] : []),
    ];
    const snap = await getDocs(query(collection(db, "notifications"), ...constraints));
    await Promise.all(
      snap.docs
        .filter((d) => {
          if (!msgFilter) return true;
          return msgFilter((d.data().message as string) ?? "");
        })
        .map((d) => updateDoc(d.ref, { read: true }))
    );
  } catch { /* non-critical — sidebar will eventually sync */ }
}

/** Mark all unread notifications of a given type as read for a specific employee (personal + broadcast). */
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
