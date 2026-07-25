"use client";
import { useState } from "react";
import { Download, Mail, CreditCard, ChevronDown, Check } from "lucide-react";

interface SlipRow { label: string; amount: number; }

interface MonthSlip {
  earnings: SlipRow[];
  deductions: SlipRow[];
  payDate: string;
}

const PAYSLIP_DATA: Record<string, MonthSlip> = {};

const months = Object.keys(PAYSLIP_DATA);
const emptySlip: MonthSlip = { earnings: [], deductions: [], payDate: "—" };

export default function PayslipPage() {
  const [selectedMonth, setSelectedMonth] = useState(months[0] ?? "");
  const [emailSent, setEmailSent] = useState(false);

  const slip = PAYSLIP_DATA[selectedMonth] ?? emptySlip;
  const gross = slip.earnings.reduce((s, e) => s + e.amount, 0);
  const totalDed = slip.deductions.reduce((s, d) => s + d.amount, 0);
  const net = gross - totalDed;

  function handleDownload() { window.print(); }

  function handleEmail() {
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Payslip</h1>
          <p className="text-gray-500 text-sm mt-1">View and download your monthly payslips.</p>
        </div>
        <div className="relative">
          <select
            className="appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-medium text-gray-700 focus:outline-none focus:border-[#4F3CC9] cursor-pointer"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {months.map((m) => <option key={m}>{m}</option>)}
          </select>
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Email toast */}
      {emailSent && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 bg-green-500 text-white px-5 py-3 rounded-2xl text-sm font-medium shadow-lg">
          <Check size={15} /> Payslip emailed successfully
        </div>
      )}

      {/* Payslip Card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden max-w-3xl mx-auto" id="payslip-print">
        {/* Payslip Header */}
        <div className="bg-[#4F3CC9] px-8 py-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm">HR</div>
              <div>
                <p className="font-bold text-lg">Woways</p>
                <p className="text-purple-200 text-xs">tech@woways.in | www.woways.in</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-purple-200 text-xs uppercase tracking-wider">Payslip</p>
              <p className="font-bold text-xl">{selectedMonth.toUpperCase()}</p>
            </div>
          </div>
        </div>

        {/* Employee Info */}
        <div className="bg-[#EDE9FF] px-8 py-4">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Employee Name</p>
              <p className="text-sm font-semibold text-gray-900">—</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Employee ID</p>
              <p className="text-sm font-semibold text-gray-900">—</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Department</p>
              <p className="text-sm font-semibold text-gray-900">—</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Payment Date</p>
              <p className="text-sm font-semibold text-gray-900">{slip.payDate}</p>
            </div>
          </div>
        </div>

        {/* Earnings & Deductions */}
        <div className="px-8 py-6">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Earnings
              </h3>
              <div className="space-y-3">
                {slip.earnings.map((item) => item.amount > 0 && (
                  <div key={item.label} className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{item.label}</span>
                    <span className="text-sm font-medium text-gray-900">₹{item.amount.toLocaleString("en-IN")}</span>
                  </div>
                ))}
                <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
                  <span className="text-sm font-bold text-gray-900">Gross Payroll</span>
                  <span className="text-sm font-bold text-gray-900">₹{gross.toLocaleString("en-IN")}</span>
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Deductions
              </h3>
              <div className="space-y-3">
                {slip.deductions.map((item) => (
                  <div key={item.label} className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{item.label}</span>
                    <span className="text-sm font-medium text-red-600">- ₹{item.amount.toLocaleString("en-IN")}</span>
                  </div>
                ))}
                <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
                  <span className="text-sm font-bold text-gray-900">Total Deductions</span>
                  <span className="text-sm font-bold text-red-600">- ₹{totalDed.toLocaleString("en-IN")}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net Salary */}
          <div className="mt-6 bg-[#EDE9FF] rounded-2xl p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#4F3CC9] flex items-center justify-center">
                <CreditCard size={18} className="text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Net Payroll Credited</p>
                <p className="text-xs text-gray-400">{selectedMonth}</p>
              </div>
            </div>
            <p className="text-3xl font-bold text-[#4F3CC9]">₹{net.toLocaleString("en-IN")}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="px-8 pb-6 grid grid-cols-2 gap-3">
          <button
            onClick={handleDownload}
            className="flex items-center justify-center gap-2 bg-[#4F3CC9] text-white py-3 rounded-full text-sm font-medium hover:bg-[#3d2fa3] transition-colors"
          >
            <Download size={16} /> Download Payslip
          </button>
          <button
            onClick={handleEmail}
            className="flex items-center justify-center gap-2 border-2 border-[#4F3CC9] text-[#4F3CC9] py-3 rounded-full text-sm font-medium hover:bg-[#EDE9FF] transition-colors"
          >
            <Mail size={16} /> Email Payslip
          </button>
        </div>
      </div>
    </div>
  );
}
