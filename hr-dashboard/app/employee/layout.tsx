import EmployeeSidebar from "@/components/EmployeeSidebar";

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[#F5F3FF] overflow-hidden">
      <EmployeeSidebar />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
