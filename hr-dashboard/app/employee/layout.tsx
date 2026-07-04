import EmployeeSidebar from "@/components/EmployeeSidebar";
import ThemeToggle from "@/components/ThemeToggle";

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[#F5F3FF] dark:bg-[#0d0d1f] overflow-hidden">
      <EmployeeSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex justify-end items-center px-6 h-10 shrink-0 border-b border-gray-100 dark:border-[#252545] bg-white/70 dark:bg-[#13132a]/70 backdrop-blur-sm">
          <ThemeToggle />
        </div>
        <main className="flex-1 overflow-y-auto p-8 dark:bg-[#0d0d1f]">{children}</main>
      </div>
    </div>
  );
}
