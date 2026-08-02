"use client";

import { useState } from "react";
import { Check, Clipboard, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

const updateCommand = "./scripts/infill update";

export function UpdateCommand() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(updateCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy was blocked. Select the command below instead.");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg bg-[var(--spruce)] px-4 py-3 font-mono text-sm text-white">
        <Terminal size={16} className="shrink-0 text-[#9cc4bd]" aria-hidden="true" />
        <code className="min-w-0 flex-1 overflow-x-auto select-all">{updateCommand}</code>
        <Button type="button" size="sm" variant="secondary" onClick={copy}>
          {copied ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Clipboard size={15} aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-2 min-h-5 text-xs text-[var(--muted)]" aria-live="polite">
        {error ||
          (copied ? "Command copied. Run it from the repository folder on the Mac mini." : "")}
      </p>
    </div>
  );
}
