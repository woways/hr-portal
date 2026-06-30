"use client";
import { useState, useEffect } from "react";
import { Pencil, FileText, Plus, X, Search, Loader2 } from "lucide-react";
import { getCompensation, addCompensation, updateCompensation, getIncentives, addIncentive, getEmployees } from "@/lib/firebaseService";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

type PaymentStatus = "Paid" | "Pending" | "Processing";

interface CompRecord {
  id: string; name: string; empId: string; designation: string; empType: string;
  salary: number; incentive: number; bonus: number; deductions: number; netPay: number;
  paymentStatus: PaymentStatus; paymentDate: string; month: string;
}

interface Incentive {
  id: string; month: string; employee: string; type: string;
  amount: number; basis: string; status: "Approved" | "Pending";
}

interface EmpOption { id: string; name: string; empId: string; designation: string; department: string; }

const initRecords: CompRecord[] = [];


const initIncentives: Incentive[] = [];

const payStatusColor: Record<PaymentStatus, string> = {
  Paid: "bg-green-100 text-green-700",
  Pending: "bg-yellow-100 text-yellow-700",
  Processing: "bg-blue-100 text-blue-700",
};

function fmt(n: number) { return `₹${n.toLocaleString("en-IN")}`; }

type EditForm = { salary: number; incentive: number; bonus: number; deductions: number; netPay: number; paymentStatus: PaymentStatus; paymentDate: string; designation: string; empType: string; month: string; };

const CURRENT_MONTH_LABEL = new Date().toLocaleString("en-IN", { month: "long", year: "numeric" });
const blankAdd = { name: "", salary: 0, incentive: 0, bonus: 0, deductions: 0, netPay: 0, paymentDate: "", paymentMethod: "Bank Transfer", paymentStatus: "Pending" as PaymentStatus, designation: "", empType: "Full-Time", month: CURRENT_MONTH_LABEL };
const blankInc = { month: CURRENT_MONTH_LABEL, employee: "", type: "", amount: 0, basis: "" };

function downloadCSV(filename: string, rows: string[][], headers: string[]) {
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: filename });
  a.click(); URL.revokeObjectURL(a.href);
}

