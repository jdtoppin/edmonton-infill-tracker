"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowDownToLine,
  Gauge,
  LayoutGrid,
  RefreshCw,
  ScanSearch,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items: ReadonlyArray<{
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  exact?: boolean;
}> = [
  { href: "/admin", label: "Summary", icon: LayoutGrid, exact: true },
  { href: "/admin/imports", label: "Imports", icon: ArrowDownToLine },
  { href: "/admin/failures", label: "Failed records", icon: TriangleAlert },
  { href: "/admin/reviews", label: "Review queue", icon: ScanSearch },
  { href: "/admin/rules", label: "Scoring rules", icon: Gauge },
  { href: "/admin/health", label: "System health", icon: Activity },
  { href: "/admin/updates", label: "Application updates", icon: RefreshCw },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav
      className="mb-7 flex gap-2 overflow-x-auto border-b border-[var(--border)] pb-3"
      aria-label="Administration sections"
    >
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors",
              active
                ? "bg-[var(--spruce)] text-white"
                : "bg-white text-[var(--muted)] hover:bg-[var(--teal-soft)] hover:text-[var(--teal)]",
            )}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
