/**
 * display-fields.ts — Leitura PURA dos campos de EXIBICAO (titulo + sinopse) de
 * um payload de detalhe do TMDB.
 *
 * Por que existe um modulo so para isso: titulo e sinopse sao a base do **slug
 * canonico** e da **traducao pt-BR**. Os DOIS pipelines de catalogo precisam da
 * mesma leitura:
 *
 *  - promocao de `tmdb_raw` (`raw-promote/run.ts`), e
 *  - import direto do detalhe (`import/import-*.ts`, usado pelo job
 *    `sync_details` da fila duravel).
 *
 * Antes estes leitores viviam so no primeiro caminho; o segundo nao criava slug
 * nem traducao, e entidade sem slug nao tem rota publica, nao entra na busca e
 * nao entra no sitemap. Centralizar aqui e o que permite os dois finalizarem
 * IGUAL, sem duplicar a regra de fallback (que e sutil: `title` -> `original_title`).
 *
 * A SINOPSE PASSOU A TER CADEIA (2026-08-28). Ate aqui o titulo tinha fallback
 * (`title` -> `original_title`) e a sinopse nao tinha NENHUM: lia-se so o
 * `overview` de topo, que o TMDB devolve VAZIO quando o titulo nao tem traducao
 * no idioma pedido. O texto existia — dentro do bloco `translations`, que ja
 * vinha pago na mesma resposta — e era descartado. A cadeia agora vive em
 * `localized-text.ts`, com a proveniencia junto do valor. Ver o cabecalho de la.
 *
 * Modulo PURO: sem Prisma, sem rede, sem IO. A ficha factual (nota, datas,
 * elenco) vem do normalizer — nunca daqui.
 */

import { pickBiography, pickOverview, type LocalizedTextSource } from './localized-text.js'

/** Titulo e sinopse de exibicao extraidos do payload de detalhe. */
export interface CatalogDisplayFields {
  /** Titulo de exibicao (ja com fallback aplicado). Pode ser '' se o payload nao tiver nenhum. */
  readonly title: string
  /** Sinopse de exibicao, ou `null` quando ausente/vazia nas duas origens. */
  readonly overview: string | null
  /**
   * DE ONDE a sinopse veio: `detail` (campo de topo) ou `translations` (bloco
   * de traducoes). `null` quando nao ha sinopse.
   *
   * Sem isto, uma sinopse recuperada do bloco fica indistinguivel de uma que
   * sempre esteve no campo principal, e a proxima investigacao comeca do zero.
   */
  readonly overviewSource: LocalizedTextSource | null
}

/** Filme: `title` -> `original_title` -> ''. */
export function readMovieDisplayFields(payload: unknown): CatalogDisplayFields {
  const obj =
    payload !== null && typeof payload === 'object'
      ? (payload as {
          title?: unknown
          original_title?: unknown
        })
      : {}
  const title =
    (typeof obj.title === 'string' && obj.title.trim() !== '' ? obj.title : null) ??
    (typeof obj.original_title === 'string' ? obj.original_title : '')
  const sinopse = pickOverview(payload)
  return { title, overview: sinopse.text, overviewSource: sinopse.source }
}

/** Serie: `name` -> `original_name` -> ''. */
export function readTvDisplayFields(payload: unknown): CatalogDisplayFields {
  const obj =
    payload !== null && typeof payload === 'object'
      ? (payload as {
          name?: unknown
          original_name?: unknown
        })
      : {}
  const title =
    (typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name : null) ??
    (typeof obj.original_name === 'string' ? obj.original_name : '')
  const sinopse = pickOverview(payload)
  return { title, overview: sinopse.text, overviewSource: sinopse.source }
}

/**
 * Pessoa: so `name`. A biografia NAO vira `overview` de proposito — a traducao
 * de pessoa guarda o nome; biografia e conteudo editorial com regra propria
 * (coluna `people.biography` + gate de licenca `biography_source_status`).
 * Para le-la, use {@link readPersonBiography}.
 */
export function readPersonDisplayFields(payload: unknown): CatalogDisplayFields {
  const obj = payload !== null && typeof payload === 'object' ? (payload as { name?: unknown }) : {}
  const title = typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name : ''
  return { title, overview: null, overviewSource: null }
}

/** Biografia de pessoa, com proveniencia. Mesma precedencia da sinopse. */
export function readPersonBiography(payload: unknown): {
  readonly biography: string | null
  readonly biographySource: LocalizedTextSource | null
} {
  const bio = pickBiography(payload)
  return { biography: bio.text, biographySource: bio.source }
}
