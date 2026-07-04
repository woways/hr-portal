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

        // Strategy 1 (primary): users/{uid}.employeeId — set explicitly by HR during account creation
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
          const ud = uSnap.data() as Record<string, unknown>;
          empId   = String(ud.employeeId ?? "");
          empName = String(ud.name       ?? "");
          empDept = String(ud.department ?? "");
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

        // Strategy 2: fallback — email lookup in employees collection
        if (!empId && empEmail) {
          const snap = await getDocs(
            query(collection(db, "employees"), where("email", "==", empEmail))
          );
          if (!snap.empty) {
            const d = snap.docs[0].data() as Record<string, unknown>;
            empId          = snap.docs[0].id;
            empName        = empName || String(d.name          ?? "");
            empDept        = empDept || String(d.department     ?? "");
            empDesignation = empDesignation || String(d.designation ?? "");
            doj            = doj || String(d.doj            ?? "");
          }
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
