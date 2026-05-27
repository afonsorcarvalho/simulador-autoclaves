import { getRuntime } from '../../../../server/runtime/singleton';
import { ensureSchedulerRunning } from '../../../../server/runtime/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  ensureSchedulerRunning();
  const runtime = getRuntime();

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      // Send latest immediately if available
      if (runtime.publisher.latest) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(runtime.publisher.latest)}\n\n`));
      }

      const unsub = runtime.publisher.subscribe((snap) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(snap)}\n\n`));
        } catch {
          // controller closed; cancel() will fire
        }
      });

      // Heartbeat every 10s to keep connection open through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: heartbeat\n\n`));
        } catch {
          /* ignore */
        }
      }, 10000);

      // Stash cleanup hook on the controller for cancel() to invoke
      (controller as unknown as { _cleanup?: () => void })._cleanup = () => {
        clearInterval(heartbeat);
        unsub();
      };
    },
    cancel() {
      const c = this as unknown as { _cleanup?: () => void };
      c._cleanup?.();
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
