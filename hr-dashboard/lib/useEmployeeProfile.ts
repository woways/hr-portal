"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";
import { auth, db } from "./firebase";

export interface EmployeeProfile {
  empId: string;
  empName: string;
  empDept: string;
  empDesignation: string;
  empEmail: string;
  doj: string;   // date of joining — YYYY-MM-DD, empty if unknown
  loading: boolean;
}

export function useEmployeeProfile(): EmployeeProfile {
  const [profile, setProfile] = useState<EmployeeProfile>({
    empId: "", empName: "", empDept: "", empDesignation: "", empEmail: "", doj: "", loading: true,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setProfile({ empId: "", empName: "", empDept: "", empDesignation: "", empEmail: "", doj: "", loading: false });
        return;
      }

      try {
        let empId = "";
        let empName = "";
        let empDept = "";
        let empDesignation = "";
        let doj = "";
        const empEmail = user.email ?? "";

        // Strategy 1 (primary): look up by email in the employees collection
        // Works for ALL employees including those without a users/{uid} doc
        if (empEmail) {
          const snap = await getDocs(
            query(collection(db, "employees"), where("email", "==", empEmail))
          );
          if (!snap.empty) {
            const d = snap.docs[0].data() as Record<string, unknown>;
            empId          = snap.docs[0].id;
            empName        = String(d.name          ?? "");
            empDept        = String(d.department     ?? "");
            empDesignation = String(d.designation    ?? "");
            doj            = String(d.doj            ?? "");
          }
        }

        // Strategy 2: fall back to users/{uid}.employeeId → then fetch employee doc
        if (!empId) {
          const uSnap = await getDoc(doc(db, "users", user.uid));
          if (uSnap.exists()) {
            const ud = uSnap.data() as Record<string, unknown>;
            empId   = String(ud.employeeId ?? "");
            empName = String(ud.name       ?? "");
            empDept = String(ud.department ?? "");
            // Try to enrich with full employee doc
            if (empId) {
              const eSnap = await getDoc(doc(db, "employees", empId));
              if (eSnap.exists()) {
                const ed = eSnap.data() as Record<string, unknown>;
                empName        = String(ed.name        ?? empName);
                empDept        = String(ed.department  ?? empDept);
                empDesignation = String(ed.designation ?? "");
                doj            = String(ed.doj         ?? "");
              }
            }
          }
        }

        // Strategy 3: last resort — use Firebase Auth display name + uid as empId
        if (!empId) {
          empId   = user.uid;
          empName = user.displayName ?? empEmail.split("@")[0] ?? "";
        }

        setProfile({ empId, empName, empDept, empDesignation, empEmail, doj, loading: false });
      } catch {
        // Even on error, resolve with what we can so pages don't hang
        setProfile({
          empId:          user.uid,
          empName:        user.displayName ?? user.email?.split("@")[0] ?? "",
          empDept:        "",
          empDesignation: "",
          empEmail:       user.email ?? "",
          doj:            "",
          loading:        false,
        });
      }
    });
    return unsub;
  }, []);

  return profile;
}
