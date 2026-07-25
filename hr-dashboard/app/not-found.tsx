import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B1929] text-center px-6">
      <div className="text-5xl font-black tracking-tight mb-2">
        <span className="text-white">WO</span><span className="text-[#14B8A6]">WAYS</span>
      </div>
      <p className="text-6xl font-black text-white/90 mt-6">404</p>
      <p className="text-lg font-semibold text-white mt-2">Page not found</p>
      <p className="text-sm text-gray-400 mt-1 max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Link href="/" className="mt-6 inline-flex items-center gap-2 bg-[#14B8A6] text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-[#0f9488] transition-colors">
        Go to Login
      </Link>
    </div>
  );
}
