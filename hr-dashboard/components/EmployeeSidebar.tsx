"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, where, getDoc, getDocs, doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  LayoutDashboard, Clock, Calendar, Target, User,
  CalendarDays, Bell, IndianRupee, HelpCircle, LogOut,
} from "lucide-react";

const navItems = [
  { label: "Dashboard",     href: "/employee/dashboard",               icon: LayoutDashboard, notifType: null        },
  { label: "Attendance",    href: "/employee/dashboard/attendance",    icon: Clock,           notifType: "attendance"},
  { label: "Leaves",        href: "/employee/dashboard/leave",         icon: Calendar,        notifType: "leave"     },
  { label: "Goals",         href: "/employee/dashboard/goals",         icon: Target,          notifType: "goal"      },
  { label: "Profile",       href: "/employee/dashboard/profile",       icon: User,            notifType: null        },
  { label: "Calendar",      href: "/employee/dashboard/calendar",      icon: CalendarDays,    notifType: null        },
  { label: "Notifications", href: "/employee/dashboard/notifications", icon: Bell,            notifType: "_total"    },
  { label: "Payroll",       href: "/employee/dashboard/compensation",  icon: IndianRupee,     notifType: "payroll"   },
  { label: "Help & Support",href: "/employee/dashboard/help",          icon: HelpCircle,      notifType: null        },
];

