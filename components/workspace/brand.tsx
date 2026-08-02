import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("brand-lockup", className)} aria-label="Edmonton Infill Tracker">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <div className="brand-name">Edmonton</div>
        <div className="brand-product">Infill Tracker</div>
      </div>
    </div>
  );
}
