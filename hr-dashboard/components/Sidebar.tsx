"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
  { label: "Compensation",        href: "/dashboard/compensation",  icon: IndianRupee,     notifType: "payroll"   },
  { label: "Documents",           href: "/dashboard/documents",     icon: FolderOpen,      notifType: "document"  },
  { label: "Reports & Analytics", href: "/dashboard/reports",       icon: BarChart3,       notifType: null        },
  { label: "Notifications",       href: "/dashboard/notifications", icon: Bell,            notifType: "_total"    },
  { label: "Help & Support",      href: "/dashboard/help",          icon: HelpCircle,      notifType: "help"      },
  { label: "Settings",            href: "/dashboard/settings",      icon: Settings,        notifType: null        },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Record<string, number>>({});

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
        // "system" and "query" both come from employee help/support submissions
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
    <aside className="w-[260px] h-screen bg-white dark:bg-[#13132a] border-r border-gray-100 dark:border-[#252545] flex flex-col pt-4 pb-5 px-4">
      <div className="mb-4 shrink-0 flex items-center justify-center">
        <span className="text-4xl font-black text-[#0B1929] dark:text-white tracking-tight leading-none">WO</span>
        <span className="text-4xl font-black text-[#14B8A6] tracking-tight leading-none">WAYS</span>
      </div>
      <nav className="flex-1 overflow-y-auto space-y-0.5 pr-1 scrollbar-thin">
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
                  ? "bg-[#EDE9FF] dark:bg-[#2a2050] text-[#4F3CC9] dark:text-purple-300 font-semibold"
                  : "text-[#4A4A6A] dark:text-gray-400 hover:bg-[#F5F3FF] dark:hover:bg-[#1e1e38]"
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
      <div className="border-t border-gray-100 dark:border-[#252545] pt-3 mt-3 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[#EDE9FF] dark:bg-[#2a2050] flex items-center justify-center text-[#4F3CC9] dark:text-purple-300 font-semibold text-xs shrink-0">
            HA
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">HR Admin</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Admin</p>
          </div>
          <Link href="/" title="Logout">
            <LogOut size={16} className="text-gray-400 hover:text-red-500 transition-colors" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
