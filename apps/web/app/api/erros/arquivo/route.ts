import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { getErrosService, erroParaResposta, TIPOS_ARQUIVO } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** GET ?exec=<pasta>&nome=<relativo>: serve png/json/pdf/docx/md de pacoteDir/execucoes/<exec>/.
 *  400 em qualquer tentativa de path traversal ou extensão fora da lista. */
export async function GET(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  const q = new URL(req.url).searchParams;
  try {
    const alvo = getErrosService().caminhoArquivo(q.get('exec') ?? '', q.get('nome') ?? '');
    if (!existsSync(alvo)) return NextResponse.json({ error: 'arquivo não encontrado' }, { status: 404 });
    const ext = extname(alvo).toLowerCase();
    // Nome real no download (senão o navegador usa o da rota: "arquivo.pdf"); imagem abre inline.
    const nome = encodeURIComponent(basename(alvo));
    return new Response(readFileSync(alvo), {
      headers: {
        'Content-Type': TIPOS_ARQUIVO[ext]!,
        'Content-Disposition': `${ext === '.png' ? 'inline' : 'attachment'}; filename*=UTF-8''${nome}`,
      },
    });
  } catch (err) {
    const { status, body } = erroParaResposta(err);
    return NextResponse.json(body, { status });
  }
}
