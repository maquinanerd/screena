import { buildAdsTxt } from "../../src/lib/adsense";

/**
 * `/ads.txt` — vendedores autorizados (padrao IAB): a linha da conta do Google
 * AdSense. Conteudo e motivo em `src/lib/adsense.ts`.
 *
 * `force-static`, ao contrario do `robots.txt` e do `llms.txt`: aqueles leem a
 * chave de indexacao por request, este nao le nada — nem banco, nem env, nem a
 * requisicao. O Next o prerenderiza no build (que roda sem `DATABASE_URL`) e o
 * serve do disco.
 *
 * SEM o portao de ambiente do `llms.txt`, de proposito. Anunciar vendedor nao e
 * pedir indexacao: se a chave de indexacao for desligada numa emergencia, o
 * `ads.txt` sumir tiraria a conta do ar junto. Num dominio de preview a linha
 * nao autoriza nada que exista — o Google so vende anuncio no site cadastrado.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildAdsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
