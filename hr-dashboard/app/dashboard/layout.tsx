import Sidebar from "@/components/Sidebar";
import ThemeToggle from "@/components/ThemeToggle";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-[#F5F3FF] dark:bg-[#0d0d1f] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — theme toggle lives here */}
        <div className="flex justify-end items-center px-6 h-10 shrink-0 border-b border-gray-100 dark:border-[#252545] bg-white/70 dark:bg-[#13132a]/70 backdrop-blur-sm">
          <ThemeToggle />
        </div>
        <main className="flex-1 overflow-y-auto p-8 dark:bg-[#0d0d1f]">{children}</main>
      </div>
    </div>
  );
}
