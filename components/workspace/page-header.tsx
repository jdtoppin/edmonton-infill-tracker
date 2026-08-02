import type { ReactNode } from "react";
import { Search } from "lucide-react";

export function WorkspaceTopbar({ status }: { status?: ReactNode }) {
  return (
    <header className="topbar">
      <form action="/projects" method="get" className="search-box" role="search">
        <Search size={17} aria-hidden="true" />
        <input
          name="q"
          aria-label="Search by address or permit number"
          placeholder="Search address or permit number"
        />
        <button type="submit" className="sr-only">
          Search projects
        </button>
      </form>
      {status && <div className="topbar-actions">{status}</div>}
    </header>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section className="hero-row">
      <div>
        <div className="page-kicker">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="hero-actions">{actions}</div>}
    </section>
  );
}
