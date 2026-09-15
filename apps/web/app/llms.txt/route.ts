/**
 * /llms.txt — o indice do site para ferramentas de IA. O conteudo mora em
 * `src/lib/llms-txt.ts`, que e puro e testado.
 *
 * MESMA CHAVE DO `robots.txt`: ambiente que nao indexa (preview, staging, local)
 * nao se apresenta — responde 404, e nao um indice apontando para enderecos que
 * aquele ambiente nao quer no buscador.
 */

import { buildLlmsTxt } from "../../src/lib/llms-txt";
import { SITE_URL, isOfficialIndexableEnvironment } from "../../src/lib/site";

// Le a flag de indexacao por REQUEST, como o robots.txt: um arquivo assado no
// build ignoraria o kill switch.
export const dynamic = "force-dynamic";

export function GET(): Response {
  if (!isOfficialIndexableEnvironment(process.env)) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(buildLlmsTxt(SITE_URL), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}
