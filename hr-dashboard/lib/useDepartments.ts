"use client";
import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEPARTMENTS } from "@/lib/constants";

/**
 * Live list of departments. Reads the HR-configured list from
 * settings/departments (written by Settings → Departments) so newly added
 * departments appear in every dropdown immediately. Falls back to the built-in
 * defaults when nothing is configured yet.
 */
export function useDepartments(): string[] {
  const [depts, setDepts] = useState<string[]>(DEPARTMENTS);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "settings", "departments"),
      (snap) => {
        const list = snap.exists() ? (snap.data().list as unknown) : null;
        if (Array.isArray(list) && list.length > 0) {
          setDepts(list.filter((d): d is string => typeof d === "string" && d.trim() !== ""));
        }
      },
      () => { /* keep defaults on error */ }
    );
    return unsub;
  }, []);
  return depts;
}
