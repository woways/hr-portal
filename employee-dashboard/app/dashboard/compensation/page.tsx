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
  const [masked, setMasked] = useState(false);
  const [viewSlip, setViewSlip] = useState<PaySlip | null>(null);

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

  // Build printable HTML for a payslip
  function buildSlipHtml(slip: PaySlip): string {
    const maxRows = Math.max(slip.earnings.length, slip.deductions.length);
    const rows = Array.from({ length: maxRows }).map((_, i) => `
      <tr>
        <td style="border:1px solid #bbb;padding:6px 10px;font-size:11px;">${slip.earnings[i]?.label ?? ""}</td>
        <td style="border:1px solid #bbb;padding:6px 10px;text-align:right;font-size:11px;">${slip.earnings[i] ? slip.earnings[i].amount.toLocaleString("en-IN") : ""}</td>
        <td style="border:1px solid #bbb;padding:6px 10px;font-size:11px;">${slip.deductions[i]?.label ?? ""}</td>
        <td style="border:1px solid #bbb;padding:6px 10px;text-align:right;font-size:11px;">${slip.deductions[i] ? slip.deductions[i].amount.toLocaleString("en-IN") : ""}</td>
      </tr>`).join("");
    const emp = empProfile;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Salary Slip - ${slip.period}</title>
<style>
  @page{size:A4;margin:15mm}*{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#111}
  table{width:100%;border-collapse:collapse}
  .th{font-weight:bold;background:#efefef;padding:6px 10px;border:1px solid #bbb;font-size:11px}
  .total-row{font-weight:bold;background:#efefef}
  .footer{margin-top:18px;font-size:9px;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:8px}
</style></head><body>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},400)});</script>
<table style="border:1px solid #bbb;border-collapse:collapse;margin-bottom:0">
  <tr>
    <td style="border:1px solid #bbb;padding:12px;width:130px;text-align:center">
      <div style="background:#4F3CC9;color:#fff;font-weight:800;font-size:18px;padding:10px 14px;border-radius:6px;display:inline-block">W</div>
    </td>
    <td style="border:1px solid #bbb;padding:10px;text-align:center">
      <div style="font-weight:bold;font-size:12px">Office Address: Plot No 5, East Wing, Ground Floor, Financial District,</div>
      <div style="font-size:11px;margin-top:2px">Nanakramguda, Serilingampalle (M), Hyderabad – 500032, Telangana, India</div>
      <div style="font-weight:bold;font-size:11px;margin-top:4px">Business Unit: Woways</div>
    </td>
  </tr>
  <tr><td colspan="2" style="border:1px solid #bbb;padding:7px;text-align:center;font-weight:bold;font-size:13px;background:#f0f0f0">Salary Slip for ${slip.period}</td></tr>
</table>
<table style="border-collapse:collapse;border-top:none">
  <tr>
    <td style="border:1px solid #bbb;padding:5px 10px;width:33%"><span style="color:#666">Employee Name: </span><strong>${emp?.name ?? "—"}</strong></td>
    <td style="border:1px solid #bbb;padding:5px 10px;width:33%"><span style="color:#666">Employee Type: </span><strong>${emp?.empType ?? "—"}</strong></td>
    <td style="border:1px solid #bbb;padding:5px 10px;width:34%"><span style="color:#666">Employee Code: </span><strong>${emp?.empId ?? "—"}</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #bbb;padding:5px 10px"><span style="color:#666">Designation: </span><strong>${emp?.designation ?? "—"}</strong></td>
    <td colspan="2" style="border:1px solid #bbb;padding:5px 10px"><span style="color:#666">Department: </span><strong>${emp?.department ?? "—"}</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #bbb;padding:5px 10px"><span style="color:#666">Date of Joining: </span><strong>${emp?.doj ?? "—"}</strong></td>
    <td colspan="2" style="border:1px solid #bbb;padding:5px 10px"><span style="color:#666">Working Days: </span><strong>${slip.workDays}</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #bbb;padding:5px 10px"><span style="color:#666">UAN No: </span><strong>${emp?.uanNumber ?? "—"}</strong></td>
    <td colspan="2" style="border:1px solid #bbb;padding:5px 10px"><span style="color:#666">PAN No: </span><strong>${emp?.panNumber ?? "—"}</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #bbb;padding:5px 10px"><span style="color:#666">Payment Status: </span><strong>${slip.paymentStatus}</strong></td>
    <td colspan="2" style="border:1px solid #bbb;padding:5px 10px"><span style="color:#666">Payment Date: </span><strong>${slip.paymentDate || "—"}</strong></td>
  </tr>
