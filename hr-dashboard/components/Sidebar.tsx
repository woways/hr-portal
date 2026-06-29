"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Clock,
  CalendarOff,
  Target,
  DollarSign,
  BarChart3,
  Bell,
  Settings,
  HelpCircle,
  LogOut,
  FolderOpen,
} from "lucide-react";

const navItems = [
  { label: "Dashboard",          href: "/dashboard",               icon: LayoutDashboard },
  { label: "Employees",          href: "/dashboard/employees",     icon: Users           },
  { label: "Recruitment",        href: "/dashboard/recruitment",   icon: Briefcase       },
  { label: "Attendance",         href: "/dashboard/attendance",    icon: Clock           },
  { label: "Leave Management",   href: "/dashboard/leave",         icon: CalendarOff     },
  { label: "Goals / KPIs",       href: "/dashboard/goals",         icon: Target          },
  { label: "Compensation",       href: "/dashboard/compensation",  icon: DollarSign      },
  { label: "Documents",          href: "/dashboard/documents",     icon: FolderOpen      },
  { label: "Reports & Analytics",href: "/dashboard/reports",       icon: BarChart3       },
  { label: "Notifications",      href: "/dashboard/notifications", icon: Bell            },
  { label: "Help & Support",     href: "/dashboard/help",          icon: HelpCircle      },
  { label: "Settings",           href: "/dashboard/settings",      icon: Settings        },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-[260px] h-screen bg-white border-r border-gray-100 flex flex-col py-5 px-4">
      <div className="mb-5 px-2 shrink-0">
        <img src="/woways-logo.svg" alt="Woways" className="h-9 w-auto" />
      </div>
      <nav className="flex-1 overflow-y-auto space-y-0.5 pr-1 scrollbar-thin">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-[#EDE9FF] text-[#4F3CC9] font-semibold"
                  : "text-[#4A4A6A] hover:bg-[#F5F3FF]"
              }`}
            >
              <Icon size={17} className="shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-100 pt-3 mt-3 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-semibold text-xs shrink-0">
            HA
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">HR Admin</p>
            <p className="text-xs text-gray-400">Super Admin</p>
          </div>
          <Link href="/" title="Logout">
            <LogOut size={16} className="text-gray-400 hover:text-red-500 transition-colors" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
