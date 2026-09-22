import { renderRobotsTxt } from "../../src/lib/robots-txt";

/**
 * `/robots.txt` — Route Handler, nao rota de metadados.
 *
 * O gerador de `app/robots.ts` do Next so serializa
 * `User-Agent`/`Allow`/`Disallow`/`Crawl-delay`. A D7 (decisao do dono,
 * 11/09/2026) exige tambem a diretiva `Content-Signal`, que aquele tipo nao
 * aceita — dai o handler. As regras continuam vindo de `buildRobots`, com os
 * mesmos testes de sempre; o handler so escreve o texto.
 *
 * `force-dynamic` pelo mesmo motivo de antes: o kill switch
 * (`CINERIE_PUBLIC_INDEXING_ENABLED`) e lido por REQUEST. Assar este arquivo no
 * build foi exatamente o defeito que tornou o kill switch inoperante. Puro: le
 * env, sem DB e sem rede.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(renderRobotsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // O MESMO cabecalho que a rota de metadados do Next emitia. Nao e detalhe:
      // qualquer `s-maxage` aqui prenderia o kill switch numa janela de borda —
      // desligar a indexacao e emergencia, e emergencia nao espera TTL expirar.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