export default function EmployeeSidebar() {
  const pathname = usePathname();
  const [empName,    setEmpName]    = useState("");
  const [empDept,    setEmpDept]    = useState("");
  const [empRole,    setEmpRole]    = useState("");
  const [initials,   setInitials]   = useState("");
  const [empPhoto,    setEmpPhoto]    = useState("");
  const [photoError,  setPhotoError]  = useState("");
  const [notifEmpId, setNotifEmpId] = useState("");
  const [counts,     setCounts]     = useState<Record<string, number>>({});

  useEffect(() => {
    let empUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, async (user) => {
      if (empUnsub) { empUnsub(); empUnsub = null; }
      if (!user) return;

      function applyName(name: string, dept: string, role = "") {
        setEmpName(name);
        setEmpDept(dept);
        setEmpRole(role);
        setInitials(name.split(" ").map(n => n[0]).filter(Boolean).join("").toUpperCase().slice(0, 2) || name.slice(0, 2).toUpperCase() || "E");
      }

      const CACHE = "emp_esidebar_v2";

      // Show cached data immediately for fast initial render
      try {
        const raw = sessionStorage.getItem(CACHE);
        if (raw) {
          const cached = JSON.parse(raw) as { name: string; role: string; dept?: string; empId: string; notifId?: string; uid: string; photoURL?: string };
          if (cached.uid === user.uid) {
            applyName(cached.name, cached.dept ?? "", cached.role);
            setNotifEmpId(cached.notifId || cached.empId);
            if (cached.photoURL) setEmpPhoto(cached.photoURL);
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

        // Step 1: resolve empId from users/{uid} (primary) or email lookup (fallback)
        const uSnap = await getDoc(doc(db, "users", user.uid));
        const ud = uSnap.exists() ? (uSnap.data() as Record<string, unknown>) : null;
        const eidFromUsers = ud ? String(ud.employeeId ?? "") : "";

        // Prefer emailEmpId (actual Firestore doc ID from email query).
        // Fall back to eidFromUsers (users/{uid}.employeeId).
        let empId = emailEmpId || eidFromUsers;

        if (!empId) {
          if (ud) {
            // Has users/{uid} but no employeeId and no email match → HR admin
            const uName = String(ud.name ?? ud.displayName ?? "");
            applyName(uName || (user.displayName ?? user.email?.split("@")[0] ?? "HR"), String(ud.department ?? "HR Admin"));
          } else {
            // No users doc and no employee record — account was deleted
            await signOut(auth);
            window.location.href = "/?reason=account-removed";
          }
          return;
        }

        if (!notifId) notifId = empId;
        setNotifEmpId(notifId);

        // Step 2: live listener — sidebar updates whenever HR edits the employee record
        empUnsub = onSnapshot(doc(db, "employees", empId), (snap) => {
          if (!snap.exists()) {
            signOut(auth);
            window.location.href = "/";
            return;
          }
          const ed = snap.data() as Record<string, unknown>;
          const name = String(ed.name ?? "");
          const dept = String(ed.department ?? "");
          const role = String(ed.role ?? "");
          const photo = String(ed.photoURL ?? ed.profilePhoto ?? "");
          setEmpPhoto(photo);
          setPhotoError("");
          applyName(name, dept, role);
          sessionStorage.setItem(CACHE, JSON.stringify({ name, role, dept, empId, notifId, uid: user.uid, photoURL: photo }));
        }, () => {
          const fallback = user.displayName ?? user.email?.split("@")[0] ?? "Employee";
          applyName(fallback, "Employee");
        });
      } catch {
        const fallback = user.displayName ?? (user.email?.split("@")[0] ?? "Employee");
        applyName(fallback, "Employee");
      }
    });

    return () => { authUnsub(); if (empUnsub) empUnsub(); };
  }, []);

  // Listen for same-session photo upload events
  useEffect(() => {
    if (auth.currentUser?.photoURL) setEmpPhoto(auth.currentUser.photoURL);
    function onPhotoEvent(e: Event) {
      const url = (e as CustomEvent<{ url: string }>).detail?.url ?? "";
      setEmpPhoto(url);
      setPhotoError("");
    }
    window.addEventListener("employeePhotoUpdated", onPhotoEvent);
    return () => window.removeEventListener("employeePhotoUpdated", onPhotoEvent);
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
    try { await signOut(auth); } catch { /* ignore */ }
    // Replace (not push) so the dashboard can't be returned to via Back.
    window.location.replace("/");
  }

  return (
    <aside className="w-[260px] min-h-screen bg-[#0B1929] flex flex-col pt-8 pb-6 px-4">
      {/* Logo */}
      <div className="mb-6 mt-1 flex items-center justify-center">
        <span className="text-4xl font-black text-white leading-none" style={{ fontFamily: "var(--font-inter), 'Inter', sans-serif", letterSpacing: "-0.6px" }}>WO</span>
        <span className="text-4xl font-black leading-none" style={{ fontFamily: "var(--font-inter), 'Inter', sans-serif", letterSpacing: "-0.6px", color: "#00C2A8" }}>WAYS</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 mt-2">
        {navItems.map(({ label, href, icon: Icon, notifType }) => {
          const isActive =
            pathname === href ||
            (href !== "/employee/dashboard" && pathname.startsWith(href));
          const badge = notifType ? (counts[notifType] ?? 0) : 0;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-white/15 text-white font-semibold"
                  : "text-gray-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={18} aria-hidden="true" />
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

      {/* Employee info at bottom */}
      <div className="border-t border-white/10 pt-4 mt-4">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
            {empPhoto && !photoError ? (
              <img
                key={empPhoto}
                src={empPhoto}
                alt={empName}
                className="w-full h-full object-cover"
                onError={() => setPhotoError(empPhoto)}
              />
            ) : (
              <div className="w-full h-full bg-white/20 flex items-center justify-center text-white font-semibold text-xs">
                {initials || <User size={14} />}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {empName || "Loading…"}
            </p>
            {empDept && <p className="text-xs text-gray-400 truncate">{empDept}</p>}
            {empRole && <p className="text-xs text-gray-400 truncate">{empRole}</p>}
            {!empRole && !empDept && <p className="text-xs text-gray-400">Employee</p>}
          </div>
          <button onClick={handleLogout} title="Logout" className="shrink-0">
            <LogOut size={16} className="text-gray-400 hover:text-red-400 transition-colors" />
          </button>
        </div>
      </div>
    </aside>
  );
}
