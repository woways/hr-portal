"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, query, where, getDocs, QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  DollarSign, TrendingUp, Clock, CheckCircle, Download,
  Eye, EyeOff, CreditCard, X, Info, Loader2, FileText,
} from "lucide-react";

interface PaySlip {
  id: string;
  period: string;        // e.g. "June 2026"
  type: "Regular" | "Off-Cycle";
  workDays: number;
  gross: number;
  deduction: number;
  tds: number;
  net: number;
  offCycleNonTaxable: number;
  totalPay: number;
  paymentStatus: string;
  paymentDate: string;
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
}

interface EmpProfile {
  name: string;
  empId: string;
  designation: string;
  department: string;
  doj: string;
  pfNumber: string;
  uanNumber: string;
  panNumber: string;
  empType: string;
}

const MONTH_ORDER: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parsePeriod(period: string): { month: number; year: number } {
  const parts = period.trim().split(" ");
  return { month: MONTH_ORDER[parts[0]] ?? 0, year: parseInt(parts[1]) || 0 };
}

function getFY(period: string): string {
  const { month, year } = parsePeriod(period);
  if (month >= 4) return `FY ${year}-${String(year + 1).slice(2)}`;
  return `FY ${year - 1}-${String(year).slice(2)}`;
}

function getCurrentFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 4) return `FY ${year}-${String(year + 1).slice(2)}`;
  return `FY ${year - 1}-${String(year).slice(2)}`;
}

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

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

