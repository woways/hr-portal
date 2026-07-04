"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, getDocs, collection, query, where, onSnapshot } from "firebase/firestore";
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
  { label: "Dashboard",     href: "/dashboard",               icon: LayoutDashboard, notifType: null         },
  { label: "Attendance",    href: "/dashboard/attendance",    icon: Clock,           notifType: "attendance" },
  { label: "Leaves",        href: "/dashboard/leaves",        icon: Calendar,        notifType: "leave"      },
  { label: "Goals",         href: "/dashboard/goals",         icon: Target,          notifType: "goal"       },
  { label: "Profile",       href: "/dashboard/profile",       icon: User,            notifType: null         },
  { label: "Calendar",      href: "/dashboard/calendar",      icon: CalendarDays,    notifType: null         },
  { label: "Notifications", href: "/dashboard/notifications", icon: Bell,            notifType: "_total"     },
  { label: "Compensation",  href: "/dashboard/compensation",  icon: DollarSign,      notifType: "payroll"    },
  { label: "Help & Support",href: "/dashboard/help",          icon: HelpCircle,      notifType: null         },
];

interface EmpInfo { name: string; id: string; department: string; role: string; }

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const [emp,        setEmp]        = useState<EmpInfo | null>(null);
  const [notifEmpId, setNotifEmpId] = useState<string>("");
  const [loading,    setLoading]    = useState(true);
  const [counts,     setCounts]     = useState<Record<string, number>>({});

  useEffect(() => {
    let empUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, async (user) => {
      if (empUnsub) { empUnsub(); empUnsub = null; }
      if (!user) { router.replace("/login"); setLoading(false); return; }

      const CACHE = "emp_sidebar_v2";

      // Show cached data immediately for fast initial render
      try {
        const raw = sessionStorage.getItem(CACHE);
        if (raw) {
          const cached = JSON.parse(raw) as { name: string; id: string; department?: string; role?: string; notifId?: string; uid: string };
          if (cached.uid === user.uid) {
            setEmp({ name: cached.name, id: cached.id, department: cached.department ?? "", role: cached.role ?? "" });
            setNotifEmpId(cached.notifId || cached.id);
            setLoading(false);
          }
        }
      } catch { /* ignore */ }

      try {
        // Step 0: email lookup — gets empId as fallback if users/{uid} is missing
        let notifId = "";
        let emailEmpId = "";
        if (user.email) {
          const emailSnap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!emailSnap.empty) {
            notifId = emailSnap.docs[0].id;
            emailEmpId = emailSnap.docs[0].id;
          }
        }

        // Step 1: get employeeId from users/{uid} (primary) or email lookup (fallback)
        const userSnap = await getDoc(doc(db, "users", user.uid));
        let eid = "";
        if (userSnap.exists()) {
          eid = (userSnap.data().employeeId as string) ?? "";
        }
        // Fallback: if users/{uid} missing or has no empId, use the email-lookup result
        if (!eid) eid = emailEmpId;

        if (!eid) {
          // No employee record found at all — account was deleted
          await signOut(auth);
          router.replace("/login?reason=account-removed");
          setLoading(false);
          return;
        }
        if (!notifId) notifId = eid;
        setNotifEmpId(notifId);

        // Step 2: live listener — sidebar updates whenever HR edits the employee record
        empUnsub = onSnapshot(doc(db, "employees", eid), (snap) => {
          if (!snap.exists()) {
            signOut(auth);
            router.push("/login?reason=account-removed");
            return;
          }
          const data = snap.data();
          const name = (data.name as string) ?? "";
          const department = (data.department as string) ?? "";
          const role = (data.role as string) ?? "";
          setEmp({ name, id: eid, department, role });
          sessionStorage.setItem(CACHE, JSON.stringify({ name, id: eid, department, role, notifId, uid: user.uid }));
          setLoading(false);
        }, () => { setLoading(false); });
      } catch {
        setLoading(false);
      }
    });

    return () => { authUnsub(); if (empUnsub) empUnsub(); };
  }, []);

  useEffect(() => {
    if (!notifEmpId) return;
    const q = query(
      collection(db, "notifications"),
      where("userId", "in", [notifEmpId, "all"])
    );
    const unsub = onSnapshot(q, (snap) => {
      const map: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.read === true) return;
        if (data.category === "helpQuery") return;
        map._total = (map._total ?? 0) + 1;
        const t = data.type as string;
        if (t) map[t] = (map[t] ?? 0) + 1;
      });
      setCounts(map);
    }, () => {});
    return unsub;
  }, [notifEmpId]);

  async function handleLogout() {
    sessionStorage.removeItem("emp_sidebar_v1");
    await signOut(auth);
    router.push("/login");
  }

  const initials = emp?.name
    ? emp.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <aside className="w-[260px] min-h-screen bg-white dark:bg-[#13132a] border-r border-gray-100 dark:border-[#252545] flex flex-col py-6 px-4">
      <div className="mb-6 flex items-center justify-center">
        <span className="text-4xl font-black text-[#0B1929] dark:text-white tracking-tight leading-none">WO</span>
        <span className="text-4xl font-black text-[#14B8A6] tracking-tight leading-none">WAYS</span>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map(({ label, href, icon: Icon, notifType }) => {
          const isActive =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));
          const badge = notifType ? (counts[notifType] ?? 0) : 0;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-[#EDE9FF] dark:bg-[#2a2050] text-[#4F3CC9] dark:text-purple-300 font-semibold"
                  : "text-[#4A4A6A] dark:text-gray-400 hover:bg-[#F5F3FF] dark:hover:bg-[#1e1e38]"
              }`}
            >
              <Icon size={18} />
              {label}
              {badge > 0 && (
                <span className="ml-auto min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shrink-0">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-100 dark:border-[#252545] pt-4 mt-4">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-9 h-9 rounded-full bg-[#4F3CC9] flex items-center justify-center text-white font-bold text-xs shrink-0">
            {loading ? "…" : initials}
          </div>
          <div className="flex-1 min-w-0">
            {loading ? (
              <>
                <div className="h-3.5 w-24 bg-gray-100 dark:bg-[#252545] rounded animate-pulse mb-1.5" />
                <div className="h-3 w-16 bg-gray-100 dark:bg-[#252545] rounded animate-pulse" />
              </>
            ) : emp ? (
              <>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{emp.name}</p>
                {emp.role && <p className="text-xs text-gray-600 dark:text-gray-300 truncate">{emp.role}</p>}
                {emp.department && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{emp.department}</p>}
                {!emp.role && !emp.department && <p className="text-xs text-gray-600 dark:text-gray-300">Employee</p>}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Employee</p>
                <p className="text-xs text-gray-400">—</p>
              </>
            )}
          </div>
          <button
            onClick={handleLogout}
            title="Logout"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
