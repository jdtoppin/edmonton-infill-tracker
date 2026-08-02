export default function Loading() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-[var(--limestone)] px-5"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="text-center">
        <div className="mx-auto mb-4 size-8 animate-pulse rounded-lg bg-[var(--teal)]" />
        <p className="text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
          Loading permit signals
        </p>
      </div>
    </main>
  );
}
