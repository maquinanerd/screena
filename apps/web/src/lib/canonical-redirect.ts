/**
 * canonical-redirect.ts — Decisao PURA de redirect canonico de entidade.
 *
 * Uma entidade pode ser alcancada por mais de um slug: ao trocar o slug canonico
 * (ex.: remocao do ano da URL), a linha antiga permanece em `slugs` com
 * `is_canonical = false` (o worker despromove, nao apaga, e grava o 301 em
 * `redirects`). Sem esta decisao, a rota resolveria o alias e devolveria 200 —
 * duas URLs servindo a mesma pagina, canonical divergente da URL servida.
 *
 * Regra: se o slug pedido nao e o canonico, a pagina NAO renderiza — redireciona
 * permanentemente para a URL canonica. So o canonico responde 200.
 *
 * PURO: sem env, DB, rede ou IO. O `permanentRedirect()` (que lanca) fica na
 * pagina; aqui so a decisao de destino, para poder ser testada sem Next.
 */

import { detailPath } from "./routes";

/**
 * Path canonico para o qual a rota deve redirecionar, ou `null` quando a pagina
 * deve renderizar normalmente.
 *
 * Retorna `null` quando:
 *  - o slug pedido JA e o canonico (caso normal: renderiza 200); ou
 *  - o slug canonico e vazio/invalido como segmento de URL — nesse caso e mais
 *    seguro servir a pagina atual do que redirecionar para um path quebrado
 *    (`detailPath` rejeita `/`, `\`, `:`, `?`, `#` e `..`).
 *
 * @param indexPath caminho da listagem do tipo (ex.: `/pt/filmes/`), com barra final
 * @param requestedSlug slug recebido na URL (ja decodificado pelo roteador)
 * @param canonicalSlug slug canonico da entidade, vindo do PostgreSQL
 */
export function canonicalRedirectPath(
  indexPath: string,
  requestedSlug: string,
  canonicalSlug: string,
): string | null {
  if (canonicalSlug === requestedSlug) return null;
  return detailPath(indexPath, canonicalSlug);
}
