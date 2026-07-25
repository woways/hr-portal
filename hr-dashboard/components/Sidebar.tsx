"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Clock,
  CalendarOff,
  Target,
  IndianRupee,
  BarChart3,
  Bell,
  Settings,
  HelpCircle,
  LogOut,
  FolderOpen,
} from "lucide-react";

const navItems = [
  { label: "Dashboard",           href: "/dashboard",               icon: LayoutDashboard, notifType: null        },
  { label: "Employees",           href: "/dashboard/employees",     icon: Users,           notifType: null        },
  { label: "Recruitment",         href: "/dashboard/recruitment",   icon: Briefcase,       notifType: null        },
  { label: "Attendance",          href: "/dashboard/attendance",    icon: Clock,           notifType: "attendance"},
  { label: "Leave Management",    href: "/dashboard/leave",         icon: CalendarOff,     notifType: "leave"     },
  { label: "Goals / KPIs",        href: "/dashboard/goals",         icon: Target,          notifType: "goal"      },
  { label: "Payroll",             href: "/dashboard/compensation",  icon: IndianRupee,     notifType: "payroll"   },
  { label: "Documents",           href: "/dashboard/documents",     icon: FolderOpen,      notifType: "document"  },
  { label: "Reports & Analytics", href: "/dashboard/reports",       icon: BarChart3,       notifType: null        },
  { label: "Notifications",       href: "/dashboard/notifications", icon: Bell,            notifType: "_total"    },
  { label: "Help & Support",      href: "/dashboard/help",          icon: HelpCircle,      notifType: "help"      },
  { label: "Settings",            href: "/dashboard/settings",      icon: Settings,        notifType: null        },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Record<string, number>>({});

  async function handleLogout() {
    try { await signOut(auth); } catch { /* ignore */ }
    // Replace (not push) so the dashboard can't be returned to via Back.
    window.location.replace("/");
  }

  useEffect(() => {
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", "HR_PORTAL")
    );
    const unsub = onSnapshot(q, (snap) => {
      const map: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.read === true) return;
        map._total = (map._total ?? 0) + 1;
        const t = data.type as string;
        if (t === "system" || t === "query") {
          map.help = (map.help ?? 0) + 1;
        } else if (t) {
          map[t] = (map[t] ?? 0) + 1;
        }
      });
      setCounts(map);
    }, () => {});
    return unsub;
  }, []);

  return (
    <aside className="w-[260px] h-screen bg-[#0B1929] flex flex-col pt-7 pb-5 px-4">
      <div className="mb-4 mt-1 shrink-0 flex items-center justify-center">
        <span className="text-4xl font-black text-white leading-none" style={{ fontFamily: "var(--font-inter), 'Inter', sans-serif", letterSpacing: "-0.6px" }}>WO</span>
        <span className="text-4xl font-black leading-none" style={{ fontFamily: "var(--font-inter), 'Inter', sans-serif", letterSpacing: "-0.6px", color: "#00C2A8" }}>WAYS</span>
      </div>
      <nav className="flex-1 overflow-y-auto space-y-0.5 pr-1 scrollbar-thin mt-2">
        {navItems.map(({ label, href, icon: Icon, notifType }) => {
          const isActive =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));
          const badge = notifType ? (counts[notifType] ?? 0) : 0;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-white/15 text-white font-semibold"
                  : "text-gray-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={17} className="shrink-0" />
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
      <div className="border-t border-white/10 pt-3 mt-3 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-xs shrink-0">
            HA
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">HR Admin</p>
            <p className="text-xs text-gray-400">Admin</p>
          </div>
          <button onClick={handleLogout} title="Logout">
            <LogOut size={16} className="text-gray-400 hover:text-red-400 transition-colors" />
          </button>
        </div>
      </div>
    </aside>
  );
}
