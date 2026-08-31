/**
 * admission.ts — A PORTA DO CATALOGO. Nucleo PURO (sem Prisma, sem rede).
 *
 * ============================================================================
 * ONDE ESTE FILTRO CABE, E POR QUE AQUI
 * ============================================================================
 * A descoberta da Cinerie NAO usa `/discover`: usa os Daily ID Exports do TMDB
 * (`services/ingestion/src/discovery/id-exports.ts`, ritmo `discovery` de
 * `@screena/sync`). O export traz `id`, `original_title`/`original_name`,
 * `popularity`, `adult` e `video` — e NAO traz idioma. Logo o idioma so existe
 * depois do detalhe, e o filtro tem que morar entre o detalhe e a persistencia.
 *
 * Existem TRES caminhos que criam um titulo, e todos os tres passam por
 * `EntityStorePort.upsertMovie`/`upsertTvShow`:
 *
 *   1. `import/import-movie.ts` e `import-tv.ts`  (sync sob demanda / on-demand)
 *   2. `persistence/catalog-services.ts`          (sync de detalhe, creditos, ids)
 *   3. `raw-promote/run.ts`                       (promocao de `tmdb_raw`)
 *
 * Por isso o gate mora no adapter da porta de persistencia, e nao em cada
 * caminho: um filtro repetido tres vezes e um filtro que um dia sera esquecido
 * numa delas. Colocado aqui, nao ha como criar titulo sem atravessa-lo.
 *
 * ============================================================================
 * O GATE E DE CRIACAO, NAO DE ATUALIZACAO
 * ============================================================================
 * Titulo que JA existe continua sendo atualizado. Duas razoes:
 *
 *  - o alvo do recorte e o CRESCIMENTO (~3.700 titulos/dia); congelar o que ja
 *    esta no banco nao adianta nada e quebraria os jobs de reparo (creditos,
 *    external_ids) para titulos que ficam;
 *  - entre este PR e a Parte D, os titulos fora do recorte ainda existem. Se o
 *    gate os congelasse, um job de reparo passaria a reportar falha em massa
 *    por causa de linhas que estao para ser apagadas — ruido que esconde
 *    defeito de verdade.
 *
 * ============================================================================
 * SEM DESCARTE SILENCIOSO
 * ============================================================================
 * Recusar em silencio seria repetir, na porta, o defeito que esta leva veio
 * fechar na coluna. Toda recusa devolve o codigo do idioma e e contada por
 * codigo; quem chama e obrigado pelo TypeScript a lidar com ela
 * (`EntityUpsertResult` e uma uniao), e o contador vai para `api_sync_logs`.
 */

import {
  classifyCatalogLanguage,
  resolveCatalogLanguageAllowlist,
  baseLanguageSubtag,
} from '@screena/config'

import type { CatalogAdmissionRefusal } from '../ports.js'

/** Politica de admissao do catalogo (o recorte de idioma). */
export interface CatalogAdmissionPolicy {
  /** Subtags base aceitas (ex.: `['pt','en','es','ja','ko']`). */
  readonly allowlist: readonly string[]
  /**
   * Decide se um titulo NOVO pode ser criado. `null` = pode.
   *
   * Recebe o `original_language` ja normalizado (o codigo gravavel na coluna),
   * porque e ele que o catalogo vai guardar — filtrar por um valor diferente do
   * persistido criaria linha admitida sob um idioma e gravada sob outro.
   */
  admit(originalLanguage: string | null): CatalogAdmissionRefusal | null
}

/** Constroi a politica a partir do recorte configurado (env ou default). */
export function createCatalogAdmissionPolicy(
  allowlist: readonly string[] = resolveCatalogLanguageAllowlist(),
): CatalogAdmissionPolicy {
  return {
    allowlist,
    admit(originalLanguage: string | null): CatalogAdmissionRefusal | null {
      const verdict = classifyCatalogLanguage(originalLanguage, allowlist)
      if (verdict === 'allowed') return null
      if (verdict === 'unknown_language') return { reason: 'language_unknown', language: null }
      // `baseLanguageSubtag` nunca devolve null aqui: `rejected` so acontece
      // quando ha subtag. O `??` existe para o tipo, nao para o caso.
      return {
        reason: 'language_not_allowed',
        language: baseLanguageSubtag(originalLanguage) ?? 'desconhecido',
      }
    },
  }
}

