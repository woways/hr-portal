"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getDocs, collection, doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { IndianRupee, Users, TrendingDown, Banknote, Eye, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PayrollRecord } from "@/lib/types";
import { SkeletonStatGrid, SkeletonTableRows } from "@/components/Skeleton";

function getInitials(name: string) {
  const parts = name.trim().split(" ");
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
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
  const [payrollData, setPayrollData] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        const snap = await getDocs(collection(db, "compensation"));
        const records: PayrollRecord[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const salary   = Number(data.salary   ?? 0);
          const incentive= Number(data.incentive ?? 0);
          const bonus    = Number(data.bonus     ?? 0);
          const deductions = Number(data.deductions ?? 0);
          const basic    = salary;
          const allowances = incentive + bonus;
          // Always derive net from the same components shown per row, so the
          // dashboard aggregate reconciles exactly with the employee table sum.
          // (A stored netPay could diverge from basic+allowances-deductions or be
          // a non-numeric string → NaN, breaking the totals.)
          const netSalary  = basic + allowances - deductions;
          return {
            id:            d.id,
            employeeId:    String(data.empId      ?? data.employeeId ?? ""),
            employeeName:  String(data.name       ?? data.employeeName ?? ""),
            department:    String(data.department ?? ""),
            month:         String(data.month      ?? ""),
            basic,
            allowances,
            deductions,
            netSalary,
            paymentStatus: (data.paymentStatus as "Paid" | "Pending") ?? "Pending",
            paymentDate:   String(data.paymentDate ?? ""),
          } satisfies PayrollRecord;
        });
        setPayrollData(records);
      } catch { /* ignore */ } finally { setLoading(false); }
    });
    return unsub;
  }, []);

  const filtered = payrollData.filter((r) => r.month === selectedMonth);

  const totalCost       = filtered.reduce((s, r) => s + r.netSalary, 0);
  const totalPaid       = filtered.filter((r) => r.paymentStatus === "Paid").length;
  const totalDeductions = filtered.reduce((s, r) => s + r.deductions, 0);
  const netSalaryPaid   = filtered
    .filter((r) => r.paymentStatus === "Paid")
    .reduce((s, r) => s + r.netSalary, 0);

  async function handleRunPayroll() {
    setPayrollProcessed(true);
    try {
      await setDoc(
        doc(db, "payroll", selectedMonth.replace(/\s+/g, "-")),
        {
          month:       selectedMonth,
          processedAt: new Date().toISOString(),
          processedBy: auth.currentUser?.email ?? "HR",
        },
        { merge: true }
      );
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonStatGrid count={4} cols="grid-cols-2 md:grid-cols-4" />
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="h-4 w-40 bg-gray-200/70 animate-pulse rounded" />
          </div>
          <table className="w-full">
            <tbody>
              <SkeletonTableRows rows={6} cols={6} />
            </tbody>
          </table>
        </div>
      </div>
    );
  }

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
            onClick={handleRunPayroll}
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
                icon: IndianRupee,
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
                label: "Net Payroll Paid",
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
              <h2 className="text-base font-semibold text-gray-900">Employee Payroll Table</h2>
              <span className="text-xs text-gray-400">Period: {selectedMonth}</span>
            </div>

            {filtered.length === 0 ? (
              <EmptyState icon={Banknote} title="No records found" subtitle="No payroll records for this month. Add payroll records in the Payroll module first." />
            ) : (
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
                      Net Payroll
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((rec) => (
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
                        <button
                          disabled={rec.paymentStatus !== "Paid"}
                          title={rec.paymentStatus !== "Paid" ? "Payslip available once payroll is finalized (Paid)" : "View payslip"}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4F3CC9] bg-[#EDE9FF] rounded-lg hover:bg-[#DDD6FE] transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#EDE9FF]"
                        >
                          <Eye size={13} />
                          {rec.paymentStatus === "Paid" ? "View" : "Pending"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
