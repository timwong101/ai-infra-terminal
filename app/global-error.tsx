"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><main className="route-error" role="alert"><h1>The terminal could not start</h1><p>A root application error was contained. Retry to rebuild the interface.</p><button onClick={reset}>Retry</button></main></body></html>;
}
