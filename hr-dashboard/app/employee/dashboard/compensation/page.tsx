"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  IndianRupee, TrendingUp, Clock, CheckCircle, Download,
  Eye, EyeOff, CreditCard, Info, Loader2, X,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface EarningRow { label: string; amount: number; }
interface DeductionRow { label: string; amount: number; }

interface PaySlip {
  id: string;
  period: string;       // e.g. "June 2026"
  periodYear: number;   // 2026
  periodMonth: number;  // 6 (1-indexed)
  type: "Regular" | "Off-Cycle";
  workDays: number;
  gross: number;
  deduction: number;
  tds: number;
  net: number;
  bonus: number;
  totalPay: number;
  paymentStatus: string;
  paymentDate: string;
  empName: string;
  empType: string;
  designation: string;
  department: string;
  empId: string;
  earnings: EarningRow[];
  deductions: DeductionRow[];
}

interface EmployeeInfo {
  name: string;
  designation: string;
  department: string;
  joinDate: string;
  empType: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function numberToWords(n: number): string {
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  if (n === 0) return "Zero Rupees Only";
  function helper(num: number): string {
    if (num === 0) return "";
    if (num < 20) return ones[num] + " ";
    if (num < 100) return tens[Math.floor(num/10)] + " " + (num%10 ? ones[num%10] + " " : "");
    if (num < 1000) return ones[Math.floor(num/100)] + " Hundred " + helper(num%100);
    if (num < 100000) return helper(Math.floor(num/1000)) + "Thousand " + helper(num%1000);
    if (num < 10000000) return helper(Math.floor(num/100000)) + "Lakh " + helper(num%100000);
    return helper(Math.floor(num/10000000)) + "Crore " + helper(num%10000000);
  }
  return helper(n).trim() + " Rupees Only";
}

// Parse "June 2026" or "June, 2026" → { month: 6, year: 2026 }
function parsePeriod(period: string): { month: number; year: number } {
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const clean  = period.replace(/,/g, "").trim();
  const parts  = clean.split(/\s+/);
  const yearStr = parts.find(p => /^\d{4}$/.test(p)) ?? "0";
  const monthStr = parts.find(p => MONTHS.includes(p)) ?? parts[0] ?? "";
  const month = MONTHS.indexOf(monthStr) + 1;
  const year  = parseInt(yearStr, 10);
  return { month: month > 0 ? month : 1, year: year || new Date().getFullYear() };
}

function fyLabel(year: number): string {
  return `FY ${year - 1}-${String(year).slice(2)}`;
}

// Map a Firestore compensation doc to PaySlip
function toPaySlip(raw: Record<string, unknown>, empInfo: EmployeeInfo): PaySlip {
  const period   = String(raw.month ?? "");
  const { month, year } = parsePeriod(period);
  const salary   = Number(raw.salary ?? 0);
  const incentive= Number(raw.incentive ?? 0);
  const bonus    = Number(raw.bonus ?? 0);
  const ded      = Number(raw.deductions ?? 0);
  const net      = Number(raw.netPay ?? raw.net ?? (salary + incentive + bonus - ded));
  const gross    = salary + incentive;
  const totalPay = net + bonus;

  const earnings: EarningRow[] = [];
  if (salary > 0)    earnings.push({ label: "Basic Salary",    amount: salary });
  if (incentive > 0) earnings.push({ label: "Incentive",       amount: incentive });

  const deductions: DeductionRow[] = [];
  if (ded > 0)       deductions.push({ label: "Total Deductions", amount: ded });

  const daysInMonth = new Date(year, month, 0).getDate();

  return {
    id:            String(raw.id ?? ""),
    period,
    periodYear:    year,
    periodMonth:   month,
    type:          "Regular",
    workDays:      daysInMonth,
    gross,
    deduction:     ded,
    tds:           0,
    net,
    bonus,
    totalPay,
    paymentStatus: String(raw.paymentStatus ?? "Pending"),
    paymentDate:   String(raw.paymentDate ?? ""),
    empName:       String(raw.name ?? empInfo.name),
    empType:       String(raw.empType ?? empInfo.empType ?? "Full-Time"),
    designation:   String(raw.designation ?? empInfo.designation),
    department:    empInfo.department,
    empId:         String(raw.empId ?? ""),
    earnings,
    deductions,
  };
}

// Returns FY start year for a given month+year (FY April→March)
function fyStartYear(month: number, year: number): number {
  return month >= 4 ? year : year - 1;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CompensationPage() {
  const [loading,   setLoading]   = useState(true);
  const [allSlips,  setAllSlips]  = useState<PaySlip[]>([]);
  const [empInfo,   setEmpInfo]   = useState<EmployeeInfo>({ name: "—", designation: "—", department: "—", joinDate: "—", empType: "Full-Time" });
  const [fy,        setFy]        = useState(() => {
    const now = new Date();
    return fyLabel(fyStartYear(now.getMonth() + 1, now.getFullYear()) + 1);
  });
  const [masked,    setMasked]    = useState(false);
  const [slipModal, setSlipModal] = useState<PaySlip | null>(null);

  // ── Firebase load ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }

      try {
        let resolvedId = "";
        let empName    = "";
        let info: EmployeeInfo = { name: "", designation: "", department: "", joinDate: "", empType: "Full-Time" };

        // 1. Primary: users/{uid}.employeeId — set explicitly by HR during account creation
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
          const ud = uSnap.data() as Record<string, unknown>;
          resolvedId = String(ud.employeeId ?? "");
          if (!empName) empName = String(ud.name ?? ud.displayName ?? "");
          if (resolvedId) {
            const eSnap = await getDoc(doc(db, "employees", resolvedId));
            if (eSnap.exists()) {
              const ed = eSnap.data() as Record<string, unknown>;
              empName = String(ed.name ?? empName);
              info = {
                name:        empName,
                designation: String(ed.designation ?? ""),
                department:  String(ed.department ?? ""),
                joinDate:    String(ed.joiningDate ?? ed.startDate ?? ""),
                empType:     String(ed.workMode ?? ed.employmentType ?? "Full-Time"),
              };
            }
          }
        }

        // 2. Fallback: email lookup in employees collection (only if users doc has no employeeId)
        if (!resolvedId && user.email) {
          const es = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!es.empty) {
            const ed = es.docs[0].data() as Record<string, unknown>;
            resolvedId = es.docs[0].id;
            empName    = empName || String(ed.name ?? "");
            info = {
              name:        empName,
              designation: String(ed.designation ?? ""),
              department:  String(ed.department ?? ""),
              joinDate:    String(ed.joiningDate ?? ed.startDate ?? ""),
              empType:     String(ed.workMode ?? ed.employmentType ?? "Full-Time"),
            };
          }
        }

        setEmpInfo({ ...info, name: info.name || empName || "—" });

        // 3. Build parallel queries — match by every known identifier
        const queryPromises: Promise<import("firebase/firestore").QuerySnapshot>[] = [];
        if (resolvedId) {
          queryPromises.push(getDocs(query(collection(db, "compensation"), where("empId", "==", resolvedId))));
        }
        if (empName) {
          queryPromises.push(getDocs(query(collection(db, "compensation"), where("name", "==", empName))));
        }
        if (user.email) {
          queryPromises.push(getDocs(query(collection(db, "compensation"), where("email", "==", user.email))));
        }

        if (queryPromises.length === 0) { setLoading(false); return; }

        const snapshots = await Promise.all(queryPromises);

        // Dedup by document ID
        const seen = new Set<string>();
        const allDocs = snapshots.flatMap(s => s.docs).filter(d => {
          if (seen.has(d.id)) return false;
          seen.add(d.id);
          return true;
        });

        const finalInfo: EmployeeInfo = { ...info, name: info.name || empName || "—" };
        const slips = allDocs
          .map(d => toPaySlip({ ...d.data(), id: d.id }, finalInfo))
          .filter(s => s.period)
          .sort((a, b) => {
            if (a.periodYear !== b.periodYear) return b.periodYear - a.periodYear;
            return b.periodMonth - a.periodMonth;
          });

        setAllSlips(slips);
      } catch { /* ignore */ }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Filter by FY ─────────────────────────────────────────────────────────
  // FY string format: "FY 2025-26" → start year 2025, end year 2026
  const fyStartYearNum = (() => {
    const m = fy.match(/FY\s+(\d{4})/);
    return m ? parseInt(m[1], 10) : new Date().getFullYear() - 1;
  })();

