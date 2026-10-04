import { NextResponse } from 'next/server';

/**
 * Trava de "só localhost" para rotas que agem no CLP real ou rodam scripts do pacote
 * (/api/erros/*, /api/faults). O servidor continua escutando na LAN (o dashboard pode ser
 * visto de outros aparelhos), mas essas rotas recusam (403) quem não chega como localhost.
 *
 * No app router do Next o IP remoto não é exposto de forma confiável, então a checagem usa o
 * header `host` (precisa ser localhost/127.0.0.1/[::1], qualquer porta) e, se vier, o `origin`
 * (também local — barra uma página de outra origem disparando POST pelo navegador).
 * ponytail: header `host` é forjável por quem já fala HTTP direto com a máquina; para isso,
 * a defesa real é o firewall/bind. Aqui o alvo é o acesso casual pela LAN e CSRF.
 */
const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostLocal(host: string | null): boolean {
  if (!host) return false;
  try {
    return LOCAIS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** Devolve uma resposta 403 se a requisição não for local; null se pode seguir. */
export function recusarSeRemoto(req: Request): Response | null {
  const host = req.headers.get('host') ?? new URL(req.url).host;
  const origin = req.headers.get('origin');
  let ok = hostLocal(host);
  if (ok && origin !== null) {
    try {
      ok = hostLocal(new URL(origin).host);
    } catch {
      ok = false;
    }
  }
  return ok ? null : NextResponse.json({ error: 'acesso permitido só a partir desta máquina (localhost)' }, { status: 403 });
}
