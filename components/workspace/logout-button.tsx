"use client";

import { useId, useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

type LogoutButtonProps = {
  className?: string;
  tone?: "dark" | "light";
};

export function LogoutButton({ className, tone = "light" }: LogoutButtonProps) {
  const errorId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (pending) return;

    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error("Sign out failed.");
      }

      window.location.replace("/login");
    } catch {
      setError("Could not sign out. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        className={cn(
          "flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60",
          tone === "dark"
            ? "border-white/10 bg-white/5 text-[#d9e3e2] hover:bg-white/10 focus-visible:ring-offset-[var(--spruce)]"
            : "border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--limestone)] focus-visible:ring-offset-white",
        )}
        onClick={logout}
        disabled={pending}
        aria-busy={pending}
        aria-describedby={error ? errorId : undefined}
      >
        {pending ? (
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />
        ) : (
          <LogOut size={16} aria-hidden="true" />
        )}
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <p
          id={errorId}
          className={cn(
            "mt-2 mb-0 text-[11px] leading-4",
            tone === "dark" ? "text-[#f2b9b2]" : "text-[var(--critical)]",
          )}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
