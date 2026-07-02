"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  LayoutDashboard,
  Clock,
  Calendar,
  Target,
  User,
  CalendarDays,
  Bell,
  DollarSign,
  HelpCircle,
  LogOut,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Attendance", href: "/dashboard/attendance", icon: Clock },
  { label: "Leaves", href: "/dashboard/leaves", icon: Calendar },
  { label: "Goals", href: "/dashboard/goals", icon: Target },
  { label: "Profile", href: "/dashboard/profile", icon: User },
  { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays },
  { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
  { label: "Compensation", href: "/dashboard/compensation", icon: DollarSign },
  { label: "Help & Support", href: "/dashboard/help", icon: HelpCircle },
];

interface EmpInfo { name: string; id: string; }

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [emp, setEmp] = useState<EmpInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        // Step 1: get employeeId from users/{uid}
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) { setLoading(false); return; }
        const eid = userSnap.data().employeeId as string;
        if (!eid) { setLoading(false); return; }

        // Step 2: read employee record directly from Firestore (no CORS issues)
        const empSnap = await getDoc(doc(db, "employees", eid));
        if (empSnap.exists()) {
          const data = empSnap.data();
          setEmp({ name: (data.name as string) ?? "", id: eid });
        } else {
          // Employee was deleted by HR — sign out and redirect to login
          await signOut(auth);
          router.push("/login?reason=account-removed");
          return;
        }
      } catch { /* ignore */ }
      setLoading(false);
    });
    return unsub;
  }, []);

  async function handleLogout() {
    await signOut(auth);
    router.push("/login");
  }

  const initials = emp?.name
    ? emp.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <aside className="w-[260px] min-h-screen bg-white border-r border-gray-100 flex flex-col py-6 px-4">
      <div className="mb-6 px-1 flex items-center">
        <span className="text-2xl font-black text-[#0B1929] tracking-tight leading-none">WO</span>
        <span className="text-2xl font-black text-[#14B8A6] tracking-tight leading-none">WAYS</span>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));
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
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-100 pt-4 mt-4">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-9 h-9 rounded-full bg-[#4F3CC9] flex items-center justify-center text-white font-bold text-xs shrink-0">
            {loading ? "…" : initials}
          </div>
          <div className="flex-1 min-w-0">
            {loading ? (
              <>
                <div className="h-3.5 w-24 bg-gray-100 rounded animate-pulse mb-1.5" />
                <div className="h-3 w-16 bg-gray-100 rounded animate-pulse" />
              </>
            ) : emp ? (
              <>
                <p className="text-sm font-semibold text-gray-900 truncate">{emp.name}</p>
                <p className="text-xs text-[#4F3CC9] font-medium">{emp.id}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-900">Employee</p>
                <p className="text-xs text-gray-400">—</p>
              </>
            )}
          </div>
          <button
            onClick={handleLogout}
            title="Logout"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
