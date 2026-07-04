import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { doc, setDoc, getDocs, collection, query, where } from "firebase/firestore";
import { db, storage } from "./firebase";

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
}

export async function uploadDocFile(
  empId: string,
  slotId: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; path: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `documents/${empId}/${slotId}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(new Error(`Storage: ${(err as Error).message ?? String(err)}`)),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({ url, path });
        } catch (err) {
          reject(new Error(`GetURL: ${(err as Error).message ?? String(err)}`));
        }
      }
    );
  });
}

export async function saveDocMeta(empId: string, slotId: string, data: StoredDoc): Promise<void> {
  const docId = `${empId}_${slotId}`;
  await setDoc(doc(db, "documents", docId), {
    ...data,
    slotId,
    docId,
    empId,
    uploadedAt: data.uploadedAt ?? new Date().toISOString(),
  });
}

export async function loadDocMeta(empId: string): Promise<Record<string, StoredDoc>> {
  try {
    const snap = await getDocs(
      query(collection(db, "documents"), where("empId", "==", empId))
    );
    const result: Record<string, StoredDoc> = {};
    snap.docs.forEach((d) => {
      const rec = d.data() as StoredDoc & { slotId?: string };
      const slotId = rec.slotId ?? d.id.replace(`${empId}_`, "");
      result[slotId] = rec;
    });
    return result;
  } catch {
    return {};
  }
}
