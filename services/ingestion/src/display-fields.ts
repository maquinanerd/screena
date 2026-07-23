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
 * Modulo PURO: sem Prisma, sem rede, sem IO. A ficha factual (nota, datas,
 * elenco) vem do normalizer — nunca daqui.
 */

/** Titulo e sinopse de exibicao extraidos do payload de detalhe. */
export interface CatalogDisplayFields {
  /** Titulo de exibicao (ja com fallback aplicado). Pode ser '' se o payload nao tiver nenhum. */
  readonly title: string
  /** Sinopse de exibicao, ou `null` quando ausente/vazia. */
  readonly overview: string | null
}

/** Filme: `title` -> `original_title` -> ''. */
export function readMovieDisplayFields(payload: unknown): CatalogDisplayFields {
  const obj =
    payload !== null && typeof payload === 'object'
      ? (payload as {
          title?: unknown
          original_title?: unknown
          overview?: unknown
        })
      : {}
  const title =
    (typeof obj.title === 'string' && obj.title.trim() !== '' ? obj.title : null) ??
    (typeof obj.original_title === 'string' ? obj.original_title : '')
  const overview = typeof obj.overview === 'string' && obj.overview !== '' ? obj.overview : null
  return { title, overview }
}

/** Serie: `name` -> `original_name` -> ''. */
export function readTvDisplayFields(payload: unknown): CatalogDisplayFields {
  const obj =
    payload !== null && typeof payload === 'object'
      ? (payload as {
          name?: unknown
          original_name?: unknown
          overview?: unknown
        })
      : {}
  const title =
    (typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name : null) ??
    (typeof obj.original_name === 'string' ? obj.original_name : '')
  const overview = typeof obj.overview === 'string' && obj.overview !== '' ? obj.overview : null
  return { title, overview }
}

/**
 * Pessoa: so `name`. A biografia NAO vira `overview` de proposito — a traducao
 * de pessoa guarda o nome; biografia e conteudo editorial com regra propria.
 */
export function readPersonDisplayFields(payload: unknown): CatalogDisplayFields {
  const obj = payload !== null && typeof payload === 'object' ? (payload as { name?: unknown }) : {}
  const title = typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name : ''
  return { title, overview: null }
}
