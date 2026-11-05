import { getSession } from "@/lib/session";
import { getSnapshot, subscribe } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Live updates for signed-in browsers: a server-sent event stream that sends a snapshot
 * from PostgreSQL, then every committed change emitted by lib/store.ts.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (data: unknown) => write(`data: ${JSON.stringify(data)}\n\n`);

      const unsubscribe = subscribe(send);
      const heartbeat = setInterval(() => write(": ping\n\n"), 15_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", cleanup);
      send({ type: "snapshot", ...(await getSnapshot()) });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
