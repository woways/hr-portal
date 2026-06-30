"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const params = useSearchParams();
  const reason = params.get("reason");
  const isRemoved = reason === "account-removed";

  return (
    <div className="min-h-screen bg-[#F5F3FF] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center">
        <div className="flex justify-center mb-4" style={{ height: "36px" }}>
          <img src="/woways-logo.svg" alt="Woways" className="max-h-full w-auto" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Employee Portal</h1>
        {isRemoved ? (
          <>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <p className="text-red-700 text-sm font-medium">
                Your account has been removed by HR. Please contact your HR administrator for more information.
              </p>
            </div>
          </>
        ) : (
          <p className="text-gray-500 text-sm mb-6">
            You have been logged out. Please use your credentials to access the employee portal.
          </p>
        )}
        <p className="text-xs text-gray-400 mt-4">
          Contact HR at your organisation if you need access.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
