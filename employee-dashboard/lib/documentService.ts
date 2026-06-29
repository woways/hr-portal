import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, storage } from "./firebase";

export interface StoredDoc {
  name: string;
  category: string;
  status: "Uploaded" | "Pending";
  fileUrl?: string;
  fileName?: string;
  fileExt?: string;
  hrOnly?: boolean;
  isExtra?: boolean;
  uploadedAt?: string;
  uploadedBy?: "employee" | "hr";
}

// Upload a file to Firebase Storage and return the download URL
export async function uploadDocFile(
  empId: string,
  slotId: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  const path = `employeeDocuments/${empId}/${slotId}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });
}

// Save a document slot's metadata to Firestore
export async function saveDocMeta(empId: string, slotId: string, data: StoredDoc): Promise<void> {
  await setDoc(
    doc(db, "employeeDocuments", empId),
    { [slotId]: { ...data, uploadedAt: new Date().toISOString() } },
    { merge: true }
  );
}

// Load all document slots for an employee
export async function loadDocMeta(empId: string): Promise<Record<string, StoredDoc>> {
  const snap = await getDoc(doc(db, "employeeDocuments", empId));
  if (!snap.exists()) return {};
  return snap.data() as Record<string, StoredDoc>;
}
