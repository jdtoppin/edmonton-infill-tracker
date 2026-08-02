import Link from "next/link";
import { Columns2, List, Map } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  projectFiltersToSearchParams,
  type ProjectFilters,
  type ProjectView,
} from "@/src/services/project-read-model";

const views = [
  { value: "list", label: "List", icon: List },
  { value: "map", label: "Map", icon: Map },
  { value: "split", label: "Split", icon: Columns2 },
] as const;

export function ProjectViewSwitcher({ filters }: { filters: ProjectFilters }) {
  return (
    <nav
      className="inline-flex rounded-lg border border-[var(--border)] bg-white p-1"
      aria-label="Project result view"
    >
      {views.map(({ value, label, icon: Icon }) => {
        const params = projectFiltersToSearchParams({
          ...filters,
          view: value as ProjectView,
          page: 1,
        });
        const active = filters.view === value;
        return (
          <Link
            key={value}
            href={`/projects?${params.toString()}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold no-underline",
              active
                ? "bg-[var(--spruce)] text-white"
                : "text-[var(--muted)] hover:bg-[var(--limestone)]",
            )}
          >
            <Icon size={14} aria-hidden="true" /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
