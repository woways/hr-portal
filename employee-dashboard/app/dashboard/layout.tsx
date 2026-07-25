import Sidebar from "@/components/Sidebar";
import AuthGate from "@/components/AuthGate";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate loginPath="/login">
      <div className="flex h-screen bg-[#F5F3FF] overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </AuthGate>
  );
}
