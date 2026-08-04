import { House } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("brand-mark", className)} aria-hidden="true">
      <House className="brand-mark-icon" strokeWidth={2.1} />
    </div>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("brand-lockup", className)} aria-label="Edmonton Infill Tracker">
      <BrandMark />
      <div>
        <div className="brand-name">Edmonton</div>
        <div className="brand-product">Infill Tracker</div>
      </div>
    </div>
  );
}
