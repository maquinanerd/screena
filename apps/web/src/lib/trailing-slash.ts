/**
 * Normalizacao de barra final — feita pelo MIDDLEWARE, nao pelo roteador.
 *
 * MEDIDO em producao (22/09/2026), o defeito I7 da auditoria de SEO:
 *
 *   GET https://cinerie.com/pt/filmes  -> 308, location: /pt/filmes/
 *   (nenhum cabecalho de seguranca: sem HSTS, sem CSP, sem X-Frame-Options,
 *    sem X-Content-Type-Options, sem Referrer-Policy)
 *
 *   GET https://cinerie.com/           -> 308, location: /pt/
 *   (com todos eles)
 *
 * A diferenca e a ORIGEM da resposta. O 308 da raiz e escrito pelo middleware,
 * que passa por `withSecurityHeaders`. O 308 de barra final vinha de
 * `trailingSlash: true`, resolvido pelo roteador DEPOIS do middleware: ele
 * descarta a resposta do `next()` — e com ela os cabecalhos — e os `headers()`
 * do `next.config.ts` tambem nao alcancam um redirect interno.
 *
 * Para quem chega ao site pela primeira vez por um link sem barra, isso adia a
 * entrega do HSTS em um salto: `http://` -> 301 -> `https://.../pt/filmes` ->
 * 308 (mudo) -> 200 (HSTS). Fazendo o redirect no middleware, o cabecalho chega
 * no primeiro salto em HTTPS.
 *
 * A regra abaixo e DELIBERADAMENTE conservadora: onde ela devolve `false`, o
 * comportamento continua sendo exatamente o que o Next ja fazia. Ela nao
 * reimplementa a normalizacao do Next — ela cobre o caso comum (uma rota de
 * pagina sem barra) e devolve todo o resto para ele.
 */
export function needsTrailingSlash(pathname: string): boolean {
  if (!pathname.startsWith("/")) return false;
  if (pathname.endsWith("/")) return false;
  // Barra dupla e outro tipo de normalizacao, e o Next ja a faz. Acrescentar
  // barra aqui so criaria um salto a mais antes da dele.
  if (pathname.includes("//")) return false;

  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (lastSegment === "") return false;
  // Um ponto no ultimo segmento marca um ARQUIVO — `/robots.txt`,
  // `/sitemap.xml`, `/favicon.ico`, `/news-sitemap.xml`. O Next nao acrescenta
  // barra a eles, e acrescentar QUEBRARIA os tres arquivos mais importantes que
  // este site serve.
  if (lastSegment.includes(".")) return false;

  return true;
}
