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

/**
 * DE QUAL COPIA o consumidor le. A distincao nao e academica.
 *
 * Um valor no `append_to_response` chega DENTRO do payload de detalhe. O mesmo
 * sub-recurso tambem existe como ENDPOINT proprio (`/movie/{id}/images`). Ler o
 * endpoint proprio nao consome a copia que veio no append — e a copia do append
 * continua sendo pedida, arquivada e nunca lida.
 *
 * Ate 21/08/2026 o registro nao sabia distinguir os dois, e por isso classificou
 * `images` e `videos` como CONSUMIDOS: `media-normalize.ts` de fato os
 * normaliza, mas normaliza a resposta de `/movie/{id}/images` e
 * `/movie/{id}/videos` — chamadas SEPARADAS feitas por `runMediaSync`. Os
 * normalizadores do detalhe (`normalizers/movie.ts`, `normalizers/tv.ts`) nao
 * mencionam `images` nem `videos` em linha nenhuma.
 */
export type AppendConsumptionSource =
  /** Lido do payload de DETALHE, onde o append o entregou. */
  | 'detail-append'
  /** Lido de um ENDPOINT proprio. A copia do append segue sem leitor. */
  | 'dedicated-endpoint'

/** Onde um valor de append e efetivamente lido. */
export interface AppendConsumer {
  /** O valor, exatamente como vai no `append_to_response`. */
  readonly value: string
  /** Modulo que le. Caminho de repositorio, para o leitor poder conferir. */
  readonly consumedBy: string
  /** De qual copia. Ver {@link AppendConsumptionSource}. */
  readonly source: AppendConsumptionSource
  /**
   * Obrigatorio quando `source` e `dedicated-endpoint`: POR QUE o valor continua
   * no append se quem o le nao le essa copia. Sem esta linha, um append pago e
   * nunca lido volta a ser invisivel — que e o defeito que este arquivo existe
   * para fechar.
   */
  readonly appendCopyRationale?: string
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
  { value: 'credits', consumedBy: 'services/ingestion/src/normalizers/credits.ts', source: 'detail-append' },
  { value: 'aggregate_credits', consumedBy: 'services/ingestion/src/normalizers/credits.ts', source: 'detail-append' },
  { value: 'external_ids', consumedBy: 'services/ingestion/src/normalizers/external-ids.ts', source: 'detail-append' },
  {
    value: 'images',
    consumedBy: 'services/ingestion/src/catalog-sync/media-normalize.ts',
    // NAO le a copia do append: `runMediaSync` chama `/movie|tv/{id}/images`.
    source: 'dedicated-endpoint',
    appendCopyRationale:
      'A copia do append e pedida com `language` (o detalhe vai com pt-BR), e o TMDB ' +
      'FILTRA `/images` por esse idioma: viriam so as poucas artes com `iso_639_1=pt`. ' +
      'A galeria precisa do conjunto INTEIRO, entao `sync_media` chama o endpoint ' +
      'proprio, que vai SEM `language` e devolve todos os idiomas. ' +
      'Tirar `images` do append trocaria bytes por invalidacao de TODO o `api_cache` ' +
      '(o valor do append entra na chave de cache — ver PR #181), por zero ganho ' +
      'de dado. Fica, declarado, ate haver motivo melhor que economia de bytes.',
  },
  {
    value: 'videos',
    consumedBy: 'services/ingestion/src/catalog-sync/media-normalize.ts',
    // Mesma historia de `images`, e com a mesma consequencia: trailer em `en`
    // nao apareceria num detalhe pedido com `language=pt-BR`.
    source: 'dedicated-endpoint',
    appendCopyRationale:
      'Identico a `images`: o detalhe vai com `language=pt-BR` e o TMDB filtra `/videos` ' +
      'por idioma, o que descartaria o trailer oficial em `en` da maioria dos titulos. ' +
      '`sync_media` chama `/movie|tv/{id}/videos` sem `language`.',
  },
  { value: 'watch/providers', consumedBy: 'services/ingestion/src/normalizers/watch-providers.ts', source: 'detail-append' },
  { value: 'recommendations', consumedBy: 'services/ingestion/src/normalizers/recommendations.ts', source: 'detail-append' },
  { value: 'similar', consumedBy: 'services/ingestion/src/normalizers/recommendations.ts', source: 'detail-append' },
  { value: 'combined_credits', consumedBy: 'services/ingestion/src/normalizers/credits.ts', source: 'detail-append' },
  { value: 'release_dates', consumedBy: 'services/ingestion/src/normalizers/detail-facts.ts', source: 'detail-append' },
  { value: 'content_ratings', consumedBy: 'services/ingestion/src/normalizers/detail-facts.ts', source: 'detail-append' },
]

/**
 * Valores cuja copia do APPEND nao tem leitor (o consumidor le endpoint proprio).
 *
 * Existe como funcao para ter teste: sem ela, a distincao viveria so no campo e
 * nada reprovaria uma entrada `dedicated-endpoint` sem justificativa.
 */
export function appendValuesReadFromDedicatedEndpoint(): readonly AppendConsumer[] {
  return APPEND_CONSUMED.filter((entry) => entry.source === 'dedicated-endpoint')
}

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
