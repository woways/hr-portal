"use client";
import { useState } from "react";
import { DollarSign, Users, TrendingDown, Banknote, Eye } from "lucide-react";
import { PayrollRecord } from "@/lib/types";
const mockPayroll: PayrollRecord[] = [];

function getInitials(name: string) {
  const parts = name.trim().split(" ");
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function generateMonths(count = 12): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toLocaleString("en-IN", { month: "long", year: "numeric" }));
  }
  return months;
}
const MONTHS = generateMonths(12);

export default function PayrollPage() {
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[MONTHS.length - 1]);
  const [payrollProcessed, setPayrollProcessed] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const totalCost = mockPayroll.reduce((s, r) => s + r.netSalary, 0);
  const totalPaid = mockPayroll.filter((r) => r.paymentStatus === "Paid").length;
  const totalDeductions = mockPayroll.reduce((s, r) => s + r.deductions, 0);
  const netSalaryPaid = mockPayroll
    .filter((r) => r.paymentStatus === "Paid")
    .reduce((s, r) => s + r.netSalary, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Payroll Management</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage employee salaries and payroll processing.
          </p>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowMonthPicker(!showMonthPicker)}
            className="flex items-center gap-2 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            SELECT PAYROLL MONTH: <span className="font-semibold text-[#4F3CC9]">{selectedMonth}</span>
          </button>
          {showMonthPicker && (
            <div className="absolute right-0 top-12 bg-white border border-gray-100 rounded-xl shadow-lg z-10 min-w-[180px] py-1">
              {MONTHS.map((m) => (
                <button
                  key={m}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[#F5F3FF] transition-colors ${
                    m === selectedMonth ? "text-[#4F3CC9] font-semibold bg-[#EDE9FF]" : "text-gray-700"
                  }`}
                  onClick={() => {
                    setSelectedMonth(m);
                    setShowMonthPicker(false);
                    setPayrollProcessed(false);
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!payrollProcessed ? (
        /* Not Processed State */
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-[#EDE9FF] flex items-center justify-center mb-6">
            <Banknote size={36} className="text-[#4F3CC9]" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Payroll Not Processed</h2>
          <p className="text-gray-500 text-sm max-w-sm mb-8">
            The payroll for <strong>{selectedMonth}</strong> has not been processed yet. Click the
            button below to calculate and run payroll for all employees.
          </p>
          <button
            onClick={() => setPayrollProcessed(true)}
            className="bg-[#4F3CC9] text-white rounded-full px-8 py-3 text-sm font-medium hover:bg-[#3d2fa0] transition-colors"
          >
            Run Payroll for {selectedMonth}
          </button>
        </div>
      ) : (
        /* Processed State */
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              {
                label: "Total Payroll Cost",
                value: formatCurrency(totalCost),
                icon: DollarSign,
                color: "text-purple-600",
                bg: "bg-purple-100",
              },
              {
                label: "Employees Paid",
                value: String(totalPaid),
                icon: Users,
                color: "text-green-600",
                bg: "bg-green-100",
              },
              {
                label: "Total Deductions",
                value: formatCurrency(totalDeductions),
                icon: TrendingDown,
                color: "text-red-600",
                bg: "bg-red-100",
              },
              {
                label: "Net Salary Paid",
                value: formatCurrency(netSalaryPaid),
                icon: Banknote,
                color: "text-blue-600",
                bg: "bg-blue-100",
              },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div
                key={label}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4"
              >
                <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center`}>
                  <Icon size={22} className={color} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Salary Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Employee Salary Table</h2>
              <span className="text-xs text-gray-400">Period: {selectedMonth}</span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8F7FF]">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    Emp ID
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    Employee
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    Dept
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    Basic
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    Allowances
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    Deductions
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    Net Salary
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {mockPayroll.map((rec) => (
                  <tr key={rec.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3 text-sm text-gray-600">{rec.employeeId}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-semibold text-xs">
                          {getInitials(rec.employeeName)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{rec.employeeName}</p>
                          <p className="text-xs text-gray-400">
                            {rec.paymentStatus === "Paid" ? (
                              <span className="text-green-600">Paid</span>
                            ) : (
                              <span className="text-yellow-600">Pending</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">{rec.department}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{formatCurrency(rec.basic)}</td>
                    <td className="px-5 py-3 text-sm font-medium text-green-600">
                      +{formatCurrency(rec.allowances)}
                    </td>
                    <td className="px-5 py-3 text-sm font-medium text-red-500">
                      -{formatCurrency(rec.deductions)}
                    </td>
                    <td className="px-5 py-3 text-sm font-bold text-gray-900">
                      {formatCurrency(rec.netSalary)}
                    </td>
                    <td className="px-5 py-3">
                      <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4F3CC9] bg-[#EDE9FF] rounded-lg hover:bg-[#DDD6FE] transition-colors">
                        <Eye size={13} />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
