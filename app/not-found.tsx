import { ArrowLeft, MapPinOff } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--limestone)] px-5 text-[var(--ink)]">
      <section className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-white p-8">
        <MapPinOff className="mb-5 text-[var(--copper)]" size={32} aria-hidden="true" />
        <p className="mb-2 text-[10px] font-bold tracking-[0.12em] text-[var(--copper)] uppercase">
          Not found
        </p>
        <h1 className="m-0 text-3xl font-bold tracking-[-0.035em] text-[var(--spruce)]">
          There is no signal at this address
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          The page may have moved, or the project is no longer available.
        </p>
        <a
          href="/"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--spruce)] px-4 text-sm font-semibold text-white"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back to dashboard
        </a>
      </section>
    </main>
  );
}
