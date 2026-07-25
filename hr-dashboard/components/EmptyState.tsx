import { Inbox, type LucideIcon } from "lucide-react";

/**
 * Shared, consistent empty-state used across modules (lists/tables with no data
 * or zero filter results). Renders a centred icon, a title, and an optional hint.
 * Place inside a table cell with a colSpan, or anywhere as a standalone block.
 */
export function EmptyState({
  title,
  subtitle,
  icon: Icon = Inbox,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-12"} px-4`}>
      <div className={`${compact ? "w-9 h-9" : "w-12 h-12"} rounded-full bg-gray-100 flex items-center justify-center mb-3`}>
        <Icon size={compact ? 16 : 22} className="text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1 max-w-xs">{subtitle}</p>}
    </div>
  );
}
