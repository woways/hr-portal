"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, query, where, getDocs, QueryDocumentSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Download, CreditCard, ChevronDown, FileText, Loader2 } from "lucide-react";

interface PayslipRecord {
  id: string;
  name: string;
  empId: string;
  designation: string;
  empType: string;
  salary: number;
  incentive: number;
  bonus: number;
  deductions: number;
  netPay: number;
  paymentStatus: string;
  paymentDate: string;
  month: string;
}

function fmt(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

export default function PayslipPage() {
  const [payslips, setPayslips] = useState<PayslipRecord[]>([]);
  const [selected, setSelected] = useState<PayslipRecord | null>(null);
  const [empName, setEmpName] = useState("");
  const [department, setDepartment] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        // Resolve employee by email first (most reliable — avoids users/{uid}.employeeId mismatch)
        let resolvedEmpId = "";

        if (user.email) {
          const byEmail = await getDocs(
            query(collection(db, "employees"), where("email", "==", user.email))
          );
          if (!byEmail.empty) {
            const empDoc: QueryDocumentSnapshot = byEmail.docs[0];
            resolvedEmpId = empDoc.id;
            const d = empDoc.data();
            setEmpName((d.name as string) ?? "");
            setDepartment((d.department as string) ?? "");
          }
        }

        // Fallback: users/{uid}.employeeId
        if (!resolvedEmpId) {
          const userSnap = await getDoc(doc(db, "users", user.uid));
          if (userSnap.exists()) {
            const uid_empId = userSnap.data().employeeId as string;
            if (uid_empId) {
              resolvedEmpId = uid_empId;
              const empSnap = await getDoc(doc(db, "employees", uid_empId));
              if (empSnap.exists()) {
                const d = empSnap.data();
                setEmpName((d.name as string) ?? "");
                setDepartment((d.department as string) ?? "");
              }
            }
          }
        }

        if (!resolvedEmpId) { setLoading(false); return; }
        const empId = resolvedEmpId;

        // Fetch all compensation records for this employee from Firestore
        const compSnap = await getDocs(
          query(collection(db, "compensation"), where("empId", "==", empId))
        );
        const records: PayslipRecord[] = compSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PayslipRecord, "id">),
        }));

        // Sort by createdAt descending (newest first)
        records.sort((a, b) => (b.month ?? "").localeCompare(a.month ?? ""));

        setPayslips(records);
        if (records.length > 0) setSelected(records[0]);
      } catch (err) {
        console.error("[Payslip] Failed to load:", err);
      }
      finally { setLoading(false); }
    });
    return unsub;
  }, []);

  const grossEarnings = selected
    ? (selected.salary || 0) + (selected.incentive || 0) + (selected.bonus || 0)
    : 0;

  function handleDownload() {
    if (!selected) return;
    const lines = [
      "HR Pulse Technologies",
      `Salary Slip — ${selected.month}`,
      "",
      `Employee Name : ${selected.name}`,
      `Employee ID   : ${selected.empId}`,
      `Designation   : ${selected.designation}`,
      `Emp Type      : ${selected.empType}`,
      `Payment Date  : ${selected.paymentDate || "—"}`,
      `Payment Status: ${selected.paymentStatus}`,
      "",
      "EARNINGS",
      `  Basic Salary : ${fmt(selected.salary)}`,
      selected.incentive > 0 ? `  Incentive    : ${fmt(selected.incentive)}` : "",
      selected.bonus > 0 ? `  Bonus        : ${fmt(selected.bonus)}` : "",
      `  Gross Total  : ${fmt(grossEarnings)}`,
      "",
      "DEDUCTIONS",
      `  Total        : ${fmt(selected.deductions)}`,
      "",
      `NET PAY: ${fmt(selected.netPay)}`,
    ].filter((l) => l !== undefined).join("\n");

    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Payslip_${selected.empId}_${selected.month.replace(/ /g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Payslip</h1>
          <p className="text-gray-500 text-sm mt-1">View and download your monthly salary slips.</p>
        </div>

        {/* Month selector — only shows months with real records */}
        {!loading && payslips.length > 0 && (
          <div className="relative">
            <select
              className="appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-medium text-gray-700 focus:outline-none focus:border-[#4F3CC9] cursor-pointer"
              value={selected?.id ?? ""}
              onChange={(e) => {
                const rec = payslips.find((p) => p.id === e.target.value);
                if (rec) setSelected(rec);
              }}
            >
              {payslips.map((p) => (
                <option key={p.id} value={p.id}>{p.month}</option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={22} className="animate-spin mr-2" /> Loading payslips…
        </div>
      )}

      {/* No payslips yet */}
      {!loading && payslips.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-14 text-center max-w-3xl mx-auto">
          <FileText size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No payslips available yet.</p>
          <p className="text-gray-400 text-sm mt-1">Your HR team hasn&apos;t generated a payslip for you yet. Please check back later.</p>
        </div>
      )}

      {/* Payslip Card */}
      {!loading && selected && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden max-w-3xl mx-auto">
          {/* Header Banner */}
          <div className="bg-[#4F3CC9] px-8 py-6 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm">HR</div>
                <div>
                  <p className="font-bold text-lg">HR Pulse Technologies</p>
                  <p className="text-purple-200 text-xs">tech@hrpulse.com</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-purple-200 text-xs uppercase tracking-wider">Salary Slip</p>
                <p className="font-bold text-xl">{selected.month.toUpperCase()}</p>
              </div>
            </div>
          </div>

          {/* Employee Info */}
          <div className="bg-[#EDE9FF] px-8 py-4">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500">Employee Name</p>
                <p className="text-sm font-semibold text-gray-900">{empName || selected.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Employee ID</p>
                <p className="text-sm font-semibold text-gray-900">{selected.empId}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Designation</p>
                <p className="text-sm font-semibold text-gray-900">{selected.designation || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Department</p>
                <p className="text-sm font-semibold text-gray-900">{department || "—"}</p>
              </div>
            </div>
          </div>

          {/* Earnings & Deductions */}
          <div className="px-8 py-6">
            <div className="grid grid-cols-2 gap-8">
              {/* Earnings */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                  Earnings
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Basic Salary</span>
                    <span className="text-sm font-medium text-gray-900">{fmt(selected.salary)}</span>
                  </div>
                  {selected.incentive > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Incentive</span>
                      <span className="text-sm font-medium text-gray-900">{fmt(selected.incentive)}</span>
                    </div>
                  )}
                  {selected.bonus > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Bonus</span>
                      <span className="text-sm font-medium text-gray-900">{fmt(selected.bonus)}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-100 pt-3 mt-3 flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-900">Gross Salary</span>
                    <span className="text-sm font-bold text-gray-900">{fmt(grossEarnings)}</span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                  Deductions
                </h3>
                <div className="space-y-3">
                  {selected.deductions > 0 ? (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Total Deductions</span>
                      <span className="text-sm font-medium text-red-600">- {fmt(selected.deductions)}</span>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No deductions this month</p>
                  )}
                  <div className="border-t border-gray-100 pt-3 mt-3 flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-900">Total Deductions</span>
                    <span className="text-sm font-bold text-red-600">- {fmt(selected.deductions)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Net Pay */}
            <div className="mt-6 bg-[#EDE9FF] rounded-2xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#4F3CC9] flex items-center justify-center">
                  <CreditCard size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Net Salary</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-gray-400">{selected.month}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      selected.paymentStatus === "Paid" ? "bg-green-100 text-green-700" :
                      selected.paymentStatus === "Processing" ? "bg-blue-100 text-blue-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>{selected.paymentStatus}</span>
                  </div>
                  {selected.paymentDate && (
                    <p className="text-xs text-gray-400 mt-0.5">Paid on {selected.paymentDate}</p>
                  )}
                </div>
              </div>
              <p className="text-3xl font-bold text-[#4F3CC9]">{fmt(selected.netPay)}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="px-8 pb-6">
            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 bg-[#4F3CC9] text-white py-3 rounded-full text-sm font-medium hover:bg-[#3d2fa3] transition-colors"
            >
              <Download size={16} /> Download Payslip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
