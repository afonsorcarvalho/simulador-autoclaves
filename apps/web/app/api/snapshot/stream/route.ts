import { getRuntime } from '../../../../server/runtime/singleton';
import { ensureSchedulerRunning } from '../../../../server/runtime/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  ensureSchedulerRunning();
  const runtime = getRuntime();

  let unsubscribe: (() => void) | null = null;
  let heartbeatHandle: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      // Replay the running cycle's history so a client opening (or re-opening) /live
      // sees the whole cycle, not just from now. Falls back to latest when idle.
      const backlog = runtime.publisher.history;
      if (backlog.length > 0) {
        for (const snap of backlog) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(snap)}\n\n`));
        }
      } else if (runtime.publisher.latest) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(runtime.publisher.latest)}\n\n`));
      }

      unsubscribe = runtime.publisher.subscribe((snap) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(snap)}\n\n`));
        } catch {
          // controller closed; cancel() will fire and tear down
        }
      });

      // Heartbeat every 10s to keep connection open through proxies
      heartbeatHandle = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: heartbeat\n\n`));
        } catch {
          /* ignore */
        }
      }, 10000);
    },
    cancel() {
      if (heartbeatHandle !== null) {
        clearInterval(heartbeatHandle);
        heartbeatHandle = null;
      }
      if (unsubscribe !== null) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
