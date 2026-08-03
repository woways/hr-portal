"use client";
import { useState, useEffect, useRef } from "react";
import { Pencil, FileText, Plus, X, Search, Loader2 } from "lucide-react";
import { getCompensation, addCompensation, updateCompensation, getIncentives, addIncentive, getEmployees, markHRNotifRead } from "@/lib/firebaseService";
import { cachedEmployees, cachedCompensation, cachedIncentives, invalidateCompensation, invalidateIncentives } from "@/lib/cachedService";
import { SkeletonTableRows } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { INCENTIVE_TYPES, isValidIncentiveType, isValidPerformanceBasis } from "@/lib/incentive";
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
  const [empSearch, setEmpSearch] = useState("");
  const [empDropOpen, setEmpDropOpen] = useState(false);
  const empSearchRef = useRef<HTMLDivElement>(null);

  // Auto-mark all unread payroll notifications as read when HR opens this page
  useEffect(() => { const t = setTimeout(() => markHRNotifRead("payroll"), 10000); return () => clearTimeout(t); }, []);

  // Load employees + existing compensation & incentives (cache-first)
  useEffect(() => {
    let resolved = 0;
    const bump = () => { resolved += 1; if (resolved >= 3) setLoading(false); };
    const seen = { emps: false, comps: false, incs: false };

    cachedEmployees((empDocs) => {
      const emps = empDocs
        .map((d) => { const r = d as Record<string, unknown>; return { id: (r.employeeId ?? r.id) as string, name: (r.name as string) ?? "", designation: (r.designation as string) ?? "", department: (r.department as string) ?? "", status: (r.status as string) ?? "Active" }; })
        .filter((e) => e.status !== "Exited");
      setEmpList(emps.map((e) => ({ id: e.id, name: e.name, empId: e.id, designation: e.designation, department: e.department })));
      if (!seen.emps) { seen.emps = true; bump(); }
    }).catch(() => { if (!seen.emps) { seen.emps = true; bump(); } });

    cachedCompensation((comps) => {
      setRecords(comps.map((c) => c as unknown as CompRecord));
      if (!seen.comps) { seen.comps = true; bump(); }
    }).catch(() => { if (!seen.comps) { seen.comps = true; bump(); } });

    cachedIncentives((incs) => {
      setIncentives(incs.map((i) => i as unknown as Incentive));
      if (!seen.incs) { seen.incs = true; bump(); }
    }).catch(() => { if (!seen.incs) { seen.incs = true; bump(); } });
  }, []);

  function showMsg(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  // Field-level validation (BUG-04). Truthy string = failure message.
  const addFormErrors = {
    empId: (!addForm.empId || !addForm.name) ? "Please select an employee." : "",
    designation: !addForm.designation?.trim() ? "Designation is required." : "",
    salary: !(addForm.salary > 0) ? "Payroll amount must be greater than ₹0." : "",
    negatives: (addForm.incentive < 0 || addForm.bonus < 0 || addForm.deductions < 0) ? "Incentive, bonus and deductions cannot be negative." : "",
    paymentDate: !addForm.paymentDate ? "Payment date is required." : "",
  } as const;
  const addFormFirstError = Object.values(addFormErrors).find(v => !!v) ?? "";
  const canSaveComp = !addFormFirstError;

  async function handleAddComp() {
    if (saving) return;
    if (!canSaveComp) { showMsg(addFormFirstError); return; }
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
      invalidateCompensation();
      setShowAdd(false);
      setAddForm({ ...blankAdd, empId: "" });
      setEmpSearch("");
      showMsg("Payroll record saved.");
    } catch { showMsg("Failed to save. Please try again."); }
    finally { setSaving(false); }
  }

  async function handleAddIncentive() {
    if (saving) return;
    // BUG-PAY-01: Incentive Type must be a standardized value (dropdown enum) —
    // never a bare number ("899") or single char ("c"); Performance Basis must be
    // meaningful validated content, not junk ("bb") or empty.
    if (!isValidIncentiveType(incForm.type)) { showMsg("Please select a valid Incentive Type from the list."); return; }
    if (!incForm.amount || incForm.amount <= 0) { showMsg("Please enter a valid incentive amount greater than 0."); return; }
    if (!isValidPerformanceBasis(incForm.basis)) { showMsg("Performance Basis must be a meaningful justification (at least 5 characters, not just numbers)."); return; }
    if (!incForm.employee) { showMsg("Please select an employee."); return; }
    setSaving(true);
    try {
      const data = { month: incForm.month, employee: incForm.employee, type: incForm.type, amount: incForm.amount, basis: incForm.basis, status: "Pending" as const };
      const docId = await addIncentive(data);
      setIncentives((p) => [...p, { id: docId, ...data }]);
      invalidateIncentives();
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
      invalidateCompensation();
      setEditRecord(null); setEditForm(null);
      showMsg("Payroll updated.");
    } catch { showMsg("Failed to update."); }
    finally { setSaving(false); }
  }

  // Payslip modal — holds the CompRecord for the React card preview
  const [payslipModal, setPayslipModal] = useState<CompRecord | null>(null);

  function numberToWords(n: number): string {
    const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
    const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
    if (!n || n === 0) return "Zero Rupees Only";
    function helper(num: number): string {
      if (num === 0) return "";
      if (num < 20) return ones[num] + " ";
      if (num < 100) return tens[Math.floor(num / 10)] + " " + (num % 10 ? ones[num % 10] + " " : "");
      if (num < 1000) return ones[Math.floor(num / 100)] + " Hundred " + helper(num % 100);
      if (num < 100000) return helper(Math.floor(num / 1000)) + "Thousand " + helper(num % 1000);
      if (num < 10000000) return helper(Math.floor(num / 100000)) + "Lakh " + helper(num % 100000);
      return helper(Math.floor(num / 10000000)) + "Crore " + helper(num % 10000000);
    }
    return helper(n).trim() + " Rupees Only";
  }

  function buildSlipHtml(emp: CompRecord): string {
    const empDept = empList.find((e) => e.empId === emp.empId)?.department || "—";
    const gross = emp.salary + emp.incentive + emp.bonus;
    const totalPay = emp.netPay;
    const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const [mon, yr] = emp.month.split(" ");
    const mIdx = MONTHS.indexOf(mon);
    const workDays = mIdx >= 0 && yr ? new Date(parseInt(yr), mIdx + 1, 0).getDate() : 30;

    const earningRows: string[] = [
      `<tr><td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;">Basic Payroll</td><td style="border:1px solid #e8eaf3;padding:7px 12px;text-align:right;font-size:11px;">${emp.salary.toLocaleString("en-IN")}</td><td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;">Total Deductions</td><td style="border:1px solid #e8eaf3;padding:7px 12px;text-align:right;font-size:11px;">${emp.deductions > 0 ? emp.deductions.toLocaleString("en-IN") : ""}</td></tr>`,
    ];
    if (emp.incentive > 0) earningRows.push(`<tr><td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;">Incentive</td><td style="border:1px solid #e8eaf3;padding:7px 12px;text-align:right;font-size:11px;">${emp.incentive.toLocaleString("en-IN")}</td><td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;"></td><td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;"></td></tr>`);
    if (emp.bonus > 0) earningRows.push(`<tr><td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;">Bonus</td><td style="border:1px solid #e8eaf3;padding:7px 12px;text-align:right;font-size:11px;">${emp.bonus.toLocaleString("en-IN")}</td><td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;"></td><td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;"></td></tr>`);

    const badgeStyle = emp.paymentStatus?.toLowerCase() === "paid"
      ? "background:#dcfce7;color:#166534;"
      : emp.paymentStatus?.toLowerCase() === "processing"
      ? "background:#dbeafe;color:#1d4ed8;"
      : "background:#fef9c3;color:#854d0e;";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Payslip - ${emp.month}</title>
  <style>
    @page{size:A4;margin:12mm 14mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a2e;background:#f0f2f5}
    .page{max-width:860px;margin:20px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)}
    .header{display:flex;align-items:center;justify-content:space-between;padding:18px 28px;border-bottom:1px solid #e5e7eb}
    .logo{font-size:28px;font-weight:900;letter-spacing:-1px;line-height:1}
    .logo .wo{color:#0B1929}.logo .ways{color:#14B8A6}
    .header-addr{text-align:right;font-size:10px;color:#6b7280;line-height:1.6}
    .header-addr strong{font-size:11px;color:#374151;display:block;margin-bottom:2px}
    .title-bar{background:#0d1b2a;color:#fff;padding:12px 28px;display:flex;align-items:center;justify-content:space-between}
    .title-bar .lbl{font-size:15px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
    .title-bar .mo{font-size:13px;font-weight:500;opacity:.8}
    .emp-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border-bottom:1px solid #e0e4ef}
    .emp-cell{padding:9px 16px;border-right:1px solid #e0e4ef;border-bottom:1px solid #e0e4ef}
    .emp-cell:nth-child(3n){border-right:none}
    .lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px}
    .val{font-size:12px;font-weight:700;color:#1B2B6B}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700}
    .section-wrap{padding:18px 28px 0}
    .earnings-table{width:100%;border-collapse:collapse}
    .earnings-table th{background:#1B2B6B;color:#fff;font-size:11px;font-weight:600;padding:8px 12px;text-align:left;letter-spacing:0.4px}
    .earnings-table th.amt{text-align:right}
    .earnings-table td{padding:7px 12px;border:1px solid #e8eaf3;font-size:11px;vertical-align:middle}
    .earnings-table tr:nth-child(even) td{background:#f8f9fe}
    .subtotal td{background:#eef0f8!important;font-weight:700;font-size:11px}
    .subtotal td.amt{color:#1B2B6B}
    .net-pay{margin:0 28px;background:linear-gradient(135deg,#CC2222 0%,#e03a3a 100%);color:#fff;border-radius:0 0 8px 8px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center}
    .net-pay .label{font-size:13px;font-weight:700;letter-spacing:0.5px}
    .net-pay .amount{font-size:22px;font-weight:900;letter-spacing:1px}
    .net-pay .words{font-size:10px;color:#ffd0d0;margin-top:2px}
    .sig-row{display:flex;justify-content:space-between;padding:20px 28px 0}
    .sig-block{text-align:center}
    .sig-line{width:140px;border-top:1.5px solid #1B2B6B;margin:0 auto 4px}
    .sig-label{font-size:10px;color:#555;font-weight:600;text-transform:uppercase;letter-spacing:0.4px}
    .footer{margin:14px 28px 20px;padding:10px 16px;background:#f5f7ff;border-radius:6px;border-left:3px solid #CC2222}
    .footer p{font-size:9.5px;color:#777;line-height:1.6}
    @media print{body{background:#fff}.page{box-shadow:none;border-radius:0;margin:0}body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo"><span class="wo">WO</span><span class="ways">WAYS</span></div>
      <div class="header-addr">
        <strong>Woways Technologies Pvt. Ltd.</strong>
        Plot No 5, East Wing, Ground Floor, Financial District,<br>
        Nanakramguda, Serilingampalle (M), Hyderabad – 500032, Telangana, India
      </div>
    </div>
    <div class="title-bar">
      <span class="lbl">Payslip</span>
      <span class="mo">${emp.month}</span>
    </div>
    <div class="emp-grid">
      <div class="emp-cell"><div class="lbl">Employee Name</div><div class="val">${emp.name}</div></div>
      <div class="emp-cell"><div class="lbl">Employee Code</div><div class="val">${emp.empId}</div></div>
      <div class="emp-cell"><div class="lbl">Employee Type</div><div class="val">${emp.empType}</div></div>
      <div class="emp-cell"><div class="lbl">Designation</div><div class="val">${emp.designation || "—"}</div></div>
      <div class="emp-cell"><div class="lbl">Department</div><div class="val">${empDept}</div></div>
      <div class="emp-cell"><div class="lbl">Working Days</div><div class="val">${workDays} / ${workDays}</div></div>
      <div class="emp-cell"><div class="lbl">Payment Date</div><div class="val">${emp.paymentDate || "—"}</div></div>
      <div class="emp-cell" style="grid-column:span 2"><div class="lbl">Payment Status</div><div class="val"><span class="badge" style="${badgeStyle}">${emp.paymentStatus}</span></div></div>
    </div>
    <div class="section-wrap">
      <table class="earnings-table">
        <thead>
          <tr>
            <th style="width:30%">Earnings</th>
            <th class="amt" style="width:20%">Amount (₹)</th>
            <th style="width:30%">Deductions</th>
            <th class="amt" style="width:20%">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${earningRows.join("")}
          <tr class="subtotal">
            <td>Gross Earning (A)</td>
            <td class="amt" style="text-align:right">₹ ${gross.toLocaleString("en-IN")}</td>
            <td>Total Deductions (B)</td>
            <td class="amt" style="text-align:right">₹ ${emp.deductions.toLocaleString("en-IN")}</td>
          </tr>
          <tr class="subtotal">
            <td>Net Payroll (A – B)</td>
            <td class="amt" style="text-align:right">₹ ${totalPay.toLocaleString("en-IN")}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="net-pay">
      <div>
        <div class="label">Total Net Payroll</div>
        <div class="words">${numberToWords(totalPay)}</div>
      </div>
      <div class="amount">₹ ${totalPay.toLocaleString("en-IN")}</div>
    </div>
    <div class="sig-row">
      <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Employee Signature</div></div>
      <div class="sig-block"><div class="sig-line"></div><div class="sig-label">HR / Authorised Signatory</div></div>
    </div>
    <div class="footer">
      <p>&#9432;&nbsp; This is a computer-generated payslip and does not require a physical signature. &nbsp;|&nbsp; Woways Technologies Pvt. Ltd. &nbsp;|&nbsp; ${emp.month}</p>
    </div>
  </div>
</body>
</html>`;
  }

  function downloadSlip(emp: CompRecord) {
    // Block payslip generation until the payroll run is finalized (Paid).
    if (emp.paymentStatus !== "Paid") {
      alert(`Payslip not available yet — payroll for ${emp.name} (${emp.month}) is still ${emp.paymentStatus}. Finalize the payment before generating the payslip.`);
      return;
    }
    const html = buildSlipHtml(emp);
    const blob = new Blob([html], { type: "application/octet-stream" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `Payslip_${emp.name.replace(/\s+/g, "_")}_${emp.month.replace(/\s+/g, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

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
      <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-gradient-to-br from-[#f5f3ff] to-[#f0fdfa] px-8 py-6 border-b border-gray-100 text-center">
          <div className="flex items-center justify-center leading-none mb-1.5">
            <span className="text-3xl font-black text-[#0B1929] tracking-tight">WO</span>
            <span className="text-3xl font-black text-[#14B8A6] tracking-tight">WAYS</span>
          </div>
          <p className="text-xs text-gray-400">Payslip for {emp.month}</p>
        </div>
        <div className="px-8 py-5 bg-gray-50/60 border-b border-gray-100">
          <div className="grid grid-cols-2 gap-x-10 gap-y-4">
            {[
              { label: "Employee Name", value: emp.name },
              { label: "Employee ID",   value: emp.empId },
              { label: "Designation",   value: emp.designation || "—" },
              { label: "Emp Type",      value: emp.empType },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-gray-900">{value}</p>
              </div>
            ))}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Payment Status</p>
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${payStatusColor[emp.paymentStatus]}`}>{emp.paymentStatus}</span>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Payment Date</p>
              <p className="text-sm font-semibold text-gray-900">{emp.paymentDate || "—"}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-gray-100">
          <div className="px-7 py-5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Earnings</p>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Basic Payroll</span><span className="font-semibold text-gray-900">{fmt(emp.salary)}</span></div>
              {emp.incentive > 0 && <div className="flex justify-between"><span className="text-gray-500">Incentive</span><span className="font-semibold text-gray-900">{fmt(emp.incentive)}</span></div>}
              {emp.bonus > 0 && <div className="flex justify-between"><span className="text-gray-500">Bonus</span><span className="font-semibold text-gray-900">{fmt(emp.bonus)}</span></div>}
              <div className="flex justify-between font-bold border-t border-gray-100 pt-2.5 mt-1 text-gray-900">
                <span>Gross Total</span><span>{fmt(grossEarnings)}</span>
              </div>
            </div>
          </div>
          <div className="px-7 py-5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Deductions</p>
            <div className="space-y-2.5 text-sm">
              {emp.deductions > 0
                ? <div className="flex justify-between"><span className="text-gray-500">Total Deductions</span><span className="font-semibold text-red-500">{fmt(emp.deductions)}</span></div>
                : <p className="text-xs text-gray-400 py-1">No deductions this month</p>}
              <div className="flex justify-between font-bold border-t border-gray-100 pt-2.5 mt-1">
                <span className="text-gray-900">Total</span><span className="text-red-500">{fmt(emp.deductions)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="px-8 py-5 bg-[#EDE9FF]/50 border-t border-[#4F3CC9]/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Net Payroll</p>
            <p className="text-2xl font-black text-[#4F3CC9]">{fmt(emp.netPay)}</p>
          </div>
          <button
            onClick={() => downloadSlip(emp)}
            disabled={emp.paymentStatus !== "Paid"}
            title={emp.paymentStatus !== "Paid" ? "Available once payroll is finalized (Paid)" : "Download payslip"}
            className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-[#3d2fa8] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#4F3CC9]">
            <FileText size={14} /> {emp.paymentStatus !== "Paid" ? "Payslip Pending" : "Download Payslip"}
          </button>
        </div>
      </div>
    );
  }

  const TABS = ["Department-wise Payroll", "Payroll Records", "Incentive Management", "Payslips"] as const;
  type Tab = typeof TABS[number];
  const [activeTab, setActiveTab] = useState<Tab>("Department-wise Payroll");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
          <p className="text-gray-500 text-sm mt-1">Manage payroll and incentives</p>
        </div>
      </div>

      {/* Analytics Cards — always visible */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Total Monthly Payroll", value: fmt(totalPayroll),   color: "bg-purple-50 border-purple-100", text: "text-purple-700" },
          { label: "Incentives Paid",        value: fmt(incentivesPaid), color: "bg-green-50 border-green-100",  text: "text-green-700"  },
          { label: "Pending Payments",       value: fmt(pendingPay),     color: "bg-yellow-50 border-yellow-100",text: "text-yellow-700" },
          { label: "Avg Payroll",             value: fmt(avgSalary),      color: "bg-blue-50 border-blue-100",    text: "text-blue-700"   },
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

        {/* ── Department-wise Compensation ── */}
        {activeTab === "Department-wise Payroll" && (
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Department-wise Payroll</h2>
            <p className="text-xs text-gray-400 mb-5">Total net pay grouped by department across all payroll records</p>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-[#4F3CC9]" />
              </div>
            ) : deptPayroll.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                <p className="text-sm font-medium">No payroll data yet</p>
                <p className="text-xs mt-1">Add payroll records to see department breakdown</p>
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
                        <th className="text-right pb-2 font-medium">Total Net Payroll</th>
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
        {activeTab === "Payroll Records" && (
          <div>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Payroll Records</h2>
              <div className="flex gap-2">
                <button onClick={() => downloadCSV("payroll.csv", records.map((r) => [r.name, r.empId, r.designation, r.empType, String(r.salary), String(r.incentive), String(r.bonus), String(r.deductions), String(r.netPay), r.paymentStatus, r.paymentDate]), ["Name","EmpID","Designation","Type","Payroll","Incentive","Bonus","Deductions","NetPay","Status","PaymentDate"])} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 rounded-xl px-3 py-2 text-sm font-medium hover:bg-gray-50 transition">
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
                    <th className="px-4 py-3 text-right">Payroll</th>
                    <th className="px-4 py-3 text-right">Incentive</th>
                    <th className="px-4 py-3 text-right">Bonus</th>
                    <th className="px-4 py-3 text-right">Deductions</th>
                    <th className="px-4 py-3 text-right">Net Payroll</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm"><Loader2 size={18} className="inline animate-spin mr-2" />Loading records…</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={11}><EmptyState title="No payroll records yet" subtitle="Click &quot;Add&quot; to create the first record." /></td></tr>
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
                      <td className="px-4 py-3 text-gray-600">
                        {i.type || "—"}
                        {!isValidIncentiveType(i.type) && (
                          <span title="Non-standard Incentive Type — not one of the standardized values. Edit to select a valid type." className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 align-middle">⚠ non-standard</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#4F3CC9]">{fmt(i.amount)}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {i.basis || <span className="text-red-400">—</span>}
                        {!isValidPerformanceBasis(i.basis) && (
                          <span title="Performance Basis is missing or not meaningful. Edit to add a proper justification." className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-600 align-middle">⚠</span>
                        )}
                      </td>
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
        {activeTab === "Payslips" && (
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
                    <th className="px-4 py-3 text-right">Payroll</th>
                    <th className="px-4 py-3 text-right">Incentive</th>
                    <th className="px-4 py-3 text-right">Bonus</th>
                    <th className="px-4 py-3 text-right">Deductions</th>
                    <th className="px-4 py-3 text-right">Net Payroll</th>
                    <th className="px-4 py-3 text-left">Payment Date</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Payslip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <SkeletonTableRows rows={6} cols={11} />
                  ) : records.filter((r) =>
                      !empIdSearch ||
                      r.name.toLowerCase().includes(empIdSearch.toLowerCase()) ||
                      r.empId.toLowerCase().includes(empIdSearch.toLowerCase())
                    ).length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">
                      {records.length === 0 ? "No payroll data yet. Add payroll records first." : "No results match your search."}
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
                <h2 className="text-lg font-bold">Edit Payroll</h2>
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
                <label className="text-xs font-medium text-gray-600 block mb-1">Payroll (₹)</label>
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
                <label className="text-xs font-medium text-gray-600 block mb-1">Net Payroll (₹)</label>
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
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setShowAdd(false); setEmpSearch(""); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Add Payroll</h2>
              <button onClick={() => { setShowAdd(false); setEmpSearch(""); }}><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2" ref={empSearchRef}>
                <label className="text-xs font-medium text-gray-600 block mb-1">Employee</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name or ID…"
                    value={empSearch}
                    onFocus={() => setEmpDropOpen(true)}
                    onChange={(e) => { setEmpSearch(e.target.value); setEmpDropOpen(true); }}
                    onBlur={() => setTimeout(() => setEmpDropOpen(false), 150)}
                    className={inputCls}
                  />
                  {addForm.empId && !empDropOpen && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#4F3CC9] font-medium pointer-events-none">
                      {addForm.empId}
                    </span>
                  )}
                  {empDropOpen && (
                    <ul className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {empList
                        .filter((e) => {
                          const q = empSearch.toLowerCase();
                          return !q || e.name.toLowerCase().includes(q) || e.empId.toLowerCase().includes(q);
                        })
                        .map((e) => (
                          <li
                            key={e.empId}
                            onMouseDown={() => {
                              setAddForm({ ...addForm, empId: e.empId, name: e.name, designation: e.designation });
                              setEmpSearch(`${e.name} (${e.empId})`);
                              setEmpDropOpen(false);
                            }}
                            className="px-4 py-2.5 text-sm cursor-pointer hover:bg-[#F5F3FF] hover:text-[#4F3CC9] flex items-center justify-between"
                          >
                            <span>{e.name}</span>
                            <span className="text-xs text-gray-400">{e.empId}</span>
                          </li>
                        ))}
                      {empList.filter((e) => { const q = empSearch.toLowerCase(); return !q || e.name.toLowerCase().includes(q) || e.empId.toLowerCase().includes(q); }).length === 0 && (
                        <li className="px-4 py-3 text-sm text-gray-400">No employees found</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Designation *</label>
                <input value={addForm.designation} onChange={(e) => setAddForm({ ...addForm, designation: e.target.value })} placeholder="e.g. Software Engineer" aria-invalid={addFormErrors.designation ? true : undefined} aria-describedby={addFormErrors.designation ? "err-designation" : undefined} className={inputCls} />
                {addFormErrors.designation && <p id="err-designation" className="text-[11px] text-red-600 mt-1">{addFormErrors.designation}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Emp Type</label>
                <select value={addForm.empType} onChange={(e) => setAddForm({ ...addForm, empType: e.target.value })} className={inputCls}>
                  {["Full-Time","Part-Time","Intern","Contract"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Payroll (₹) *</label>
                <input type="number" min="0" value={addForm.salary || ""} onChange={(e) => setAddForm({ ...addForm, salary: Number(e.target.value) })} aria-invalid={addFormErrors.salary ? true : undefined} aria-describedby={addFormErrors.salary ? "err-salary" : undefined} className={inputCls} />
                {addFormErrors.salary && <p id="err-salary" className="text-[11px] text-red-600 mt-1">{addFormErrors.salary}</p>}
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
                <input type="date" value={addForm.paymentDate} onChange={(e) => setAddForm({ ...addForm, paymentDate: e.target.value })} aria-invalid={addFormErrors.paymentDate ? true : undefined} aria-describedby={addFormErrors.paymentDate ? "err-paymentDate" : undefined} className={inputCls} />
                {addFormErrors.paymentDate && <p id="err-paymentDate" className="text-[11px] text-red-600 mt-1">{addFormErrors.paymentDate}</p>}
              </div>
            </div>
            <div className="px-6 pb-6 space-y-3">
              <div role="alert" aria-live="polite" className="min-h-[0]">
                {!canSaveComp && addFormFirstError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{addFormFirstError}</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleAddComp}
                aria-disabled={saving || !canSaveComp}
                aria-describedby="save-payroll-hint"
                className={`w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold transition flex items-center justify-center gap-2 ${(saving || !canSaveComp) ? "opacity-60 cursor-not-allowed" : "hover:bg-[#3d2fa8]"}`}
              >
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save Payroll"}
              </button>
              <p id="save-payroll-hint" className="sr-only">Fill Employee, Designation, Payroll amount (greater than zero) and Payment Date to enable Save.</p>
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
                <select value={incForm.type} onChange={(e) => setIncForm({ ...incForm, type: e.target.value })} className={inputCls}>
                  <option value="">— Select Incentive Type —</option>
                  {INCENTIVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Amount (₹) *</label>
                <input type="number" min="1" value={incForm.amount || ""} onChange={(e) => setIncForm({ ...incForm, amount: Number(e.target.value) })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Performance Basis *</label>
                <input value={incForm.basis} onChange={(e) => setIncForm({ ...incForm, basis: e.target.value })} placeholder="e.g. Closed 5 deals, exceeded KPI" className={inputCls} />
                {incForm.basis.trim() !== "" && !isValidPerformanceBasis(incForm.basis) && (
                  <p className="text-red-500 text-[10px] mt-1">Enter a meaningful justification (min 5 characters, not just numbers).</p>
                )}
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