/**
 * Contador de recusas — o log que a Parte C.4 exige.
 *
 * Por IDIOMA e por TIPO, porque "recusamos 2.200 titulos hoje" nao permite
 * conferir nada: e a distribuicao por codigo que mostra se o recorte esta
 * cortando o que o dono mandou cortar. O balde `unknown` fica separado dos
 * codigos justamente para nao mascarar payload quebrado como decisao editorial.
 */
export interface AdmissionRefusalTally {
  /** Total recusado desde a criacao do contador. */
  readonly total: number
  /** Recusas por subtag de idioma (ex.: `{ te: 42, ru: 17 }`). */
  readonly byLanguage: Readonly<Record<string, number>>
  /** Recusas por tipo de entidade (`movie` / `tv`). */
  readonly byEntityType: Readonly<Record<string, number>>
  /** Recusas em que o payload nao trouxe idioma nenhum. */
  readonly unknownLanguage: number
}

/** Acumulador mutavel de recusas (o relatorio final e imutavel). */
export interface AdmissionRefusalCounter {
  record(entityType: 'movie' | 'tv', refusal: CatalogAdmissionRefusal): void
  snapshot(): AdmissionRefusalTally
}

/** Cria um contador zerado. */
export function createAdmissionRefusalCounter(): AdmissionRefusalCounter {
  const byLanguage = new Map<string, number>()
  const byEntityType = new Map<string, number>()
  let total = 0
  let unknownLanguage = 0

  return {
    record(entityType, refusal) {
      total += 1
      byEntityType.set(entityType, (byEntityType.get(entityType) ?? 0) + 1)
      if (refusal.reason === 'language_unknown') {
        unknownLanguage += 1
        return
      }
      byLanguage.set(refusal.language, (byLanguage.get(refusal.language) ?? 0) + 1)
    },
    snapshot() {
      return {
        total,
        // Ordenado por volume: quem le o log quer os idiomas que mais aparecem,
        // nao a ordem em que o worker os encontrou.
        byLanguage: Object.fromEntries([...byLanguage].sort((a, b) => b[1] - a[1])),
        byEntityType: Object.fromEntries([...byEntityType].sort((a, b) => b[1] - a[1])),
        unknownLanguage,
      }
    },
  }
}

/**
 * O `error_code` de UMA recusa, para `api_sync_logs`.
 *
 * O par que torna a recusa consultavel e (`status = 'empty'`, este codigo). Um
 * ciclo que roda e nao materializa nada e literalmente `empty` — nao e
 * `failed`, e chamar de sucesso apagaria a distincao. Com isto, o log de C.4
 * sai de UMA consulta:
 *
 *   SELECT date_trunc('day', created_at) AS dia, error_code, count(*)
 *     FROM api_sync_logs
 *    WHERE status = 'empty' AND starts_with(error_code, 'language_')
 *    GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;
 */
export function refusalErrorCode(refusal: CatalogAdmissionRefusal): string {
  return refusal.reason === 'language_unknown'
    ? 'language_unknown'
    : `language_not_allowed:${refusal.language}`
}

/** Uma linha legivel do log de recusa, para stderr do worker/CLI. */
export function formatRefusalTally(tally: AdmissionRefusalTally): string {
  if (tally.total === 0) return 'recorte de idioma: nenhum titulo recusado'
  const langs = Object.entries(tally.byLanguage)
    .map(([code, count]) => `${code}=${count}`)
    .join(' ')
  const types = Object.entries(tally.byEntityType)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(' ')
  return [
    `recorte de idioma: ${tally.total} titulo(s) recusado(s)`,
    types === '' ? null : `  por tipo:   ${types}`,
    langs === '' ? null : `  por idioma: ${langs}`,
    tally.unknownLanguage === 0 ? null : `  sem idioma no payload: ${tally.unknownLanguage}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