export default function CompensationPage() {
  const [records, setRecords] = useState<CompRecord[]>(initRecords);
  const [incentives, setIncentives] = useState<Incentive[]>(initIncentives);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...blankAdd, empId: "" });
  const [showIncentive, setShowIncentive] = useState(false);
  const [incForm, setIncForm] = useState({ ...blankInc });
  const [toast, setToast] = useState<string | null>(null);
  const [empList, setEmpList] = useState<EmpOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load employees + existing compensation & incentives from Firestore
  useEffect(() => {
    async function load() {
      try {
        const [empDocs, comps, incs] = await Promise.all([
          getEmployees(),
          getCompensation(),
          getIncentives(),
        ]);
        const emps = empDocs.map((d) => { const r = d as Record<string, unknown>; return { id: (r.employeeId ?? r.id) as string, name: (r.name as string) ?? "", designation: (r.designation as string) ?? "", department: (r.department as string) ?? "" }; });
        setEmpList(emps.map((e) => ({ id: e.id, name: e.name, empId: e.id, designation: e.designation, department: e.department })));
        setRecords(comps.map((c) => c as unknown as CompRecord));
        setIncentives(incs.map((i) => i as unknown as Incentive));
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function showMsg(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  async function handleAddComp() {
    if (!addForm.name || !addForm.empId || saving) return;
    setSaving(true);
    try {
      const netPay = addForm.netPay || (addForm.salary + addForm.incentive + addForm.bonus - addForm.deductions);
      const data = {
        name: addForm.name, empId: addForm.empId,
        designation: addForm.designation, empType: addForm.empType,
        salary: addForm.salary, incentive: addForm.incentive,
        bonus: addForm.bonus, deductions: addForm.deductions, netPay,
        paymentStatus: addForm.paymentStatus, paymentDate: addForm.paymentDate,
        month: addForm.month,
      };
      const docId = await addCompensation(data);
      setRecords((p) => [...p, { id: docId, ...data, paymentStatus: data.paymentStatus as PaymentStatus }]);
      setShowAdd(false);
      setAddForm({ ...blankAdd, empId: "" });
      showMsg("Compensation record saved.");
    } catch { showMsg("Failed to save. Please try again."); }
    finally { setSaving(false); }
  }

  async function handleAddIncentive() {
    if (!incForm.type || !incForm.amount || saving) return;
    setSaving(true);
    try {
      const data = { month: incForm.month, employee: incForm.employee, type: incForm.type, amount: incForm.amount, basis: incForm.basis, status: "Pending" as const };
      const docId = await addIncentive(data);
      setIncentives((p) => [...p, { id: docId, ...data }]);
      setShowIncentive(false);
      setIncForm({ ...blankInc });
      showMsg("Incentive added and pending approval.");
    } catch { showMsg("Failed to save incentive."); }
    finally { setSaving(false); }
  }

  // Payroll search filter
  const [empIdSearch, setEmpIdSearch] = useState("");

  // Edit record
  const [editRecord, setEditRecord] = useState<CompRecord | null>(null);
  const [editForm, setEditForm]     = useState<EditForm | null>(null);

  function openEdit(r: CompRecord) {
    setEditRecord(r);
    setEditForm({ salary: r.salary, incentive: r.incentive, bonus: r.bonus, deductions: r.deductions, netPay: r.netPay, paymentStatus: r.paymentStatus, paymentDate: r.paymentDate, designation: r.designation, empType: r.empType, month: r.month });
  }

  async function saveEdit() {
    if (!editRecord || !editForm || saving) return;
    setSaving(true);
    try {
      await updateCompensation(editRecord.id, editForm as unknown as Record<string, unknown>);
      setRecords(records.map((r) => r.id === editRecord.id ? { ...r, ...editForm } : r));
      setEditRecord(null); setEditForm(null);
      showMsg("Compensation updated.");
    } catch { showMsg("Failed to update."); }
    finally { setSaving(false); }
  }

  // Payslip modal (document button)
  const [payslipModal, setPayslipModal] = useState<CompRecord | null>(null);

  const totalPayroll  = records.reduce((s, r) => s + r.netPay, 0);
  const incentivesPaid = records.reduce((s, r) => s + r.incentive, 0);
  const pendingPay    = records.filter((r) => r.paymentStatus !== "Paid").reduce((s, r) => s + r.netPay, 0);
  const avgSalary     = records.length ? Math.round(records.reduce((s, r) => s + r.salary, 0) / records.length) : 0;

  // Department-wise payroll — join compensation records with employee list to get department
  const deptPayroll = (() => {
    const map: Record<string, number> = {};
    records.forEach((r) => {
      const emp = empList.find((e) => e.empId === r.empId);
      const dept = emp?.department || "Other";
      map[dept] = (map[dept] || 0) + r.netPay;
    });
    return Object.entries(map)
      .map(([dept, total]) => ({ dept, total }))
      .sort((a, b) => b.total - a.total);
  })();

  const topDept = deptPayroll.length > 0 ? deptPayroll[0].dept : "—";

  const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]";

  function PayslipCard({ emp }: { emp: CompRecord }) {
    const grossEarnings = emp.salary + emp.incentive + emp.bonus;
    return (
      <div className="border border-gray-200 rounded-2xl p-6 max-w-2xl mx-auto">
        <div className="text-center border-b pb-4 mb-4">
          <h3 className="text-lg font-bold text-[#4F3CC9]">Woways</h3>
          <p className="text-xs text-gray-400">Payslip for {emp.month}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
          <div><p className="text-xs text-gray-400">Employee Name</p><p className="font-medium">{emp.name}</p></div>
          <div><p className="text-xs text-gray-400">Employee ID</p><p className="font-medium">{emp.empId}</p></div>
          <div><p className="text-xs text-gray-400">Designation</p><p className="font-medium">{emp.designation}</p></div>
          <div><p className="text-xs text-gray-400">Emp Type</p><p className="font-medium">{emp.empType}</p></div>
          <div><p className="text-xs text-gray-400">Payment Status</p>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${payStatusColor[emp.paymentStatus]}`}>{emp.paymentStatus}</span>
          </div>
          <div><p className="text-xs text-gray-400">Payment Date</p><p className="font-medium">{emp.paymentDate || "—"}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Earnings</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Basic Salary</span><span className="font-medium">{fmt(emp.salary)}</span></div>
              {emp.incentive > 0 && <div className="flex justify-between"><span className="text-gray-600">Incentive</span><span className="font-medium">{fmt(emp.incentive)}</span></div>}
              {emp.bonus > 0 && <div className="flex justify-between"><span className="text-gray-600">Bonus</span><span className="font-medium">{fmt(emp.bonus)}</span></div>}
              <div className="flex justify-between font-semibold border-t pt-1.5 mt-1"><span>Gross Total</span><span>{fmt(grossEarnings)}</span></div>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Deductions</p>
            <div className="space-y-1.5 text-sm">
              {emp.deductions > 0
                ? <div className="flex justify-between"><span className="text-gray-600">Total Deductions</span><span className="font-medium text-red-500">{fmt(emp.deductions)}</span></div>
                : <div className="text-gray-400 text-xs">No deductions</div>
              }
              <div className="flex justify-between font-semibold border-t pt-1.5 mt-1"><span>Total</span><span className="text-red-500">{fmt(emp.deductions)}</span></div>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Net Pay</p>
            <p className="text-2xl font-bold text-[#4F3CC9]">{fmt(emp.netPay)}</p>
          </div>
          <button
            onClick={() => {
              const grossEarnings = emp.salary + emp.incentive + emp.bonus;
              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payslip – ${emp.month}</title>
<style>body{font-family:Arial,sans-serif;padding:32px;color:#111}h2{color:#4F3CC9;margin:0 0 4px}.sub{color:#6b7280;font-size:12px;margin-bottom:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}.cell .lbl{font-size:11px;color:#6b7280}.cell .val{font-size:13px;font-weight:600}.section{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#374151;margin:16px 0 8px}.row{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid #f3f4f6}.row.total{font-weight:700;border-top:2px solid #e5e7eb;border-bottom:none;margin-top:4px;padding-top:8px}.net{margin-top:20px;background:#ede9ff;border-radius:10px;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}.net-lbl{font-size:12px;color:#6b7280}.net-amt{font-size:26px;font-weight:700;color:#4F3CC9}.footer{margin-top:20px;font-size:10px;color:#9ca3af;text-align:center}@media print{body{padding:0}@page{margin:20mm}}</style></head><body>
<h2>Woways</h2><div class="sub">Payslip for ${emp.month}</div>
<div class="grid">
<div class="cell"><div class="lbl">Employee Name</div><div class="val">${emp.name}</div></div>
<div class="cell"><div class="lbl">Employee ID</div><div class="val">${emp.empId}</div></div>
<div class="cell"><div class="lbl">Designation</div><div class="val">${emp.designation || "—"}</div></div>
<div class="cell"><div class="lbl">Emp Type</div><div class="val">${emp.empType}</div></div>
<div class="cell"><div class="lbl">Payment Status</div><div class="val">${emp.paymentStatus}</div></div>
<div class="cell"><div class="lbl">Payment Date</div><div class="val">${emp.paymentDate || "—"}</div></div>
</div>
<div class="section">Earnings</div>
<div class="row"><span>Basic Salary</span><span>₹${emp.salary.toLocaleString("en-IN")}</span></div>
${emp.incentive > 0 ? `<div class="row"><span>Incentive</span><span>₹${emp.incentive.toLocaleString("en-IN")}</span></div>` : ""}
${emp.bonus > 0 ? `<div class="row"><span>Bonus</span><span>₹${emp.bonus.toLocaleString("en-IN")}</span></div>` : ""}
<div class="row total"><span>Gross Salary</span><span>₹${grossEarnings.toLocaleString("en-IN")}</span></div>
<div class="section">Deductions</div>
${emp.deductions > 0 ? `<div class="row"><span>Total Deductions</span><span style="color:#ef4444">- ₹${emp.deductions.toLocaleString("en-IN")}</span></div>` : `<div class="row"><span style="color:#9ca3af">No deductions this month</span></div>`}
<div class="net"><div class="net-lbl">Net Salary</div><div class="net-amt">₹${emp.netPay.toLocaleString("en-IN")}</div></div>
<div class="footer">This is a system-generated salary slip and does not require a physical signature. | Woways | ${emp.month}</div>
<script>window.onload=function(){window.print()}<\/script></body></html>`;
              const win = window.open("", "_blank");
              if (win) { win.document.write(html); win.document.close(); }
            }}
            className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-[#3d2fa8] transition">
            <FileText size={14} /> Download Payslip
          </button>
        </div>
      </div>
    );
  }

  const TABS = ["Department-wise Payroll", "Compensation Records", "Incentive Management", "Payrolls"] as const;
  type Tab = typeof TABS[number];
  const [activeTab, setActiveTab] = useState<Tab>("Department-wise Payroll");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compensation</h1>
          <p className="text-gray-500 text-sm mt-1">Manage payroll, incentives and compensation records</p>
        </div>
      </div>

      {/* Analytics Cards — always visible */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Total Monthly Payroll", value: fmt(totalPayroll),   color: "bg-purple-50 border-purple-100", text: "text-purple-700" },
          { label: "Incentives Paid",        value: fmt(incentivesPaid), color: "bg-green-50 border-green-100",  text: "text-green-700"  },
          { label: "Pending Payments",       value: fmt(pendingPay),     color: "bg-yellow-50 border-yellow-100",text: "text-yellow-700" },
          { label: "Avg Salary",             value: fmt(avgSalary),      color: "bg-blue-50 border-blue-100",    text: "text-blue-700"   },
          { label: "Top Dept (Payroll)",     value: topDept,              color: "bg-orange-50 border-orange-100",text: "text-orange-700" },
        ].map((c) => (
          <div key={c.label} className={`${c.color} border rounded-2xl p-5`}>
            <p className={`text-lg font-bold ${c.text}`}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="flex border-b border-gray-100">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3.5 text-sm font-medium transition-all relative whitespace-nowrap ${
                activeTab === tab
                  ? "text-[#4F3CC9]"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#4F3CC9] rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* ── Department-wise Payroll ── */}
        {activeTab === "Department-wise Payroll" && (
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Department-wise Payroll</h2>
            <p className="text-xs text-gray-400 mb-5">Total net pay grouped by department across all compensation records</p>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-[#4F3CC9]" />
              </div>
            ) : deptPayroll.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                <p className="text-sm font-medium">No payroll data yet</p>
                <p className="text-xs mt-1">Add compensation records to see department breakdown</p>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={deptPayroll} barSize={40} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
                    <XAxis dataKey="dept" tick={{ fontSize: 12, fill: "#374151", fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} width={52} />
                    <Tooltip
                      contentStyle={{ borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                      formatter={(v) => [`₹${Number(v).toLocaleString("en-IN")}`, "Net Payroll"]}
                    />
                    <Bar dataKey="total" name="Net Payroll" fill="#4F3CC9" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                {/* Summary table below chart */}
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                        <th className="text-left pb-2 font-medium">Department</th>
                        <th className="text-right pb-2 font-medium">Employees</th>
                        <th className="text-right pb-2 font-medium">Total Net Pay</th>
                        <th className="text-right pb-2 font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deptPayroll.map((d) => {
                        const empCount = records.filter((r) => {
                          const emp = empList.find((e) => e.empId === r.empId);
                          return (emp?.department || "Other") === d.dept;
                        }).length;
                        const share = totalPayroll > 0 ? ((d.total / totalPayroll) * 100).toFixed(1) : "0";
                        return (
                          <tr key={d.dept} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                            <td className="py-3">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-[#4F3CC9] inline-block opacity-70" />
                                <span className="font-medium text-gray-800">{d.dept}</span>
                              </div>
                            </td>
                            <td className="py-3 text-right text-gray-600">{empCount}</td>
                            <td className="py-3 text-right font-semibold text-gray-900">₹{d.total.toLocaleString("en-IN")}</td>
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16 bg-gray-100 rounded-full h-1.5">
                                  <div className="bg-[#4F3CC9] h-1.5 rounded-full" style={{ width: `${share}%` }} />
                                </div>
                                <span className="text-gray-500 text-xs w-10 text-right">{share}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Compensation Records ── */}
        {activeTab === "Compensation Records" && (
          <div>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Compensation Records</h2>
              <div className="flex gap-2">
                <button onClick={() => downloadCSV("compensation.csv", records.map((r) => [r.name, r.empId, r.designation, r.empType, String(r.salary), String(r.incentive), String(r.bonus), String(r.deductions), String(r.netPay), r.paymentStatus, r.paymentDate]), ["Name","EmpID","Designation","Type","Salary","Incentive","Bonus","Deductions","NetPay","Status","PaymentDate"])} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 rounded-xl px-3 py-2 text-sm font-medium hover:bg-gray-50 transition">
                  <FileText size={13} /> Download CSV
                </button>
                <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-[#3d2fa8]">
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-left">Emp ID</th>
                    <th className="px-4 py-3 text-left">Designation</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-right">Salary</th>
                    <th className="px-4 py-3 text-right">Incentive</th>
                    <th className="px-4 py-3 text-right">Bonus</th>
                    <th className="px-4 py-3 text-right">Deductions</th>
                    <th className="px-4 py-3 text-right">Net Pay</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm"><Loader2 size={18} className="inline animate-spin mr-2" />Loading records…</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">No compensation records yet. Click &quot;Add&quot; to create one.</td></tr>
                  ) : records.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.empId}</td>
                      <td className="px-4 py-3 text-gray-600">{r.designation}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{r.empType}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(r.salary)}</td>
                      <td className="px-4 py-3 text-right text-green-600">{r.incentive > 0 ? fmt(r.incentive) : "-"}</td>
                      <td className="px-4 py-3 text-right text-green-600">{r.bonus > 0 ? fmt(r.bonus) : "-"}</td>
                      <td className="px-4 py-3 text-right text-red-500">{fmt(r.deductions)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#4F3CC9]">{fmt(r.netPay)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${payStatusColor[r.paymentStatus]}`}>{r.paymentStatus}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(r)} title="Edit" className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500"><Pencil size={14} /></button>
                          <button onClick={() => { setPayslipModal(r); }} title="View Payslip" className="p-1.5 rounded-lg hover:bg-purple-50 text-[#4F3CC9]"><FileText size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Incentive Management ── */}
        {activeTab === "Incentive Management" && (
          <div>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Incentive Management</h2>
              <button onClick={() => setShowIncentive(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">
                <Plus size={14} /> Add Incentive
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Month</th>
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-left">Incentive Type</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Performance Basis</th>
                    <th className="px-4 py-3 text-left">Approval Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {incentives.map((i) => (
                    <tr key={i.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{i.month}</td>
                      <td className="px-4 py-3 font-medium">{i.employee}</td>
                      <td className="px-4 py-3 text-gray-600">{i.type}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#4F3CC9]">{fmt(i.amount)}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{i.basis}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${i.status === "Approved" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>{i.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Payrolls ── */}
        {activeTab === "Payrolls" && (
          <div>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Payroll Records</h2>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  placeholder="Search by name or EMP ID…"
                  value={empIdSearch}
                  onChange={(e) => setEmpIdSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-xl border border-gray-200 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-left">Emp ID</th>
                    <th className="px-4 py-3 text-left">Designation</th>
                    <th className="px-4 py-3 text-right">Salary</th>
                    <th className="px-4 py-3 text-right">Incentive</th>
                    <th className="px-4 py-3 text-right">Bonus</th>
                    <th className="px-4 py-3 text-right">Deductions</th>
                    <th className="px-4 py-3 text-right">Net Pay</th>
                    <th className="px-4 py-3 text-left">Payment Date</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Payslip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm"><Loader2 size={18} className="inline animate-spin mr-2" />Loading…</td></tr>
                  ) : records.filter((r) =>
                      !empIdSearch ||
                      r.name.toLowerCase().includes(empIdSearch.toLowerCase()) ||
                      r.empId.toLowerCase().includes(empIdSearch.toLowerCase())
                    ).length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">
                      {records.length === 0 ? "No payroll data yet. Add compensation records first." : "No results match your search."}
                    </td></tr>
                  ) : records
                      .filter((r) =>
                        !empIdSearch ||
                        r.name.toLowerCase().includes(empIdSearch.toLowerCase()) ||
                        r.empId.toLowerCase().includes(empIdSearch.toLowerCase())
                      )
                      .map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.empId}</td>
                      <td className="px-4 py-3 text-gray-600">{r.designation}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(r.salary)}</td>
                      <td className="px-4 py-3 text-right text-green-600">{r.incentive > 0 ? fmt(r.incentive) : "—"}</td>
                      <td className="px-4 py-3 text-right text-green-600">{r.bonus > 0 ? fmt(r.bonus) : "—"}</td>
                      <td className="px-4 py-3 text-right text-red-500">{fmt(r.deductions)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#4F3CC9]">{fmt(r.netPay)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.paymentDate || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${payStatusColor[r.paymentStatus]}`}>{r.paymentStatus}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setPayslipModal(r); }}
                          className="flex items-center gap-1 text-xs text-[#4F3CC9] border border-[#4F3CC9] hover:bg-[#EDE9FF] px-2.5 py-1 rounded-full font-medium transition-colors"
                        >
                          <FileText size={12} /> Payslip
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>{/* end tab container */}

      {/* Edit Compensation Modal */}
      {editRecord && editForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setEditRecord(null); setEditForm(null); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold">Edit Compensation</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editRecord.name} · {editRecord.empId}</p>
              </div>
              <button onClick={() => { setEditRecord(null); setEditForm(null); }}><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Designation</label>
                <input value={editForm.designation} onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Emp Type</label>
                <select value={editForm.empType} onChange={(e) => setEditForm({ ...editForm, empType: e.target.value })} className={inputCls}>
                  {["Full-Time","Part-Time","Intern","Contract"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Salary (₹)</label>
                <input type="number" value={editForm.salary} onChange={(e) => setEditForm({ ...editForm, salary: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Incentive (₹)</label>
                <input type="number" value={editForm.incentive} onChange={(e) => setEditForm({ ...editForm, incentive: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Bonus (₹)</label>
                <input type="number" value={editForm.bonus} onChange={(e) => setEditForm({ ...editForm, bonus: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Deductions (₹)</label>
                <input type="number" value={editForm.deductions} onChange={(e) => setEditForm({ ...editForm, deductions: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Net Pay (₹)</label>
                <input type="number" value={editForm.netPay} onChange={(e) => setEditForm({ ...editForm, netPay: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Payment Status</label>
                <select value={editForm.paymentStatus} onChange={(e) => setEditForm({ ...editForm, paymentStatus: e.target.value as PaymentStatus })} className={inputCls}>
                  {(["Paid","Pending","Processing"] as PaymentStatus[]).map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Payment Date</label>
                <input type="date" value={editForm.paymentDate} onChange={(e) => setEditForm({ ...editForm, paymentDate: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Pay Month</label>
                <select value={editForm.month} onChange={(e) => setEditForm({ ...editForm, month: e.target.value })} className={inputCls}>
                  {Array.from({ length: 12 }, (_, i) => {
                    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
                    return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
                  }).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="px-6 pb-6">
              <button onClick={saveEdit} disabled={saving} className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 disabled:opacity-70">
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payslip Modal */}
      {payslipModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPayslipModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-base font-bold text-gray-900">Payslip — {payslipModal.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{payslipModal.empId} · {payslipModal.designation} · {payslipModal.month}</p>
              </div>
              <button onClick={() => setPayslipModal(null)}><X size={20} /></button>
            </div>
            <div className="p-6">
              <PayslipCard emp={payslipModal} />
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="fixed top-5 right-5 z-50 bg-green-500 text-white px-5 py-3 rounded-2xl text-sm font-medium shadow-lg">{toast}</div>}

      {/* Add Compensation Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Add Compensation</h2>
              <button onClick={() => setShowAdd(false)}><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Employee</label>
                <select
                  value={addForm.empId}
                  onChange={(e) => {
                    const emp = empList.find((x) => x.empId === e.target.value);
                    setAddForm({ ...addForm, empId: e.target.value, name: emp?.name ?? "", designation: emp?.designation ?? addForm.designation });
                  }}
                  className={inputCls}
                >
                  <option value="">— Select Employee —</option>
                  {empList.map((e) => <option key={e.empId} value={e.empId}>{e.name} ({e.empId})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Designation</label>
                <input value={addForm.designation} onChange={(e) => setAddForm({ ...addForm, designation: e.target.value })} placeholder="e.g. Software Engineer" className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Emp Type</label>
                <select value={addForm.empType} onChange={(e) => setAddForm({ ...addForm, empType: e.target.value })} className={inputCls}>
                  {["Full-Time","Part-Time","Intern","Contract"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Salary (₹)</label>
                <input type="number" value={addForm.salary || ""} onChange={(e) => setAddForm({ ...addForm, salary: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Incentive (₹)</label>
                <input type="number" value={addForm.incentive || ""} onChange={(e) => setAddForm({ ...addForm, incentive: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Bonus (₹)</label>
                <input type="number" value={addForm.bonus || ""} onChange={(e) => setAddForm({ ...addForm, bonus: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Deductions (₹)</label>
                <input type="number" value={addForm.deductions || ""} onChange={(e) => setAddForm({ ...addForm, deductions: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Pay Month</label>
                <select value={addForm.month} onChange={(e) => setAddForm({ ...addForm, month: e.target.value })} className={inputCls}>
                  {Array.from({ length: 12 }, (_, i) => {
                    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
                    return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
                  }).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Payment Status</label>
                <select value={addForm.paymentStatus} onChange={(e) => setAddForm({ ...addForm, paymentStatus: e.target.value as PaymentStatus })} className={inputCls}>
                  {(["Paid","Pending","Processing"] as PaymentStatus[]).map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Payment Date</label>
                <input type="date" value={addForm.paymentDate} onChange={(e) => setAddForm({ ...addForm, paymentDate: e.target.value })} className={inputCls} />
              </div>
            </div>
            <div className="px-6 pb-6">
              <button onClick={handleAddComp} disabled={saving} className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8] transition flex items-center justify-center gap-2 disabled:opacity-70">
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save Compensation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Incentive Modal */}
      {showIncentive && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowIncentive(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Add Incentive</h2>
              <button onClick={() => setShowIncentive(false)}><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Month</label>
                <select value={incForm.month} onChange={(e) => setIncForm({ ...incForm, month: e.target.value })} className={inputCls}>
                  {Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toLocaleString("en-IN", { month: "short", year: "numeric" }); }).map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Employee</label>
                <select value={incForm.employee} onChange={(e) => setIncForm({ ...incForm, employee: e.target.value })} className={inputCls}>
                  <option value="">— Select Employee —</option>
                  {empList.map((e) => <option key={e.empId} value={e.name}>{e.name} ({e.empId})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Incentive Type *</label>
                <input value={incForm.type} onChange={(e) => setIncForm({ ...incForm, type: e.target.value })} placeholder="e.g. Sales Commission" className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Amount (₹) *</label>
                <input type="number" value={incForm.amount || ""} onChange={(e) => setIncForm({ ...incForm, amount: Number(e.target.value) })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Performance Basis</label>
                <input value={incForm.basis} onChange={(e) => setIncForm({ ...incForm, basis: e.target.value })} placeholder="e.g. Closed 5 deals, exceeded KPI" className={inputCls} />
              </div>
            </div>
            <div className="px-6 pb-6">
              <button onClick={handleAddIncentive} disabled={saving} className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8] transition flex items-center justify-center gap-2 disabled:opacity-70">
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Add Incentive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
