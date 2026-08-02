import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "teal" | "copper" | "green" | "neutral" | "red";

const tones: Record<BadgeTone, string> = {
  teal: "border-[#B5D5D9] bg-[#EAF5F5] text-[#175866]",
  copper: "border-[#EDD0B0] bg-[#FFF3E7] text-[#8E501A]",
  green: "border-[#B9DCCB] bg-[#EAF6F0] text-[#28654C]",
  neutral: "border-[var(--border)] bg-[#F3F5F3] text-[var(--muted)]",
  red: "border-[#E7C1BC] bg-[#FAECEA] text-[#963C34]",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-[0.01em]",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
