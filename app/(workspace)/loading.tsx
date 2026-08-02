export default function WorkspaceLoading() {
  return (
    <main className="content" aria-live="polite" aria-busy="true">
      <div className="mb-7 h-10 animate-pulse rounded-lg bg-white/70" />
      <div className="mb-6 max-w-2xl space-y-3">
        <div className="h-3 w-32 animate-pulse rounded bg-[#dce5e1]" />
        <div className="h-10 w-4/5 animate-pulse rounded bg-[#d5dfda]" />
        <div className="h-4 w-full animate-pulse rounded bg-[#e3e8e5]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-40 animate-pulse rounded-xl border border-[var(--border)] bg-white"
          />
        ))}
      </div>
      <p className="mt-5 text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
        Loading permit signals
      </p>
    </main>
  );
}