  const slips = allSlips.filter(s => {
    const sfy = fyStartYear(s.periodMonth, s.periodYear);
    return sfy === fyStartYearNum;
  });

  const val = (n: number) => masked ? "••••••" : fmt(n);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const latestSlip   = slips[0];
  const totalTds     = slips.reduce((s, p) => s + p.tds, 0);
  const totalPay     = slips.reduce((s, p) => s + p.totalPay, 0);
  const pendingSlips = slips.filter(s => s.paymentStatus === "Pending" || s.paymentStatus === "Processing");
  const pendingAmt   = pendingSlips.reduce((s, p) => s + p.totalPay, 0);

  // ── FY options — derive from actual slip data so no record is ever hidden ──
  const fyOptions = (() => {
    const fys = new Set<string>();
    // Always include current FY
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const yr = now.getFullYear() - i;
      fys.add(fyLabel(yr));
    }
    // Also include FY for each existing slip
    allSlips.forEach(s => fys.add(fyLabel(fyStartYear(s.periodMonth, s.periodYear) + 1)));
    return [...fys].sort((a, b) => b.localeCompare(a));
  })();

  // ── Payslip HTML for print/download ──────────────────────────────────────
  function buildSlipHtml(slip: PaySlip, autoPrint = true): string {
    const maxRows = Math.max(slip.earnings.length, slip.deductions.length, 1);
    const rows = Array.from({ length: maxRows }).map((_, i) => `
      <tr>
        <td style="border:1px solid #bbb;padding:6px 10px;font-size:11px;">${slip.earnings[i]?.label ?? ""}</td>
        <td style="border:1px solid #bbb;padding:6px 10px;text-align:right;font-size:11px;">${slip.earnings[i] ? slip.earnings[i].amount.toLocaleString("en-IN") : ""}</td>
        <td style="border:1px solid #bbb;padding:6px 10px;font-size:11px;">${slip.deductions[i]?.label ?? ""}</td>
        <td style="border:1px solid #bbb;padding:6px 10px;text-align:right;font-size:11px;">${slip.deductions[i] ? slip.deductions[i].amount.toLocaleString("en-IN") : ""}</td>
      </tr>`).join("");

    const joinStr = slip.paymentDate
      ? new Date(slip.paymentDate).toLocaleDateString("en-IN")
      : empInfo.joinDate || "—";

    // autoPrint=true (download): auto-trigger browser print dialog
    // autoPrint=false (view): no toolbar needed — React overlay handles Print/Close
    const toolbar = autoPrint
      ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},400);});</script>`
      : ``;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Salary Slip - ${slip.period}</title>
  <style>
    @page { size: A4; margin: 12mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a2e; background: #f0f2f5; }
    .page { max-width: 860px; margin: 20px auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.10); }

    /* ── Header ── */
    .header { display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; border-bottom: 1px solid #e5e7eb; }
    .logo { font-size: 28px; font-weight: 900; letter-spacing: -1px; line-height: 1; }
    .logo .wo { color: #0B1929; }
    .logo .ways { color: #14B8A6; }
    .header-addr { text-align: right; font-size: 10px; color: #6b7280; line-height: 1.6; }
    .header-addr strong { font-size: 11px; color: #374151; display: block; margin-bottom: 2px; }

    /* ── Title Bar ── */
    .title-bar { background: #0d1b2a; color: #fff; padding: 12px 28px; display: flex; align-items: center; justify-content: space-between; }
    .title-bar .label { font-size: 15px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .title-bar .month { font-size: 13px; font-weight: 500; opacity: .8; }

    /* ── Employee Info ── */
    .emp-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; border-bottom: 1px solid #e0e4ef; }
    .emp-cell { padding: 9px 16px; border-right: 1px solid #e0e4ef; border-bottom: 1px solid #e0e4ef; }
    .emp-cell:nth-child(3n) { border-right: none; }
    .emp-cell .lbl { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .emp-cell .val { font-size: 12px; font-weight: 700; color: #1B2B6B; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; }
    .badge-paid    { background: #dcfce7; color: #166534; }
    .badge-pending { background: #fef9c3; color: #854d0e; }

    /* ── Earnings / Deductions Table ── */
    .section-wrap { padding: 18px 28px 0; }
    .earnings-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    .earnings-table th { background: #1B2B6B; color: #fff; font-size: 11px; font-weight: 600; padding: 8px 12px; text-align: left; letter-spacing: 0.4px; }
    .earnings-table th.amt { text-align: right; }
    .earnings-table .group-head td { background: #eef0f8; font-weight: 700; font-size: 11px; color: #1B2B6B; text-align: center; padding: 5px 12px; border: 1px solid #dde1f0; }
    .earnings-table td { padding: 7px 12px; border: 1px solid #e8eaf3; font-size: 11px; vertical-align: middle; }
    .earnings-table td.amt { text-align: right; font-variant-numeric: tabular-nums; }
    .earnings-table tr:nth-child(even) td { background: #f8f9fe; }
    .earnings-table .subtotal td { background: #eef0f8; font-weight: 700; font-size: 11px; }
    .earnings-table .subtotal td.amt { color: #1B2B6B; }

    /* ── Net Pay Banner ── */
    .net-pay { margin: 0 28px; background: linear-gradient(135deg, #CC2222 0%, #e03a3a 100%); color: #fff; border-radius: 0 0 8px 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }
    .net-pay .label { font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }
    .net-pay .amount { font-size: 22px; font-weight: 900; letter-spacing: 1px; }
    .net-pay .words { font-size: 10px; color: #ffd0d0; margin-top: 2px; }

    /* ── Signature ── */
    .sig-row { display: flex; justify-content: space-between; padding: 20px 28px 0; }
    .sig-block { text-align: center; }
    .sig-line { width: 140px; border-top: 1.5px solid #1B2B6B; margin: 0 auto 4px; }
    .sig-label { font-size: 10px; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }

    /* ── Footer ── */
    .footer { margin: 14px 28px 20px; padding: 10px 16px; background: #f5f7ff; border-radius: 6px; border-left: 3px solid #CC2222; }
    .footer p { font-size: 9.5px; color: #777; line-height: 1.6; }

    @media print {
      body { background: #fff; }
      .page { box-shadow: none; border-radius: 0; margin: 0; }
      body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>
  ${toolbar}
  <div class="page">

    <!-- Header -->
    <div class="header">
      <div class="logo"><span class="wo">WO</span><span class="ways">WAYS</span></div>
      <div class="header-addr">
        <strong>Woways Technologies Pvt. Ltd.</strong>
        Plot No 5, East Wing, Ground Floor, Financial District,<br>
        Nanakramguda, Serilingampalle (M), Hyderabad – 500032, Telangana, India
      </div>
    </div>

    <!-- Title Bar -->
    <div class="title-bar">
      <span class="label">Salary Slip</span>
      <span class="month">${slip.period}</span>
    </div>

    <!-- Employee Info -->
    <div class="emp-grid">
      <div class="emp-cell"><div class="lbl">Employee Name</div><div class="val">${slip.empName}</div></div>
      <div class="emp-cell"><div class="lbl">Employee Code</div><div class="val">${slip.empId}</div></div>
      <div class="emp-cell"><div class="lbl">Employee Type</div><div class="val">${slip.empType}</div></div>
      <div class="emp-cell"><div class="lbl">Designation</div><div class="val">${slip.designation}</div></div>
      <div class="emp-cell"><div class="lbl">Department</div><div class="val">${slip.department}</div></div>
      <div class="emp-cell"><div class="lbl">Working Days</div><div class="val">${slip.workDays} / ${slip.workDays}</div></div>
      <div class="emp-cell"><div class="lbl">Payment Date</div><div class="val">${slip.paymentDate || "—"}</div></div>
      <div class="emp-cell" style="grid-column:span 2;"><div class="lbl">Payment Status</div><div class="val"><span class="badge ${slip.paymentStatus?.toLowerCase() === "paid" ? "badge-paid" : "badge-pending"}">${slip.paymentStatus}</span></div></div>
    </div>

    <!-- Earnings / Deductions -->
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
          ${rows}
          <tr class="subtotal">
            <td>Gross Earning (A)</td>
            <td class="amt">₹ ${slip.gross.toLocaleString("en-IN")}</td>
            <td>Total Deductions (B)</td>
            <td class="amt">₹ ${slip.deduction.toLocaleString("en-IN")}</td>
          </tr>
          ${slip.bonus > 0 ? `<tr class="subtotal"><td>Net Pay (A – B)</td><td class="amt">₹ ${slip.net.toLocaleString("en-IN")}</td><td>Bonus</td><td class="amt">₹ ${slip.bonus.toLocaleString("en-IN")}</td></tr>` : `<tr class="subtotal"><td>Net Pay (A – B)</td><td class="amt">₹ ${slip.net.toLocaleString("en-IN")}</td><td colspan="2"></td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- Net Pay Banner -->
    <div class="net-pay">
      <div>
        <div class="label">Total Take-Home Pay</div>
        <div class="words">${numberToWords(slip.totalPay)}</div>
      </div>
      <div class="amount">₹ ${slip.totalPay.toLocaleString("en-IN")}</div>
    </div>

    <!-- Signature Row -->
    <div class="sig-row">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">Employee Signature</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">HR / Authorised Signatory</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>&#9432;&nbsp; This is a computer-generated salary slip and does not require a physical signature. &nbsp;|&nbsp; Woways Technologies Pvt. Ltd. &nbsp;|&nbsp; ${slip.period}</p>
    </div>

  </div>
