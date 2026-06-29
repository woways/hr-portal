import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { doc, setDoc, deleteDoc, collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db, storage } from "./firebase";

// ── Types ──────────────────────────────────────────────────────────────────

export interface EmpInfo {
  id: string;
  name: string;
  dept: string;
  designation?: string;
}

/** A document slot record stored in the `documents` collection */
export interface StoredDoc {
  name: string;
  category: string;
  status: "Uploaded" | "Pending";
  fileUrl?: string;
  fileName?: string;
  fileExt?: string;
  fileSize?: number;
  storagePath?: string;
  hrOnly?: boolean;
  isExtra?: boolean;
  uploadedAt?: string;
  uploadedBy?: "employee" | "hr";
  // employee context
  empId?: string;
  empName?: string;
  empDept?: string;
  empDesignation?: string;
}

/** Record as stored in Firestore `documents` collection */
export interface DocRecord extends StoredDoc {
  docId: string;   // Firestore document id: `{empId}_{slotId}`
  slotId: string;  // slot key (e.g. "aadhar", "extra_abc123")
}

// ── Upload ─────────────────────────────────────────────────────────────────

export async function uploadDocFile(
  emp: EmpInfo,
  slotId: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; path: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `documents/${emp.id}/${slotId}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);

  const metadata = {
    customMetadata: {
      empId:      emp.id,
      empName:    emp.name,
      empDept:    emp.dept,
      slotId,
      fileName:   file.name,
      uploadedBy: "employee",
    },
  };

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, metadata);
    task.on(
      "state_changed",
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ url, path });
      }
    );
  });
}

// ── Firestore helpers ───────────────────────────────────────────────────────

function clean<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

/**
 * Save document metadata to `documents/{empId}_{slotId}`.
 * Single collection — replaces the old employeeDocuments + allDocuments split.
 */
export async function saveDocMeta(
  emp: EmpInfo,
  slotId: string,
  data: Omit<StoredDoc, "empId" | "empName" | "empDept">,
  uploadedBy: "employee" | "hr" = "employee"
): Promise<void> {
  const docId = `${emp.id}_${slotId}`;
  const record: DocRecord = clean({
    ...data,
    slotId,
    docId,
    empId:          emp.id,
    empName:        emp.name,
    empDept:        emp.dept,
    empDesignation: emp.designation ?? "",
    uploadedBy,
    uploadedAt:     new Date().toISOString(),
  }) as DocRecord;

  await setDoc(doc(db, "documents", docId), record);
}

/**
 * Load all document slots for one employee.
 * Returns a map keyed by slotId — same shape as before.
 */
export async function loadDocMeta(empId: string): Promise<Record<string, StoredDoc>> {
  try {
    const snap = await getDocs(
      query(collection(db, "documents"), where("empId", "==", empId))
    );
    const result: Record<string, StoredDoc> = {};
    snap.docs.forEach((d) => {
      const rec = d.data() as DocRecord;
      // slotId field may be missing on older records — derive it from the document ID: {empId}_{slotId}
      const slotId = rec.slotId || d.id.replace(`${empId}_`, "");
      result[slotId] = rec;
    });
    return result;
  } catch {
    // Rules not yet deployed — return empty so caller can fall back gracefully
    return {};
  }
}

/** Delete a document slot record */
export async function deleteDocMeta(empId: string, slotId: string): Promise<void> {
  await deleteDoc(doc(db, "documents", `${empId}_${slotId}`));
}

/** Reset a slot back to Pending (clears file fields) */
export async function resetDocSlot(
  emp: EmpInfo,
  slotId: string,
  slotName: string,
  slotCategory: string,
  hrOnly: boolean
): Promise<void> {
  const docId = `${emp.id}_${slotId}`;
  await setDoc(doc(db, "documents", docId), {
    slotId,
    docId,
    empId:    emp.id,
    empName:  emp.name,
    empDept:  emp.dept,
    name:     slotName,
    category: slotCategory,
    status:   "Pending",
    hrOnly,
  });
}

/** HR: load all documents across all employees, newest first */
export async function loadAllDocuments(): Promise<DocRecord[]> {
  const snap = await getDocs(
    query(collection(db, "documents"), orderBy("uploadedAt", "desc"))
  );
  return snap.docs.map((d) => d.data() as DocRecord);
}

/** HR: load all documents for a specific employee */
export async function loadDocsByEmployee(empId: string): Promise<DocRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, "documents"),
      where("empId", "==", empId),
      orderBy("uploadedAt", "desc")
    )
  );
  return snap.docs.map((d) => d.data() as DocRecord);
}