export default function CompensationPage() {
  const [paySlipsByFY, setPaySlipsByFY] = useState<Record<string, PaySlip[]>>({});
  const [empProfile, setEmpProfile] = useState<EmpProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fy, setFy] = useState(getCurrentFY());
  const [masked,    setMasked]    = useState(false);
  const [slipModal, setSlipModal] = useState<PaySlip | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        // Step 1: resolve the employee's Firestore document ID by email
        // This is more reliable than users/{uid}.employeeId which can get out of sync
        let resolvedEmpId = "";
        let empDocData: DocumentData | null = null;

        // Primary: look up employees collection by email
        if (user.email) {
          const byEmail = await getDocs(
            query(collection(db, "employees"), where("email", "==", user.email))
          );
          if (!byEmail.empty) {
            const empDoc: QueryDocumentSnapshot = byEmail.docs[0];
            resolvedEmpId = empDoc.id;
            empDocData = empDoc.data();
          }
        }

        // Fallback: use users/{uid}.employeeId then fetch from employees collection
        if (!resolvedEmpId) {
          const userSnap = await getDoc(doc(db, "users", user.uid));
          if (userSnap.exists()) {
            const uid_empId = userSnap.data().employeeId as string;
            if (uid_empId) {
              const empSnap = await getDoc(doc(db, "employees", uid_empId));
              if (empSnap.exists()) {
                resolvedEmpId = uid_empId;
                empDocData = empSnap.data();
              }
            }
          }
        }

        if (!resolvedEmpId) { setLoading(false); return; }
        const empId = resolvedEmpId;

        // Set employee profile from the resolved document
        if (empDocData) {
          setEmpProfile({
            name:        (empDocData.name as string) ?? "",
            empId,
            designation: (empDocData.designation as string) ?? "",
            department:  (empDocData.department as string) ?? "",
            doj:         (empDocData.doj as string) ?? "",
            pfNumber:    (empDocData.pfNumber as string) ?? "—",
            uanNumber:   (empDocData.uanNumber as string) ?? "—",
            panNumber:   (empDocData.panNumber as string) ?? "—",
            empType:     (empDocData.employmentType as string) ?? "Full-Time",
          });
        }

        // Fetch all compensation records for this employee
        const compSnap = await getDocs(
          query(collection(db, "compensation"), where("empId", "==", empId))
        );

        const grouped: Record<string, PaySlip[]> = {};
        compSnap.docs.forEach((d) => {
          const raw = d.data();
          const salary    = Number(raw.salary    ?? 0);
          const incentive = Number(raw.incentive ?? 0);
          const bonus     = Number(raw.bonus     ?? 0);
          const deduction = Number(raw.deductions ?? 0);
          const netPay    = Number(raw.netPay    ?? 0);
          const gross     = salary + incentive + bonus;

          const earnings: { label: string; amount: number }[] = [
            { label: "Basic Salary", amount: salary },
          ];
          if (incentive > 0) earnings.push({ label: "Incentive", amount: incentive });
          if (bonus > 0)     earnings.push({ label: "Bonus",     amount: bonus     });

          const deductionLines: { label: string; amount: number }[] = [];
          if (deduction > 0) deductionLines.push({ label: "Total Deductions", amount: deduction });

          const slip: PaySlip = {
            id:                 d.id,
            period:             (raw.month as string) ?? "",
            type:               "Regular",
            workDays:           30,
            gross,
            deduction,
            tds:                0,
            net:                netPay,
            offCycleNonTaxable: 0,
            totalPay:           netPay,
            paymentStatus:      (raw.paymentStatus as string) ?? "Pending",
            paymentDate:        (raw.paymentDate   as string) ?? "",
            earnings,
            deductions:         deductionLines,
          };

          const fyKey = getFY(slip.period);
          if (!grouped[fyKey]) grouped[fyKey] = [];
          grouped[fyKey].push(slip);
        });

        // Sort each FY's slips newest first
        Object.values(grouped).forEach((arr) =>
          arr.sort((a, b) => {
            const pa = parsePeriod(a.period), pb = parsePeriod(b.period);
            return pb.year !== pa.year ? pb.year - pa.year : pb.month - pa.month;
          })
        );

        setPaySlipsByFY(grouped);

        // Set FY to the one with most recent record if current FY has none
        const fyKeys = Object.keys(grouped).sort().reverse();
        if (fyKeys.length > 0 && !grouped[getCurrentFY()]) setFy(fyKeys[0]);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const slips = paySlipsByFY[fy] ?? [];
  const fyKeys = Object.keys(paySlipsByFY).sort().reverse();

  // Stats derived from ALL records across all FYs and current FY
  const allSlips = Object.values(paySlipsByFY).flat();
  const currentFYSlips = paySlipsByFY[getCurrentFY()] ?? [];
  const latestSlip = allSlips.sort((a, b) => {
    const pa = parsePeriod(a.period), pb = parsePeriod(b.period);
    return pb.year !== pa.year ? pb.year - pa.year : pb.month - pa.month;
  })[0];
  const currentSalary   = latestSlip?.gross ?? 0;
  const lastNetPay      = latestSlip?.net   ?? 0;
  const ytdNetPay       = currentFYSlips.reduce((s, p) => s + p.net, 0);
  const ytdDeductions   = currentFYSlips.reduce((s, p) => s + p.deduction, 0);
  const pendingPay      = allSlips.filter((p) => p.paymentStatus !== "Paid").reduce((s, p) => s + p.net, 0);
  const fyRange         = currentFYSlips.length > 0
    ? `${currentFYSlips[currentFYSlips.length - 1].period} – ${currentFYSlips[0].period}`
    : getCurrentFY();

  const val = (n: number) => masked ? "••••••" : fmt(n);

  function buildSlipHtml(slip: PaySlip): string {
    const emp = empProfile;
    const maxRows = Math.max(slip.earnings.length, slip.deductions.length, 1);
    const rows = Array.from({ length: maxRows }).map((_, i) => `
      <tr>
        <td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;">${slip.earnings[i]?.label ?? ""}</td>
        <td style="border:1px solid #e8eaf3;padding:7px 12px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;">${slip.earnings[i] ? slip.earnings[i].amount.toLocaleString("en-IN") : ""}</td>
        <td style="border:1px solid #e8eaf3;padding:7px 12px;font-size:11px;">${slip.deductions[i]?.label ?? ""}</td>
        <td style="border:1px solid #e8eaf3;padding:7px 12px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;">${slip.deductions[i] ? slip.deductions[i].amount.toLocaleString("en-IN") : ""}</td>
      </tr>`).join("");

    const badgeStyle = slip.paymentStatus?.toLowerCase() === "paid"
      ? "background:#dcfce7;color:#166534;"
      : "background:#fef9c3;color:#854d0e;";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Salary Slip - ${slip.period}</title>
  <style>
    @page{size:A4;margin:12mm 14mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a2e;background:#f0f2f5}
    .page{max-width:860px;margin:20px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)}
    .header{display:flex;align-items:center;justify-content:space-between;padding:18px 28px;border-bottom:1px solid #e5e7eb}
    .logo{font-size:28px;font-weight:900;letter-spacing:-1px;line-height:1}
    .logo .wo{color:#0B1929}
    .logo .ways{color:#14B8A6}
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
      <span class="lbl">Salary Slip</span>
      <span class="mo">${slip.period}</span>
    </div>
    <div class="emp-grid">
      <div class="emp-cell"><div class="lbl">Employee Name</div><div class="val">${emp?.name ?? "—"}</div></div>
      <div class="emp-cell"><div class="lbl">Employee Code</div><div class="val">${emp?.empId ?? "—"}</div></div>
      <div class="emp-cell"><div class="lbl">Employee Type</div><div class="val">${emp?.empType ?? "—"}</div></div>
      <div class="emp-cell"><div class="lbl">Designation</div><div class="val">${emp?.designation ?? "—"}</div></div>
      <div class="emp-cell"><div class="lbl">Department</div><div class="val">${emp?.department ?? "—"}</div></div>
      <div class="emp-cell"><div class="lbl">Working Days</div><div class="val">${slip.workDays} / 30</div></div>
      <div class="emp-cell"><div class="lbl">Payment Date</div><div class="val">${slip.paymentDate || "—"}</div></div>
      <div class="emp-cell" style="grid-column:span 2"><div class="lbl">Payment Status</div><div class="val"><span class="badge" style="${badgeStyle}">${slip.paymentStatus}</span></div></div>
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
          ${rows}
          <tr class="subtotal">
            <td>Gross Earning (A)</td>
            <td class="amt">₹ ${slip.gross.toLocaleString("en-IN")}</td>
            <td>Total Deductions (B)</td>
            <td class="amt">₹ ${slip.deduction.toLocaleString("en-IN")}</td>
          </tr>
          <tr class="subtotal">
            <td>Net Pay (A – B)</td>
            <td class="amt">₹ ${slip.net.toLocaleString("en-IN")}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="net-pay">
      <div>
        <div class="label">Total Take-Home Pay</div>
        <div class="words">${numberToWords(slip.totalPay)}</div>
      </div>
      <div class="amount">₹ ${slip.totalPay.toLocaleString("en-IN")}</div>
    </div>
    <div class="sig-row">
      <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Employee Signature</div></div>
      <div class="sig-block"><div class="sig-line"></div><div class="sig-label">HR / Authorised Signatory</div></div>
    </div>
    <div class="footer">
      <p>&#9432;&nbsp; This is a computer-generated salary slip and does not require a physical signature. &nbsp;|&nbsp; Woways Technologies Pvt. Ltd. &nbsp;|&nbsp; ${slip.period}</p>
    </div>
  </div>
</body>
</html>`;
  }

  function downloadSlip(slip: PaySlip) {
    const html = buildSlipHtml(slip);
    const blob = new Blob([html], { type: "application/octet-stream" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `Salary_Slip_${slip.period.replace(/\s+/g, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compensation</h1>
        <p className="text-gray-500 text-sm mt-1">View your salary, payslips and payment details.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          {
            label: "Current Salary", icon: <DollarSign size={15} className="text-[#4F3CC9]" />, bg: "bg-purple-50",
            value: loading ? "—" : currentSalary > 0 ? fmt(currentSalary) : "—",
            sub: "Per month",
          },
          {
            label: "Last Net Pay", icon: <CheckCircle size={15} className="text-green-600" />, bg: "bg-green-50",
            value: loading ? "—" : lastNetPay > 0 ? (masked ? "••••••" : fmt(lastNetPay)) : "—",
            sub: latestSlip?.period ?? "No payslips yet",
          },
          {
            label: "Total Deductions (YTD)", icon: <TrendingUp size={15} className="text-orange-500" />, bg: "bg-orange-50",
            value: loading ? "—" : ytdDeductions > 0 ? (masked ? "••••••" : fmt(ytdDeductions)) : "—",
            sub: getCurrentFY(),
          },
          {
            label: "Pending Payments", icon: <Clock size={15} className="text-yellow-500" />, bg: "bg-yellow-50",
            value: loading ? "—" : fmt(pendingPay),
            sub: pendingPay > 0 ? "Awaiting payment" : "No pending",
          },
          {
            label: "Total Pay (YTD)", icon: <CreditCard size={15} className="text-blue-500" />, bg: "bg-blue-50",
            value: loading ? "—" : ytdNetPay > 0 ? (masked ? "••••••" : fmt(ytdNetPay)) : "—",
            sub: fyRange,
          },
        ].map(({ label, icon, bg, value, sub }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500">{label}</span>
              <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center`}>{icon}</div>
            </div>
            <p className="text-xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Payslips Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-900 text-base">Pay Slips for {fy}</h2>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">Currency: INR</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={fy}
              onChange={(e) => { setFy(e.target.value); setSlipModal(null); }}
              className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
              disabled={fyKeys.length === 0}
            >
              {fyKeys.length > 0
                ? fyKeys.map((f) => <option key={f}>{f}</option>)
                : <option>{getCurrentFY()}</option>
              }
            </select>
            <button onClick={() => setMasked((m) => !m)} className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
              {masked ? <Eye size={14} /> : <EyeOff size={14} />}
              {masked ? "Show" : "Hide"}
            </button>
            <button
              onClick={() => slips.forEach(downloadSlip)}
              disabled={slips.length === 0}
              className="flex items-center gap-1.5 bg-[#4F3CC9] text-white rounded-xl px-4 py-1.5 text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-50"
            >
              <Download size={14} /> Yearly Pay Slips
            </button>
          </div>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">For Period</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Type</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Days</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Gross</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Deduction</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">TDS</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Net</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">
                <span className="flex items-center gap-1 leading-tight">Off-Cycle<br/>Non-Taxable <Info size={11} className="text-gray-400 shrink-0" /></span>
              </th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Total Pay</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-gray-400 text-sm">
                  <Loader2 size={20} className="inline animate-spin mr-2" />Loading payslips…
                </td>
              </tr>
            ) : slips.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-gray-400 text-sm">
                  <FileText size={32} className="mx-auto mb-2 text-gray-200" />
                  {Object.keys(paySlipsByFY).length === 0
                    ? "No payslips available yet. Your HR team will generate them each month."
                    : `No payslips available for ${fy}`
                  }
                </td>
              </tr>
            ) : slips.map((slip) => (
              <tr key={slip.id} className="hover:bg-[#F5F3FF] transition-colors">
                <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap text-sm">{slip.period}</td>
                <td className="px-3 py-2.5">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">Regular</span>
                </td>
                <td className="px-3 py-2.5 text-gray-700">{slip.workDays}</td>
                <td className="px-3 py-2.5 text-gray-800 font-medium whitespace-nowrap">{val(slip.gross)}</td>
                <td className="px-3 py-2.5 text-red-600 whitespace-nowrap">{slip.deduction > 0 ? val(slip.deduction) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2.5 text-orange-600 whitespace-nowrap"><span className="text-gray-300">—</span></td>
                <td className="px-3 py-2.5 text-gray-800 font-medium whitespace-nowrap">{val(slip.net)}</td>
                <td className="px-3 py-2.5 text-gray-300">—</td>
                <td className="px-3 py-2.5 font-bold text-[#4F3CC9] whitespace-nowrap">{val(slip.totalPay)}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                    slip.paymentStatus === "Paid" ? "bg-green-100 text-green-700" :
                    slip.paymentStatus === "Processing" ? "bg-blue-100 text-blue-700" :
                    "bg-yellow-100 text-yellow-700"
                  }`}>{slip.paymentStatus}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <button onClick={() => downloadSlip(slip)} className="flex items-center gap-1 bg-gray-900 text-white text-xs px-2.5 py-1 rounded-lg font-medium hover:bg-gray-700">
                      <Download size={11} /> Download
                    </button>
                    <button onClick={() => setSlipModal(slip)} className="text-xs text-[#4F3CC9] font-semibold hover:underline px-1">
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
        const emp = empProfile;
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
                  <h2 className="text-base font-bold text-gray-900">Payslip — {emp?.name ?? "—"}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{emp?.empId ?? "—"} · {emp?.designation ?? "—"} · {slip.period}</p>
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
                        { label: "Employee Name", value: emp?.name ?? "—" },
                        { label: "Employee ID",   value: emp?.empId ?? "—" },
                        { label: "Designation",   value: emp?.designation ?? "—" },
                        { label: "Emp Type",      value: emp?.empType ?? "—" },
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
                            <span className="font-semibold text-gray-900">{fmt(e.amount)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-bold border-t border-gray-100 pt-2.5 mt-1 text-gray-900">
                          <span>Gross Total</span><span>{fmt(gross)}</span>
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
                                <span className="font-semibold text-red-500">{fmt(d.amount)}</span>
                              </div>
                            ))
                          : <p className="text-xs text-gray-400 py-1">No deductions this month</p>}
                        <div className="flex justify-between font-bold border-t border-gray-100 pt-2.5 mt-1">
                          <span className="text-gray-900">Total</span>
                          <span className="text-red-500">{fmt(slip.deduction)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="px-8 py-5 bg-[#EDE9FF]/50 border-t border-[#4F3CC9]/10 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Net Pay</p>
                      <p className="text-2xl font-black text-[#4F3CC9]">{fmt(slip.totalPay)}</p>
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
