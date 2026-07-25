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
  { label: "Payroll",       href: "/dashboard/compensation",  icon: DollarSign,      notifType: "payroll"    },
  { label: "Help & Support",href: "/dashboard/help",          icon: HelpCircle,      notifType: null         },
];

interface EmpInfo { name: string; id: string; department: string; role: string; photoURL?: string; }

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const [emp,           setEmp]           = useState<EmpInfo | null>(null);
  const [photoURL,      setPhotoURL]      = useState<string>("");
  const [photoError,    setPhotoError]    = useState<string>("");
  const [notifEmpId,    setNotifEmpId]    = useState<string>("");
  const [loading,    setLoading]    = useState(true);
  const [counts,     setCounts]     = useState<Record<string, number>>({});

  useEffect(() => {
    let empUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, async (user) => {
      if (empUnsub) { empUnsub(); empUnsub = null; }
      if (!user) { router.replace("/login"); setLoading(false); return; }

      const CACHE = "emp_sidebar_v2";

      try {
        const raw = sessionStorage.getItem(CACHE);
        if (raw) {
          const cached = JSON.parse(raw) as { name: string; id: string; department?: string; role?: string; photoURL?: string; notifId?: string; uid: string };
          if (cached.uid === user.uid) {
            setEmp({ name: cached.name, id: cached.id, department: cached.department ?? "", role: cached.role ?? "", photoURL: cached.photoURL });
            if (cached.photoURL) { setPhotoURL(cached.photoURL); setPhotoError(""); }
            setNotifEmpId(cached.notifId || cached.id);
            setLoading(false);
          }
        }
      } catch { /* ignore */ }

      try {
        let notifId = "";
        let emailEmpId = "";
        if (user.email) {
          const emailSnap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!emailSnap.empty) {
            notifId = emailSnap.docs[0].id;
            emailEmpId = emailSnap.docs[0].id;
          }
        }

        const userSnap = await getDoc(doc(db, "users", user.uid));
        let eidFromUsers = "";
        if (userSnap.exists()) {
          eidFromUsers = (userSnap.data().employeeId as string) ?? "";
        }

        // Prefer emailEmpId (found by email query = actual Firestore doc ID).
        // Fall back to eidFromUsers (from users/{uid}.employeeId).
        const eid = emailEmpId || eidFromUsers;

        if (!eid) {
          await signOut(auth);
          router.replace("/login?reason=account-removed");
          setLoading(false);
          return;
        }
        if (!notifId) notifId = eid;
        setNotifEmpId(notifId);

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
          const photo = (data.photoURL as string) ?? "";
          // Set photoURL directly — don't rely on useEffect intermediary
          if (photo) { setPhotoURL(photo); setPhotoError(""); }
          setEmp({ name, id: eid, department, role, photoURL: photo });
          sessionStorage.setItem(CACHE, JSON.stringify({ name, id: eid, department, role, photoURL: photo, notifId, uid: user.uid }));
          setLoading(false);
        }, () => { setLoading(false); });
      } catch {
        setLoading(false);
      }
    });

    return () => { authUnsub(); if (empUnsub) empUnsub(); };
  }, []);

  useEffect(() => {
    // Seed from Firebase Auth on first mount (fastest — no Firestore round-trip)
    if (auth.currentUser?.photoURL) setPhotoURL(auth.currentUser.photoURL);

    function onPhotoEvent(e: Event) {
      const url = (e as CustomEvent<{ url: string }>).detail?.url ?? "";
      setPhotoURL(url);
      setPhotoError("");
      // Also update session cache so next load shows the photo immediately
      try {
        const raw = sessionStorage.getItem("emp_sidebar_v2");
        if (raw) {
          const cached = JSON.parse(raw);
          sessionStorage.setItem("emp_sidebar_v2", JSON.stringify({ ...cached, photoURL: url }));
        }
      } catch { /* ignore */ }
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
    sessionStorage.removeItem("emp_sidebar_v1");
    try { await signOut(auth); } catch { /* ignore */ }
    // Replace (not push) so the dashboard can't be returned to via Back.
    window.location.replace("/login");
  }

  const initials = emp?.name
    ? emp.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <aside className="w-[260px] min-h-screen bg-[#0B1929] flex flex-col pt-8 pb-6 px-4">
      <div className="mb-6 mt-1 flex items-center justify-center">
        <span className="text-4xl font-black text-white leading-none" style={{ fontFamily: "var(--font-inter), 'Inter', sans-serif", letterSpacing: "-0.6px" }}>WO</span>
        <span className="text-4xl font-black leading-none" style={{ fontFamily: "var(--font-inter), 'Inter', sans-serif", letterSpacing: "-0.6px", color: "#00C2A8" }}>WAYS</span>
      </div>

      <nav className="flex-1 space-y-1 mt-2">
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
                  ? "bg-white/15 text-white font-semibold"
                  : "text-gray-400 hover:bg-white/10 hover:text-white"
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

      <div className="border-t border-white/10 pt-4 mt-4">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
            {photoURL && !photoError ? (
              <img
                key={photoURL}
                src={photoURL}
                alt={emp?.name ?? ""}
                className="w-full h-full object-cover"
                onError={() => setPhotoError(photoURL)}
              />
            ) : (
              <div className="w-full h-full bg-white/20 flex items-center justify-center text-white font-bold text-xs">
                {loading ? "…" : initials}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {loading ? (
              <>
                <div className="h-3.5 w-24 bg-white/10 rounded animate-pulse mb-1.5" />
                <div className="h-3 w-16 bg-white/10 rounded animate-pulse" />
              </>
            ) : emp ? (
              <>
                <p className="text-sm font-semibold text-white truncate">{emp.name}</p>
                {emp.department && <p className="text-xs text-gray-400 truncate">{emp.department}</p>}
                {emp.role && <p className="text-xs text-gray-400 truncate">{emp.role}</p>}
                {!emp.role && !emp.department && <p className="text-xs text-gray-400">Employee</p>}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-white">Employee</p>
                <p className="text-xs text-gray-400">—</p>
              </>
            )}
          </div>
          <button
            onClick={handleLogout}
            title="Logout"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 transition-colors shrink-0"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
