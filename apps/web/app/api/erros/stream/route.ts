import { getErrosService } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** SSE: manda o estado atual assim que conecta, depois cada evento do executor em curso
 *  (inicio_cenario, passo, aguardando_operador, resultado, fim). Mesmo padrão de
 *  /api/snapshot/stream. */
export async function GET(req: Request): Promise<Response> {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  const service = getErrosService();
  let unsubscribe: (() => void) | null = null;
  let heartbeatHandle: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ tipo: 'status', ...service.status() })}\n\n`));

      unsubscribe = service.eventos((e) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // controller closed; cancel() will fire and tear down
        }
      });

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
