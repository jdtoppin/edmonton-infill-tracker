import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { WorkspaceTopbar } from "@/components/workspace/page-header";
import { requireAdmin } from "@/src/lib/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin("/admin");

  return (
    <>
      <WorkspaceTopbar
        status={
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <span className="size-2 rounded-full bg-[var(--positive)]" /> Protected administration
          </span>
        }
      />
      <main className="content">
        <AdminNav />
        {children}
      </main>
    </>
  );
}
