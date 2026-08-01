"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ApplicationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Application route failed", { message: error.message, digest: error.digest }); }, [error]);
  return <main className="route-error" role="alert">
    <AlertTriangle size={28} />
    <h1>This workspace could not be loaded</h1>
    <p>The failure was contained to this route. Retry the request; persistent failures remain available in server logs with the digest below.</p>
    {error.digest && <code>{error.digest}</code>}
    <button className="primary-button" onClick={reset}><RefreshCw size={15} />Retry</button>
  </main>;
}