</table>
<table style="border-collapse:collapse;border-top:none;margin-top:0">
  <tr>
    <td colspan="2" class="th" style="text-align:center;width:50%">Earnings</td>
    <td colspan="2" class="th" style="text-align:center;width:50%">Deductions</td>
  </tr>
  <tr>
    <td class="th">Components</td><td class="th" style="text-align:right">Amount (₹)</td>
    <td class="th">Common Deductions</td><td class="th" style="text-align:right">Amount (₹)</td>
  </tr>
  ${rows}
  <tr class="total-row">
    <td style="border:1px solid #bbb;padding:6px 10px">Gross Earning (A)</td>
    <td style="border:1px solid #bbb;padding:6px 10px;text-align:right">${slip.gross.toLocaleString("en-IN")}</td>
    <td style="border:1px solid #bbb;padding:6px 10px">Total Deductions (B)</td>
    <td style="border:1px solid #bbb;padding:6px 10px;text-align:right">${slip.deduction.toLocaleString("en-IN")}</td>
  </tr>
  <tr>
    <td style="border:1px solid #bbb;padding:6px 10px;font-weight:bold">Net Pay (A – B)</td>
    <td style="border:1px solid #bbb;padding:6px 10px;text-align:right;font-weight:bold">${slip.net.toLocaleString("en-IN")}</td>
    <td rowspan="2" style="border:1px solid #bbb;padding:6px 10px"></td>
    <td rowspan="2" style="border:1px solid #bbb;padding:6px 10px"></td>
  </tr>
  <tr class="total-row">
    <td style="border:1px solid #bbb;padding:6px 10px">Total Pay</td>
    <td style="border:1px solid #bbb;padding:6px 10px;text-align:right">${slip.totalPay.toLocaleString("en-IN")}</td>
  </tr>
  <tr>
    <td colspan="2" style="border:1px solid #bbb;padding:5px 10px"></td>
    <td colspan="2" style="border:1px solid #bbb;padding:5px 10px;font-style:italic;color:#555;font-size:10px">${numberToWords(slip.totalPay)}</td>
  </tr>
