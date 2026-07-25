/**
 * Reusable skeleton primitives with a subtle shimmer.
 * Use these instead of "Loading..." text so the layout stays stable
 * and the perceived load time is much shorter.
 */

interface BoxProps {
  className?: string;
  w?: string;
  h?: string;
  rounded?: string;
}

export function SkeletonBox({ className = "", w = "w-full", h = "h-4", rounded = "rounded-md" }: BoxProps) {
  return <div className={`${w} ${h} ${rounded} bg-gray-200/70 animate-pulse ${className}`} />;
}

export function SkeletonLine({ className = "", w = "w-full" }: { className?: string; w?: string }) {
  return <div className={`${w} h-3.5 rounded bg-gray-200/70 animate-pulse ${className}`} />;
}

export function SkeletonCircle({ size = "w-10 h-10", className = "" }: { size?: string; className?: string }) {
  return <div className={`${size} rounded-full bg-gray-200/70 animate-pulse ${className}`} />;
}

export function SkeletonStatCard() {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2 border border-gray-100">
      <div className="w-8 h-8 rounded-lg bg-gray-200/70 animate-pulse" />
      <div className="h-5 w-12 rounded bg-gray-200/70 animate-pulse" />
      <div className="h-3 w-16 rounded bg-gray-200/70 animate-pulse" />
    </div>
  );
}

export function SkeletonStatGrid({ count = 4, cols = "grid-cols-2 md:grid-cols-4" }: { count?: number; cols?: string }) {
  return (
    <div className={`grid ${cols} gap-3`}>
      {Array.from({ length: count }, (_, i) => <SkeletonStatCard key={i} />)}
    </div>
  );
}

export function SkeletonChart({ height = "h-64" }: { height?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="h-4 w-40 bg-gray-200/70 animate-pulse rounded mb-4" />
      <div className={`${height} w-full bg-gray-100 animate-pulse rounded-xl`} />
    </div>
  );
}

export function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b border-gray-100">
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-3.5 w-full max-w-[140px] bg-gray-200/70 animate-pulse rounded" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTableRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return <>{Array.from({ length: rows }, (_, i) => <SkeletonTableRow key={i} cols={cols} />)}</>;
}

export function SkeletonListRow({ withAvatar = true }: { withAvatar?: boolean }) {
  return (
    <div className="flex items-center gap-3 p-3 border-b border-gray-100">
      {withAvatar && <SkeletonCircle size="w-8 h-8" />}
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-40 bg-gray-200/70 animate-pulse rounded" />
        <div className="h-3 w-24 bg-gray-200/70 animate-pulse rounded" />
      </div>
      <div className="h-3 w-16 bg-gray-200/70 animate-pulse rounded" />
    </div>
  );
}

export function SkeletonCard({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`}>
      <div className="h-4 w-32 bg-gray-200/70 animate-pulse rounded mb-4" />
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-3.5 w-full bg-gray-200/70 animate-pulse rounded" style={{ maxWidth: `${90 - i * 10}%` }} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonHeader() {
  return (
    <div className="space-y-2">
      <div className="h-6 w-48 bg-gray-200/70 animate-pulse rounded" />
      <div className="h-3.5 w-72 bg-gray-200/70 animate-pulse rounded" />
    </div>
  );
}