</body>
</html>`;
  }

  function viewSlipWindow(slip: PaySlip) {
    setSlipModal(slip);
  }

  // Download salary slip as HTML file directly to the downloads folder
  function downloadSlip(slip: PaySlip) {
    const html = buildSlipHtml(slip, false);
    const blob = new Blob([html], { type: "application/octet-stream" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `Salary-Slip-${slip.period.replace(/\s/g, "-")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="animate-spin text-[#4F3CC9]" />
      </div>
    );
  }

  const payStatusColor: Record<string, string> = {
    Paid: "bg-green-100 text-green-700",
    Pending: "bg-yellow-100 text-yellow-700",
    Processing: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compensation</h1>
        <p className="text-gray-500 text-sm mt-1">View your salary, payslips and payment details.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "Current Salary",   val: latestSlip ? val(latestSlip.gross) : "—",      sub: latestSlip?.period ?? "No records",   icon: <IndianRupee size={15} className="text-[#4F3CC9]" />,  bg: "bg-purple-50" },
          { label: "Last Net Pay",     val: latestSlip ? val(latestSlip.net)   : "—",      sub: latestSlip?.period ?? "No payslips",  icon: <CheckCircle size={15} className="text-green-600" />, bg: "bg-green-50"  },
          { label: "Total TDS (YTD)",  val: totalTds > 0 ? val(totalTds) : "—",            sub: fy,                                   icon: <TrendingUp size={15} className="text-orange-500" />,  bg: "bg-orange-50" },
          { label: "Pending Payments", val: pendingAmt > 0 ? val(pendingAmt) : "₹0",       sub: pendingSlips.length > 0 ? `${pendingSlips.length} pending` : "All paid", icon: <Clock size={15} className="text-yellow-500" />, bg: "bg-yellow-50" },
          { label: "Total Pay (YTD)",  val: totalPay  > 0 ? val(totalPay)  : "—",          sub: fy,                                   icon: <CreditCard size={15} className="text-blue-500" />,   bg: "bg-blue-50"   },
        ].map(({ label, val: v, sub, icon, bg }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500">{label}</span>
              <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center`}>{icon}</div>
            </div>
            <p className="text-xl font-bold text-gray-900">{v}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Pay Slips Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-900 text-base">Pay Slips for {fy}</h2>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">Currency: INR</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
            >
              {fyOptions.map((f) => <option key={f}>{f}</option>)}
            </select>
            <button
              onClick={() => setMasked((m) => !m)}
              className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              {masked ? <Eye size={14} /> : <EyeOff size={14} />}
              {masked ? "Show" : "Hide"}
            </button>
            <button
              onClick={() => slips.forEach(downloadSlip)}
              disabled={slips.length === 0}
              className="flex items-center gap-1.5 bg-[#4F3CC9] text-white rounded-xl px-4 py-1.5 text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={14} /> Yearly Pay Slips
            </button>
          </div>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">For Period</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Type</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Gross</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Deduction</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Net Pay</th>
              {slips.some(s => s.bonus > 0) && (
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">
                  <span className="flex items-center gap-1">Bonus <Info size={11} className="text-gray-400" /></span>
                </th>
              )}
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Total Pay</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Status</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {slips.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-sm text-gray-400">
                  No payslips found for {fy}
                  {allSlips.length === 0 && <span className="block text-xs mt-1 text-gray-300">HR hasn&apos;t added any compensation records yet</span>}
                </td>
              </tr>
            )}
            {slips.map((slip) => (
              <tr key={slip.id} className="hover:bg-[#F5F3FF] transition-colors">
                <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap text-sm">{slip.period}</td>
                <td className="px-3 py-2.5">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">{slip.type}</span>
                </td>
                <td className="px-3 py-2.5 text-gray-800 font-medium whitespace-nowrap">{val(slip.gross)}</td>
                <td className="px-3 py-2.5 text-red-600 whitespace-nowrap">{slip.deduction > 0 ? val(slip.deduction) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2.5 text-gray-800 font-semibold whitespace-nowrap">{val(slip.net)}</td>
                {slips.some(s => s.bonus > 0) && (
                  <td className="px-3 py-2.5 text-gray-600">{slip.bonus > 0 ? val(slip.bonus) : <span className="text-gray-300">—</span>}</td>
                )}
                <td className="px-3 py-2.5 font-bold text-[#4F3CC9] whitespace-nowrap">{val(slip.totalPay)}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${payStatusColor[slip.paymentStatus] ?? "bg-gray-100 text-gray-600"}`}>
                    {slip.paymentStatus}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <button
                      onClick={() => downloadSlip(slip)}
                      className="flex items-center gap-1 bg-gray-900 text-white text-xs px-2.5 py-1 rounded-lg font-medium hover:bg-gray-700"
                    >
                      <Download size={11} /> Download
                    </button>
                    <button
                      onClick={() => viewSlipWindow(slip)}
                      className="text-xs text-[#4F3CC9] font-semibold hover:underline px-1"
                    >
                      View
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payslip Card Modal */}
      {slipModal && (() => {
        const slip = slipModal;
        const gross = slip.earnings.reduce((s, e) => s + e.amount, 0);
        const payStatusColor: Record<string, string> = {
          Paid: "bg-green-100 text-green-700",
          Pending: "bg-yellow-100 text-yellow-700",
          Processing: "bg-blue-100 text-blue-700",
        };
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSlipModal(null)}>
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b">
                <div>
                  <h2 className="text-base font-bold text-gray-900">Payslip — {slip.empName}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{slip.empId} · {slip.designation} · {slip.period}</p>
                </div>
                <button onClick={() => setSlipModal(null)}><X size={20} /></button>
              </div>
              <div className="p-6">
                <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className="bg-gradient-to-br from-[#f5f3ff] to-[#f0fdfa] px-8 py-6 border-b border-gray-100 text-center">
                    <div className="flex items-center justify-center leading-none mb-1.5">
                      <span className="text-3xl font-black text-[#0B1929] tracking-tight">WO</span>
                      <span className="text-3xl font-black text-[#14B8A6] tracking-tight">WAYS</span>
                    </div>
                    <p className="text-xs text-gray-400">Salary Slip for {slip.period}</p>
                  </div>
                  <div className="px-8 py-5 bg-gray-50/60 border-b border-gray-100">
                    <div className="grid grid-cols-2 gap-x-10 gap-y-4">
                      {[
                        { label: "Employee Name", value: slip.empName },
                        { label: "Employee ID",   value: slip.empId },
                        { label: "Designation",   value: slip.designation || "—" },
                        { label: "Emp Type",      value: slip.empType },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">{label}</p>
                          <p className="text-sm font-semibold text-gray-900">{value}</p>
                        </div>
                      ))}
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Payment Status</p>
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${payStatusColor[slip.paymentStatus] ?? "bg-gray-100 text-gray-600"}`}>{slip.paymentStatus}</span>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Payment Date</p>
                        <p className="text-sm font-semibold text-gray-900">{slip.paymentDate || "—"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-gray-100">
                    <div className="px-7 py-5">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Earnings</p>
                      <div className="space-y-2.5 text-sm">
                        {slip.earnings.map((e) => (
                          <div key={e.label} className="flex justify-between">
                            <span className="text-gray-500">{e.label}</span>
                            <span className="font-semibold text-gray-900">₹{e.amount.toLocaleString("en-IN")}</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-bold border-t border-gray-100 pt-2.5 mt-1 text-gray-900">
                          <span>Gross Total</span><span>₹{gross.toLocaleString("en-IN")}</span>
                        </div>
                      </div>
                    </div>
                    <div className="px-7 py-5">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Deductions</p>
                      <div className="space-y-2.5 text-sm">
                        {slip.deductions.length > 0
                          ? slip.deductions.map((d) => (
                              <div key={d.label} className="flex justify-between">
                                <span className="text-gray-500">{d.label}</span>
                                <span className="font-semibold text-red-500">₹{d.amount.toLocaleString("en-IN")}</span>
                              </div>
                            ))
                          : <p className="text-xs text-gray-400 py-1">No deductions this month</p>}
                        <div className="flex justify-between font-bold border-t border-gray-100 pt-2.5 mt-1">
                          <span className="text-gray-900">Total</span>
                          <span className="text-red-500">₹{slip.deduction.toLocaleString("en-IN")}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="px-8 py-5 bg-[#EDE9FF]/50 border-t border-[#4F3CC9]/10 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Net Pay</p>
                      <p className="text-2xl font-black text-[#4F3CC9]">₹{slip.totalPay.toLocaleString("en-IN")}</p>
                    </div>
                    <button
                      onClick={() => downloadSlip(slip)}
                      className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-[#3d2fa8] transition-colors shadow-sm">
                      <Download size={14} /> Download Payslip
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
