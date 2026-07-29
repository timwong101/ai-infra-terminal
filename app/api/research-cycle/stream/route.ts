import { authorizeApi } from "@/lib/auth/session";
import { getResearchRuntimeSnapshot } from "@/lib/operations/research-cycle";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      const emit = async () => {
        if (closed) return;
        try {
          const snapshot = await getResearchRuntimeSnapshot();
          controller.enqueue(encoder.encode(`event: runtime\ndata: ${JSON.stringify(snapshot)}\n\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to load research runtime.";
          controller.enqueue(encoder.encode(`event: runtime-error\ndata: ${JSON.stringify({ error: message })}\n\n`));
        }
      };
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      void emit();
      timer = setInterval(() => void emit(), 2_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
