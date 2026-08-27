/**
 * suspended-pages.ts — A METADE DA VALVULA QUE DE FATO DESINDEXA.
 *
 * Tirar uma URL do sitemap NAO desindexa o que o Google ja rastreou: o sitemap
 * e um convite, nao um comando. O que remove uma pagina do indice e
 * `<meta name="robots" content="noindex">` na propria pagina — e para o Google
 * ler essa tag ele precisa rastrear a pagina de novo, o que so acontece se ela
 * continuar acessivel (200, nao 404/410 e nao bloqueada no robots.txt).
 *
 * Por isso a suspensao vem em PAR:
 *   1. o tipo sai do sitemap  -> `SUSPENDED_SITEMAP_TYPES` (sitemap-index.ts)
 *   2. a pagina emite noindex -> este modulo
 * Uma sozinha nao resolve. `sitemap-emergency-valve.test.ts` trava o par.
 *
 * `follow: true` e deliberado. `noindex, follow` mantem o rastreio dos links
 * internos (o episodio continua apontando para a temporada e para a serie, que
 * SEGUEM indexaveis) enquanto o `noindex` retira a pagina do indice. Com
 * `nofollow` o Google pararia de seguir justamente os links que sustentam as
 * paginas que queremos manter.
 *
 * ESTE MODULO E TEMPORARIO E DIRIGIDO A TIPO — o oposto do que a politica
 * canonica manda. `packages/seo/catalog-indexability.ts` decide por DADO
 * ("episodio COM sinopse indexa"), e e ela quem deve governar quando a Fase 3
 * estiver aplicada. A valvula existe porque a politica por dado depende de um
 * produtor rodar contra o banco de producao, e a sangria e agora. Quando as
 * linhas de `page_indexability_decisions` existirem, `SUSPENDED_PAGE_TYPES`
 * volta a ser vazia e este arquivo sai.
 *
 * MODULO PURO: sem banco, sem rede, sem relogio.
 */

import type { PageSeoResolution } from "@screena/seo";

import type { DecisionEntityType } from "./indexability-decision";

/**
 * Tipos de pagina suspensos do indice — 2026-08-27, por decisao do dono.
 *
 * Medido em producao no mesmo dia: a pagina de episodio rende 64 palavras
 * dentro de `<main>` (mediana de 200 amostradas: 24), sem elenco, sem direcao e
 * sem imagem propria. Eram 3.793.672 URLs de episodio e 127.870 de temporada,
 * 96,36% de um sitemap de 4.069.444 URLs que tinha 53.054 cinco dias antes.
 *
 * Os nomes aqui sao os de `page_indexability_decisions` (singular);
 * `SUSPENDED_SITEMAP_TYPES` usa os nomes de shard (plural). O teste da valvula
 * trava a correspondencia entre as duas listas.
 */
export const SUSPENDED_PAGE_TYPES: readonly DecisionEntityType[] = ["season", "episode"];

/** Motivo gravado na resolucao — aparece em log e auditoria. */
export const SUSPENSION_REASON =
  "Tipo suspenso do indice pela valvula de emergencia de 2026-08-27: a pagina " +
  "existe e esta correta, mas nao tem o conteudo proprio que a justifica no " +
  "indice. Substituida pela decisao por dado quando a Fase 3 estiver aplicada.";

/** `true` quando o tipo esta suspenso do indice. */
export function isSuspendedPageType(entityType: DecisionEntityType): boolean {
  return SUSPENDED_PAGE_TYPES.includes(entityType);
}

/**
 * Aplica a suspensao a uma resolucao ja calculada.
 *
 * Tipo nao suspenso volta INALTERADO (mesma referencia) — a valvula nunca toca
 * em filme, serie ou pessoa. Tipo suspenso vira `noindex, follow`, fora do
 * sitemap, com o motivo acima.
 *
 * Nao rebaixa `blocked` nem `draft`: quando a resolucao ja e mais restritiva
 * que `noindex` por licenca (invariante 6) ou idioma (invariante 7), essa
 * decisao continua valendo — a valvula nunca AFROUXA um gate.
 */
export function applyPageSuspension(
  entityType: DecisionEntityType,
  resolution: PageSeoResolution,
): PageSeoResolution {
  if (!isSuspendedPageType(entityType)) return resolution;
  if (resolution.decision === "blocked" || resolution.decision === "draft") {
    return resolution;
  }
  return {
    ...resolution,
    decision: "noindex",
    robots: { index: false, follow: true },
    includeInSitemap: false,
    reason: SUSPENSION_REASON,
  };
}
