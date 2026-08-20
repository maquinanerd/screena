/**
 * append-consumption.ts — O REGISTRO de quem consome cada valor de
 * `append_to_response`.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * Tres vezes em tres semanas o mesmo defeito:
 *
 *   1. `watch/providers` (PR #181) — estava no append, chegava em toda
 *      requisicao de detalhe, e o normalizador o descartava. A disponibilidade
 *      de streaming ficou meses ausente porque "faltava coletar" — e ela ja
 *      estava sendo coletada.
 *   2. `biography` de pessoa — o campo chegava e nao havia coluna. A pagina
 *      exibia a ausencia com um motivo correto e uma causa errada.
 *   3. `recommendations` / `similar` — chegavam nos dois appends e nunca foram
 *      lidos. "Mais como este" foi construido sobre COLECAO por falta de sinal,
 *      com a refutacao ja escrita: "o TMDB recommendations passar a ser
 *      persistido".
 *
 * Tres ocorrencias do mesmo padrao nao pedem tres consertos: pedem uma TRAVA.
 *
 * ============================================================================
 * POR QUE O DEFEITO E INVISIVEL
 * ============================================================================
 * `TmdbMovieDetail` (e irmaos) sao um SUBSET declarado a mao — o proprio
 * cabecalho de `types.ts` diz isso. Um campo que chega no JSON e nao esta
 * declarado no tipo desaparece no limite do tipo: sem erro, sem aviso, sem
 * custo aparente. E a cota ja foi paga, entao nem a conta de requisicoes
 * denuncia.
 *
 * Nada ligava a lista de `append_to_response` a lista de consumidores. Este
 * arquivo liga: todo valor pedido ao TMDB tem de aparecer aqui, classificado, e
 * `tests/governance/tmdb-append-consumption.test.ts` reprova quando um valor e
 * pedido sem classificacao.
 *
 * ============================================================================
 * COMO USAR
 * ============================================================================
 * Ao ACRESCENTAR um valor a MOVIE_APPEND/TV_APPEND/... classifique-o aqui.
 * Ao passar a CONSUMIR um valor, mova-o de `deferred` para `consumed`.
 *
 * `deferred` NAO e uma lista de vergonha: pedir dado que ainda nao se consome e
 * legitimo (o arquivo bruto e o mesmo, a cota e a mesma, e o dado fica em
 * `api_cache` para quando houver escopo). O que nao e legitimo e pedir sem
 * ninguem SABER que nao se consome. A justificativa e obrigatoria por isso.
 */

import { TMDB_APPEND_BY_TYPE, type TmdbAppendableType } from './append-to-response.js'

/** Onde um valor de append e efetivamente lido. */
export interface AppendConsumer {
  /** O valor, exatamente como vai no `append_to_response`. */
  readonly value: string
  /** Modulo que le. Caminho de repositorio, para o leitor poder conferir. */
  readonly consumedBy: string
}

/** Um valor pedido de proposito e ainda nao consumido. */
export interface AppendDeferred {
  readonly value: string
  /** POR QUE e pedido mesmo sem consumidor. Obrigatorio. */
  readonly reason: string
}

/**
 * Valores de append que ALGUEM le.
 *
 * O caminho e conferivel a mao: se o modulo citado nao mencionar o campo, o
 * registro esta mentindo e o teste de governanca nao vai perceber — ele so
 * garante COBERTURA, nao veracidade. Manter honesto e trabalho humano.
 */
export const APPEND_CONSUMED: readonly AppendConsumer[] = [
  { value: 'credits', consumedBy: 'services/ingestion/src/normalizers/credits.ts' },
  { value: 'aggregate_credits', consumedBy: 'services/ingestion/src/normalizers/credits.ts' },
  { value: 'external_ids', consumedBy: 'services/ingestion/src/normalizers/external-ids.ts' },
  { value: 'images', consumedBy: 'services/ingestion/src/catalog-sync/media-normalize.ts' },
  { value: 'videos', consumedBy: 'services/ingestion/src/catalog-sync/media-normalize.ts' },
  { value: 'watch/providers', consumedBy: 'services/ingestion/src/normalizers/watch-providers.ts' },
  { value: 'recommendations', consumedBy: 'services/ingestion/src/normalizers/recommendations.ts' },
  { value: 'similar', consumedBy: 'services/ingestion/src/normalizers/recommendations.ts' },
  { value: 'combined_credits', consumedBy: 'services/ingestion/src/normalizers/credits.ts' },
]

