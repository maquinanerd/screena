/**
 * tmdb-image-url.ts — REEXPORT do helper canônico de URL de imagem TMDB.
 *
 * A implementação vive em `@screena/public-contracts` (`media-url.ts`), o ÚNICO
 * arquivo de produção do repositório autorizado a conter o host do CDN
 * (`scripts/audit/check-render-purity.mjs` verifica isso repo-wide). Este
 * arquivo existe só para não quebrar os imports existentes de apps/web —
 * ele NÃO contém o host nem lógica própria; novos consumidores devem importar
 * direto de `@screena/public-contracts`.
 */

export { buildTmdbImageUrl, type TmdbImageSize } from "@screena/public-contracts";
