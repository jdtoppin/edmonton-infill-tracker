import type { ReactNode } from "react";
import { AlertTriangle, Database, SearchX } from "lucide-react";

export function PreviewBanner() {
  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-xl border border-[#e3c8a8] bg-[#fff8ed] p-4 text-sm text-[#70491f]"
      role="status"
    >
      <Database className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
      <div>
        <strong className="block text-[var(--spruce)]">Product preview</strong>
        <span>
          This hosted preview uses clearly labelled demonstration records. Your Mac mini uses its
          private PostgreSQL database when <code>AUTH_REQUIRED=true</code>.
        </span>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  filtered = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  filtered?: boolean;
}) {
  const Icon = filtered ? SearchX : Database;
  return (
    <section className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl bg-[var(--teal-soft)] text-[var(--teal)]">
        <Icon size={21} aria-hidden="true" />
      </div>
      <h2 className="m-0 text-xl font-bold text-[var(--spruce)]">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}

export function WarningNotice({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-[#edd2b4] bg-[#fff7ec] p-4 text-sm text-[#70491f]"
      role="status"
    >
      <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
