import type { UserRole } from "@153/shared";
import { cn } from "@/lib/cn";
import { roleLabel } from "@/lib/roleLabels";

const STYLES: Record<UserRole, string> = {
  super_admin: "bg-red-100 text-red-700",
  hq_admin: "bg-blue-100 text-blue-700",
  branch_owner: "bg-green-100 text-green-700",
  branch_manager: "bg-teal-100 text-teal-700",
  coach: "bg-purple-100 text-purple-700",
  member: "bg-gray-100 text-gray-700",
  // Phase B 멀티테넌트 역할 확장
  owner: "bg-indigo-100 text-indigo-700",
  brand_manager: "bg-cyan-100 text-cyan-700",
  staff: "bg-amber-100 text-amber-700",
  accountant: "bg-emerald-100 text-emerald-700",
  viewer: "bg-slate-100 text-slate-700",
};

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[role]
      )}
    >
      {roleLabel(role)}
    </span>
  );
}