/**
 * Valores pedidos de proposito e ainda NAO consumidos, com o motivo.
 *
 * Cada linha e uma divida declarada. Nenhuma e "esqueci".
 */
export const APPEND_DEFERRED: readonly AppendDeferred[] = [
  {
    value: 'keywords',
    reason:
      'Taxonomia mais fina que genero. Nao ha superficie que a use, e criar uma sem escopo ' +
      'editorial produziria pagina fina. Fica no bruto (api_cache) ate haver decisao.',
  },
  {
    value: 'reviews',
    reason:
      'Critica de terceiro. NAO pode ser exibida: `review_quote_allowed` e false em toda ' +
      'licenca, e liberar exige autorizacao especifica que nao existe. Pedir e barato; ' +
      'exibir e proibido (invariante 6).',
  },
  {
    value: 'release_dates',
    reason:
      'Classificacao indicativa por pais. `movies.certification` e alimentada por outro ' +
      'caminho hoje; consolidar os dois exige tarefa propria.',
  },
  {
    value: 'content_ratings',
    reason:
      'Equivalente de `release_dates` para serie: classificacao indicativa por pais. Mesma ' +
      'pendencia — `tv_shows.certification` e alimentada por outro caminho, e consolidar as ' +
      'duas origens exige tarefa propria.',
  },
  {
    value: 'translations',
    reason:
      'Traducoes de titulo/sinopse por idioma. `entity_translations` e alimentada pelo ' +
      'detalhe em pt-BR; consumir este bloco e a porta de en/es, que dependem de ' +
      'PUBLISHED_LOCALES e de revisao humana (invariante 7).',
  },
  {
    value: 'alternative_titles',
    reason:
      'Titulos alternativos por pais. Nao ha superficie que os exiba, mas alimentariam a ' +
      'projecao de busca (search_documents) quando houver escopo para sinonimo de titulo.',
  },
  {
    value: 'changes',
    reason:
      'Diario de alteracoes da entidade. O sync incremental usa os endpoints /changes ' +
      'globais, nao este bloco por entidade.',
  },
  {
    value: 'episode_groups',
    reason: 'Ordens alternativas de exibicao (cronologica, etc.). Bloco de valor 11, sem escopo.',
  },
  {
    value: 'screened_theatrically',
    reason:
      'Quais episodios de uma serie foram exibidos em cinema. Fato raro e sem lugar em ' +
      'nenhuma tela do canonico; inventar um bloco para ele produziria pagina fina.',
  },
  {
    value: 'tagged_images',
    reason:
      'Imagens em que a pessoa aparece, marcadas por usuarios do TMDB. Procedencia de ' +
      'usuario, nao editorial; a galeria usa `images`.',
  },
]

/** Todo valor de append pedido, em qualquer tipo, sem repeticao. */
export function allRequestedAppendValues(): readonly string[] {
  const todos = new Set<string>()
  for (const tipo of Object.keys(TMDB_APPEND_BY_TYPE) as TmdbAppendableType[]) {
    for (const valor of TMDB_APPEND_BY_TYPE[tipo]) todos.add(valor)
  }
  return [...todos].sort()
}

/** Valores pedidos que nao estao classificados nem como consumidos nem como adiados. */
export function unclassifiedAppendValues(): readonly string[] {
  const classificados = new Set<string>([
    ...APPEND_CONSUMED.map((c) => c.value),
    ...APPEND_DEFERRED.map((d) => d.value),
  ])
  return allRequestedAppendValues().filter((v) => !classificados.has(v))
}