</table>
<div class="footer">This is a system-generated salary slip and does not require a physical signature. | Woways | ${slip.period}</div>
</body></html>`;
  }

  function downloadSlip(slip: PaySlip) {
    const html = buildSlipHtml(slip);
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { alert("Please allow pop-ups to download payslips."); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
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
              onChange={(e) => { setFy(e.target.value); setViewSlip(null); }}
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
              <tr key={slip.id} className={`hover:bg-[#F5F3FF] transition-colors ${viewSlip?.id === slip.id ? "bg-[#EDE9FF]/40" : ""}`}>
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
                    <button onClick={() => setViewSlip(viewSlip?.id === slip.id ? null : slip)} className="text-xs text-[#4F3CC9] font-semibold hover:underline px-1">
                      {viewSlip?.id === slip.id ? "Close" : "View"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Inline Payslip Viewer */}
      {viewSlip && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setViewSlip(null)}>
          <div className="bg-white w-full max-w-3xl shadow-2xl rounded-xl overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200 shrink-0">
              <p className="text-xs text-gray-500 font-medium">Salary Slip — {viewSlip.period}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadSlip(viewSlip)} className="flex items-center gap-1.5 bg-[#4F3CC9] text-white text-xs px-3 py-1.5 rounded-lg font-medium hover:bg-[#3d2fa3]">
                  <Download size={12} /> Download
                </button>
                <button onClick={() => setViewSlip(null)} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500"><X size={16} /></button>
              </div>
            </div>

            <div className="overflow-y-auto p-4 text-xs font-sans" style={{ fontFamily: "Arial, sans-serif" }}>
              {/* Company Header */}
              <table className="w-full border border-gray-400 border-collapse mb-0">
                <tbody>
                  <tr>
                    <td className="border border-gray-400 p-3 w-32 align-middle">
                      <div className="w-20 h-10 bg-[#4F3CC9] rounded flex items-center justify-center text-white font-bold text-sm">W</div>
                    </td>
                    <td className="border border-gray-400 p-3 text-center">
                      <p className="font-semibold text-gray-800 text-xs">Office Address: Plot No 5, East Wing, Ground Floor, Financial District,</p>
                      <p className="text-gray-700 text-xs">Nanakramguda, Serilingampalle (M), Hyderabad – 500032, Telangana, India</p>
                      <p className="font-semibold text-gray-800 text-xs mt-0.5">Business Unit: Woways</p>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="border border-gray-400 py-2 text-center font-bold text-sm text-gray-900 bg-gray-50">
                      Salary Slip for {viewSlip.period}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Employee Info */}
              <table className="w-full border border-gray-400 border-collapse border-t-0">
                <tbody>
                  <tr>
                    <td className="border border-gray-400 px-2 py-1 w-1/3"><span className="text-gray-500">Employee Name: </span><strong>{empProfile?.name ?? "—"}</strong></td>
                    <td className="border border-gray-400 px-2 py-1 w-1/3"><span className="text-gray-500">Employee Type: </span><strong>{empProfile?.empType ?? "—"}</strong></td>
                    <td className="border border-gray-400 px-2 py-1 w-1/3"><span className="text-gray-500">Employee Code: </span><strong>{empProfile?.empId ?? "—"}</strong></td>
                  </tr>
                  <tr>
                    <td className="border border-gray-400 px-2 py-1"><span className="text-gray-500">Designation: </span><strong>{empProfile?.designation ?? "—"}</strong></td>
                    <td className="border border-gray-400 px-2 py-1" colSpan={2}><span className="text-gray-500">Department: </span><strong>{empProfile?.department ?? "—"}</strong></td>
                  </tr>
                  <tr>
                    <td className="border border-gray-400 px-2 py-1"><span className="text-gray-500">Date of Joining: </span><strong>{empProfile?.doj ?? "—"}</strong></td>
                    <td className="border border-gray-400 px-2 py-1" colSpan={2}><span className="text-gray-500">Working Days: </span><strong>{viewSlip.workDays}</strong></td>
                  </tr>
                  <tr>
                    <td className="border border-gray-400 px-2 py-1"><span className="text-gray-500">UAN No: </span><strong>{empProfile?.uanNumber ?? "—"}</strong></td>
                    <td className="border border-gray-400 px-2 py-1" colSpan={2}><span className="text-gray-500">PAN No: </span><strong>{empProfile?.panNumber ?? "—"}</strong></td>
                  </tr>
                  <tr>
                    <td className="border border-gray-400 px-2 py-1"><span className="text-gray-500">Payment Status: </span>
                      <strong className={viewSlip.paymentStatus === "Paid" ? "text-green-700" : "text-yellow-700"}>{viewSlip.paymentStatus}</strong>
                    </td>
                    <td className="border border-gray-400 px-2 py-1" colSpan={2}><span className="text-gray-500">Payment Date: </span><strong>{viewSlip.paymentDate || "—"}</strong></td>
                  </tr>
                </tbody>
              </table>

              {/* Earnings & Deductions */}
              <table className="w-full border border-gray-400 border-collapse border-t-0">
                <thead>
                  <tr>
                    <td colSpan={2} className="border border-gray-400 py-1 text-center font-bold text-gray-900 bg-gray-50 w-1/2">Earnings</td>
                    <td colSpan={2} className="border border-gray-400 py-1 text-center font-bold text-gray-900 bg-gray-50 w-1/2">Deductions</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-400 px-2 py-1 font-bold text-gray-800">Components</td>
                    <td className="border border-gray-400 px-2 py-1 font-bold text-gray-800 text-right">Amount (₹)</td>
                    <td className="border border-gray-400 px-2 py-1 font-bold text-gray-800">Common Deductions</td>
                    <td className="border border-gray-400 px-2 py-1 font-bold text-gray-800 text-right">Amount (₹)</td>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.max(viewSlip.earnings.length, viewSlip.deductions.length) }).map((_, i) => (
                    <tr key={i}>
                      <td className="border border-gray-400 px-2 py-1 text-gray-800">{viewSlip.earnings[i]?.label ?? ""}</td>
                      <td className="border border-gray-400 px-2 py-1 text-right text-gray-900">{viewSlip.earnings[i] ? viewSlip.earnings[i].amount.toLocaleString("en-IN") : ""}</td>
                      <td className="border border-gray-400 px-2 py-1 text-gray-800">{viewSlip.deductions[i]?.label ?? ""}</td>
                      <td className="border border-gray-400 px-2 py-1 text-right text-gray-900">{viewSlip.deductions[i] ? viewSlip.deductions[i].amount.toLocaleString("en-IN") : ""}</td>
                    </tr>
                  ))}
                  <tr className="font-bold bg-gray-50">
                    <td className="border border-gray-400 px-2 py-1">Gross Earning (A)</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{viewSlip.gross.toLocaleString("en-IN")}</td>
                    <td className="border border-gray-400 px-2 py-1">Total Deductions (B)</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{viewSlip.deduction.toLocaleString("en-IN")}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="border border-gray-400 px-2 py-1">Net Pay (A – B)</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{viewSlip.net.toLocaleString("en-IN")}</td>
                    <td className="border border-gray-400 px-2 py-1" rowSpan={2}></td>
                    <td className="border border-gray-400 px-2 py-1 text-right" rowSpan={2}></td>
                  </tr>
                  <tr className="font-bold bg-gray-50">
                    <td className="border border-gray-400 px-2 py-1">Total Pay</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{viewSlip.totalPay.toLocaleString("en-IN")}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="border border-gray-400 px-2 py-1 text-gray-400 italic text-xs"></td>
                    <td colSpan={2} className="border border-gray-400 px-2 py-1 text-gray-700 italic text-xs">{numberToWords(viewSlip.totalPay)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-center text-gray-400 text-xs mt-3">This is a system-generated salary slip and does not require a physical signature.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
