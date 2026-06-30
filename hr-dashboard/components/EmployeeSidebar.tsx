"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  LayoutDashboard, Clock, Calendar, Target, User,
  CalendarDays, Bell, IndianRupee, HelpCircle, LogOut,
} from "lucide-react";

const navItems = [
  { label: "Dashboard",     href: "/employee/dashboard",              icon: LayoutDashboard },
  { label: "Attendance",    href: "/employee/dashboard/attendance",   icon: Clock           },
  { label: "Leaves",        href: "/employee/dashboard/leave",        icon: Calendar        },
  { label: "Goals",         href: "/employee/dashboard/goals",        icon: Target          },
  { label: "Profile",       href: "/employee/dashboard/profile",      icon: User            },
  { label: "Calendar",      href: "/employee/dashboard/calendar",     icon: CalendarDays    },
  { label: "Notifications", href: "/employee/dashboard/notifications",icon: Bell            },
  { label: "Compensation",  href: "/employee/dashboard/compensation", icon: IndianRupee      },
  { label: "Help & Support",href: "/employee/dashboard/help",         icon: HelpCircle      },
];

export default function EmployeeSidebar() {
  const pathname = usePathname();
  const [empName,  setEmpName]  = useState("");
  const [empRole,  setEmpRole]  = useState("");
  const [initials, setInitials] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      function applyName(name: string, role: string) {
        setEmpName(name);
        setEmpRole(role);
        setInitials(name.split(" ").map(n => n[0]).filter(Boolean).join("").toUpperCase().slice(0, 2) || name.slice(0, 2).toUpperCase() || "E");
      }

      try {
        // 1. Query employees by email — fastest path
        if (user.email) {
          const snap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!snap.empty) {
            const d = snap.docs[0].data() as Record<string, unknown>;
            applyName(String(d.name ?? ""), String(d.designation ?? d.department ?? "Employee"));
            return;
          }
        }

        // 2. users/{uid} → get name or employeeId
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
          const ud = uSnap.data() as Record<string, unknown>;
          const empId = String(ud.employeeId ?? "");
          if (empId) {
            const eSnap = await getDoc(doc(db, "employees", empId));
            if (eSnap.exists()) {
              const ed = eSnap.data() as Record<string, unknown>;
              applyName(String(ed.name ?? ""), String(ed.designation ?? ed.department ?? "Employee"));
              return;
            }
            // Employee doc deleted — sign out
            await signOut(auth);
            window.location.href = "/";
            return;
          }
          // HR admin or non-employee user — show name from users doc
          const uName = String(ud.name ?? ud.displayName ?? "");
          if (uName) { applyName(uName, String(ud.department ?? "Employee")); return; }
        }

        // 3. Last resort: Firebase Auth display name / email prefix
        const fallback = user.displayName ?? (user.email?.split("@")[0] ?? "Employee");
        applyName(fallback, "Employee");
      } catch {
        const fallback = user.displayName ?? (user.email?.split("@")[0] ?? "Employee");
        applyName(fallback, "Employee");
      }
    });
    return () => unsub();
  }, []);

  async function handleLogout() {
    try { await signOut(auth); } catch { /* ignore */ }
    window.location.href = "/";
  }

  return (
    <aside className="w-[260px] min-h-screen bg-white border-r border-gray-100 flex flex-col py-6 px-4">
      {/* Logo */}
      <div className="mb-6 px-1 flex items-center" style={{ height: "36px" }}>
        <img src="/woways-logo.svg" alt="Woways" className="max-h-full max-w-full w-auto" />
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== "/employee/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-[#EDE9FF] text-[#4F3CC9] font-semibold"
                  : "text-[#4A4A6A] hover:bg-[#F5F3FF]"
              }`}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Employee info at bottom */}
      <div className="border-t border-gray-100 pt-4 mt-4">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-semibold text-xs shrink-0">
            {initials || <User size={14} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {empName || "Loading…"}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {empRole || "Employee"}
            </p>
          </div>
          <button onClick={handleLogout} title="Logout" className="shrink-0">
            <LogOut size={16} className="text-gray-400 hover:text-red-500 transition-colors" />
          </button>
        </div>
      </div>
    </aside>
  );
}
