"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Facademaker error boundary]", error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] p-6 text-[var(--foreground)]">
      <div className="max-w-md border border-[var(--border)] bg-[var(--panel-bg)] p-5">
        <h1 className="text-base font-semibold">The editor stopped rendering</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          Your last autosave is still stored in this browser. Try rebuilding
          the view; if the problem returns, reload the page.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            Rebuild editor
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Reload page
          </button>
        </div>
      </div>
    </main>
  );
}
