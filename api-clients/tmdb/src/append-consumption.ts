/**
 * append-consumption.ts — O REGISTRO de quem consome cada valor de
 * `append_to_response`, POR TIPO DE ENTIDADE.
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
 * A QUARTA OCORRENCIA ACONTECEU MESMO COM A TRAVA — E O MOTIVO E ESTRUTURAL
 * ============================================================================
 * Ate 2026-08-27 este registro era chaveado pelo VALOR do append, sozinho.
 * `credits` estava classificado como CONSUMIDO por `normalizers/credits.ts`, e
 * era verdade — para `movie` e `tv`. `TV_SEASON_APPEND` e `TV_EPISODE_APPEND`
 * pedem o MESMO valor `credits`, para os quais aquele normalizador nunca foi
 * chamado. O registro dizia "alguem le" e a trava concordava, porque as duas
 * so sabiam falar de strings.
 *
 * Resultado medido: os SETE appends de `/tv/{id}/season/{n}` eram pedidos em
 * toda sincronizacao de temporada e descartados inteiros, com a trava verde.
 * A pagina de episodio ficou sem elenco convidado, sem direcao e sem roteiro —
 * dado que ja chegava — e a de temporada ficou sem trailer.
 *
 * Por isso a chave agora e o PAR `(tipo, valor)`. Um valor pedido em cinco
 * tipos de detalhe sao CINCO afirmacoes, e cada uma tem de ser feita
 * separadamente. `types` e obrigatorio justamente para que ninguem possa
 * classificar `credits` "em geral" de novo.
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
 * ============================================================================
 * COMO USAR
 * ============================================================================
 * Ao ACRESCENTAR um valor a MOVIE_APPEND/TV_APPEND/... classifique o PAR aqui,
 * nomeando o tipo. Ao passar a CONSUMIR um par, mova-o de `deferred` para
 * `consumed` — sem arrastar os outros tipos junto.
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

/** Um par `(tipo de detalhe, valor de append)` — a unidade de classificacao. */
export interface AppendPair {
  readonly type: TmdbAppendableType
  readonly value: string
}

/** Onde um valor de append e efetivamente lido, e PARA QUAIS TIPOS. */
export interface AppendConsumer {
  /** O valor, exatamente como vai no `append_to_response`. */
  readonly value: string
  /**
   * Os tipos de detalhe que esta entrada cobre. OBRIGATORIO.
   *
   * Nao ha "todos": o mesmo valor pode ter leitor num tipo e nenhum leitor em
   * outro, e foi exatamente essa distincao ausente que deixou os sete appends
   * de temporada invisiveis por meses.
   */
  readonly types: readonly TmdbAppendableType[]
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

/** Um par pedido de proposito e ainda nao consumido. */
export interface AppendDeferred {
  readonly value: string
  /** Os tipos cobertos por esta justificativa. OBRIGATORIO (ver AppendConsumer). */
  readonly types: readonly TmdbAppendableType[]
  /** POR QUE e pedido mesmo sem consumidor. Obrigatorio. */
  readonly reason: string
}

/**
 * A copia do append de `images`/`videos` nao e lida, e o motivo e o mesmo nos
 * cinco tipos: o detalhe vai com `language`, e o TMDB FILTRA esses dois
 * sub-recursos por idioma.
 *
 * Escrito UMA vez e reusado nas entradas porque cinco copias divergiriam no
 * primeiro conserto aplicado a uma e esquecido nas outras — e a justificativa
 * e a unica coisa que impede o par de voltar a ser invisivel.
 */
const RATIONALE_MIDIA_FILTRADA_POR_IDIOMA =
  'A copia do append e pedida com `language` (o detalhe vai com pt-BR), e o TMDB ' +
  'FILTRA `/images` e `/videos` por esse idioma: viriam so as poucas artes com ' +
  '`iso_639_1=pt`, e o trailer oficial em `en` da maioria dos titulos sumiria. ' +
  'A galeria precisa do conjunto INTEIRO, entao `sync_media` chama o endpoint ' +
  'proprio, que vai SEM `language` e devolve todos os idiomas. ' +
  'Tirar o valor do append trocaria bytes por invalidacao de TODO o `api_cache` ' +
  '(o valor do append entra na chave de cache — ver PR #181), por zero ganho ' +
  'de dado. Fica, declarado, ate haver motivo melhor que economia de bytes.'

/**
 * Pares de append que ALGUEM le.
 *
 * O caminho e conferivel a mao: se o modulo citado nao mencionar o campo, o
 * registro esta mentindo e o teste de governanca nao vai perceber — ele so
 * garante COBERTURA, nao veracidade. Manter honesto e trabalho humano.
 */
export const APPEND_CONSUMED: readonly AppendConsumer[] = [
  {
    value: 'credits',
    types: ['movie', 'tv'],
    consumedBy: 'services/ingestion/src/normalizers/credits.ts',
    source: 'detail-append',
  },
  {
    // NOVO em 2026-08-27: `syncEpisodes` passou a chamar `getTvEpisode`, e o
    // detalhe do episodio traz `credits.cast` / `credits.crew` / guest stars.
    // Antes o chamador passava o item de `/tv/{id}/season/{n}`, que NAO tem o
    // bloco `credits` — os extratores liam `credits.cast` de um objeto que
    // nunca o teve e devolviam [] em toda execucao, contadas como sucesso.
    value: 'credits',
    types: ['tv_episode'],
    consumedBy: 'services/ingestion/src/episodes/normalize.ts',
    source: 'detail-append',
  },
  {
    value: 'external_ids',
    types: ['movie', 'tv', 'person'],
    consumedBy: 'services/ingestion/src/normalizers/external-ids.ts',
    source: 'detail-append',
  },
  {
    value: 'external_ids',
    types: ['tv_episode'],
    consumedBy: 'services/ingestion/src/episodes/normalize.ts',
    source: 'detail-append',
  },
  {
    value: 'images',
    types: ['movie', 'tv', 'person'],
    consumedBy: 'services/ingestion/src/catalog-sync/media-normalize.ts',
    source: 'dedicated-endpoint',
    appendCopyRationale: RATIONALE_MIDIA_FILTRADA_POR_IDIOMA,
  },
  {
    // Temporada: `sync_media` com `kind='season'` chama `/tv/{id}/season/{n}/images`.
    value: 'images',
    types: ['tv_season'],
    consumedBy: 'services/ingestion/src/catalog-sync/media-normalize.ts',
    source: 'dedicated-endpoint',
    appendCopyRationale: RATIONALE_MIDIA_FILTRADA_POR_IDIOMA,
  },
  {
    // Episodio: a copia do append E lida (`extractEpisodeStills` le
    // `images.stills` do detalhe), e o endpoint proprio ainda roda por cima
    // para trazer os stills sem idioma que o filtro do detalhe descarta. Os
    // dois escrevem na MESMA chave unica de `tmdb_images`, entao a segunda
    // passagem e idempotente — nao duplica linha.
    value: 'images',
    types: ['tv_episode'],
    consumedBy: 'services/ingestion/src/episodes/normalize.ts',
    source: 'detail-append',
  },
  {
    value: 'videos',
    types: ['movie', 'tv'],
    consumedBy: 'services/ingestion/src/catalog-sync/media-normalize.ts',
    source: 'dedicated-endpoint',
    appendCopyRationale: RATIONALE_MIDIA_FILTRADA_POR_IDIOMA,
  },
  {
    // Temporada e episodio: `sync_media` com `kind='season'`/`kind='episode'`
    // chama `/tv/{id}/season/{n}/videos` e `/…/episode/{e}/videos`.
    value: 'videos',
    types: ['tv_season', 'tv_episode'],
    consumedBy: 'services/ingestion/src/catalog-sync/media-normalize.ts',
    source: 'dedicated-endpoint',
    appendCopyRationale: RATIONALE_MIDIA_FILTRADA_POR_IDIOMA,
  },
  {
    value: 'watch/providers',
    types: ['movie', 'tv'],
    consumedBy: 'services/ingestion/src/normalizers/watch-providers.ts',
    source: 'detail-append',
  },
  {
    value: 'recommendations',
    types: ['movie', 'tv'],
    consumedBy: 'services/ingestion/src/normalizers/recommendations.ts',
    source: 'detail-append',
  },
  {
    value: 'similar',
    types: ['movie', 'tv'],
    consumedBy: 'services/ingestion/src/normalizers/recommendations.ts',
    source: 'detail-append',
  },
  {
    value: 'release_dates',
    types: ['movie'],
    consumedBy: 'services/ingestion/src/normalizers/detail-facts.ts',
    source: 'detail-append',
  },
  {
    value: 'content_ratings',
    types: ['tv'],
    consumedBy: 'services/ingestion/src/normalizers/detail-facts.ts',
    source: 'detail-append',
  },
  {
    // CORRIGIDO em 2026-08-27. Estava em APPEND_DEFERRED com a razao "nao ha
    // superficie que a use" — e `extractKeywords` ja era chamado em
    // `catalog-services.ts:314`. O registro estava mentindo a favor da divida:
    // declarava divida onde havia consumo.
    value: 'keywords',
    types: ['movie', 'tv'],
    consumedBy: 'services/ingestion/src/catalog-entities/normalize.ts',
    source: 'detail-append',
  },
  {
    // CORRIGIDO em 2026-08-27, mesma historia de `keywords`:
    // `extractAlternativeTitles` e chamado em `catalog-services.ts:315`.
    value: 'alternative_titles',
    types: ['movie', 'tv'],
    consumedBy: 'services/ingestion/src/catalog-entities/normalize.ts',
    source: 'detail-append',
  },
]

/**
 * Pares cuja copia do APPEND nao tem leitor (o consumidor le endpoint proprio).
 *
 * Existe como funcao para ter teste: sem ela, a distincao viveria so no campo e
 * nada reprovaria uma entrada `dedicated-endpoint` sem justificativa.
 */
export function appendValuesReadFromDedicatedEndpoint(): readonly AppendConsumer[] {
  return APPEND_CONSUMED.filter((entry) => entry.source === 'dedicated-endpoint')
}

/**
 * Pares pedidos de proposito e ainda NAO consumidos, com o motivo.
 *
 * Cada linha e uma divida declarada. Nenhuma e "esqueci".
 */
export const APPEND_DEFERRED: readonly AppendDeferred[] = [
  {
    value: 'reviews',
    types: ['movie', 'tv'],
    reason:
      'Critica de terceiro. NAO pode ser exibida: `review_quote_allowed` e false em toda ' +
      'licenca, e liberar exige autorizacao especifica que nao existe. Pedir e barato; ' +
      'exibir e proibido (invariante 6).',
  },
  {
    value: 'translations',
    types: ['movie', 'tv', 'tv_season', 'tv_episode', 'person'],
    reason:
      'Traducoes de titulo/sinopse por idioma. `entity_translations` e alimentada pelo ' +
      'detalhe em pt-BR; consumir este bloco e a porta de en/es, que dependem de ' +
      'PUBLISHED_LOCALES e de revisao humana (invariante 7).',
  },
  {
    value: 'changes',
    types: ['movie', 'tv', 'person'],
    reason:
      'Diario de alteracoes da entidade. O sync incremental usa os endpoints /changes ' +
      'globais, nao este bloco por entidade.',
  },
  {
    value: 'episode_groups',
    types: ['tv'],
    reason: 'Ordens alternativas de exibicao (cronologica, etc.). Bloco de valor 11, sem escopo.',
  },
  {
    value: 'screened_theatrically',
    types: ['tv'],
    reason:
      'Quais episodios de uma serie foram exibidos em cinema. Fato raro e sem lugar em ' +
      'nenhuma tela do canonico; inventar um bloco para ele produziria pagina fina.',
  },
  {
    value: 'tagged_images',
    types: ['person'],
    reason:
      'Imagens em que a pessoa aparece, marcadas por usuarios do TMDB. Procedencia de ' +
      'usuario, nao editorial; a galeria usa `images`.',
  },
  {
    // Os DOIS blocos de credito da TEMPORADA. Ate 2026-08-27 nem apareciam
    // aqui: `credits` estava classificado como consumido "em geral" e
    // `aggregate_credits` mentia apontando para `normalizers/credits.ts`, onde
    // a string nunca existiu.
    value: 'credits',
    types: ['tv_season'],
    reason:
      'Elenco/equipe da TEMPORADA (nao do episodio). Nenhuma tela do canonico tem bloco ' +
      'de elenco por temporada: a ficha da serie mostra o elenco da SERIE e a pagina de ' +
      'episodio mostra o do EPISODIO — este ficaria entre os dois, repetindo um e ' +
      'competindo com o outro. Persistir sem superficie criaria linhas de `cast_members` ' +
      'com `entity_type=season` que nada leria. Fica no bruto ate haver decisao editorial.',
  },
  {
    value: 'aggregate_credits',
    types: ['tv', 'tv_season'],
    reason:
      'Elenco agregado por temporada/serie, com `roles[]` e contagem de episodios. NAO ha ' +
      'consumidor: `normalizers/credits.ts` le `credits.cast`/`credits.crew` e nunca ' +
      'mencionou `aggregate_credits` (o registro afirmava o contrario ate 2026-08-27 — ' +
      'grep em `services/**` devolve zero). Consumi-lo exigiria coluna de contagem de ' +
      'episodios por credito, que o schema nao tem.',
  },
  {
    value: 'combined_credits',
    types: ['person'],
    reason:
      'Filmografia completa da pessoa (uniao de movie_credits e tv_credits). NAO ha ' +
      'consumidor: a unica ocorrencia da string em `services/**` e um comentario em ' +
      '`bin/promote-tmdb-raw.ts` (o registro afirmava `normalizers/credits.ts` ate ' +
      '2026-08-27, e a string nunca esteve la). A filmografia da pagina de pessoa e ' +
      'montada pelo caminho INVERSO — `cast_members`/`crew_members` ja gravados pelo ' +
      'detalhe de cada titulo — entao consumir este bloco duplicaria a mesma verdade ' +
      'por outra porta.',
  },
  {
    value: 'external_ids',
    types: ['tv_season'],
    reason:
      'Ids externos da TEMPORADA (tvdb, tvrage, freebase). `entity_external_ids` aceita ' +
      '`entity_type=season`, mas nada os consulta: a atribuicao e o linkback da pagina ' +
      'de temporada apontam para a SERIE, e nenhum provedor de nota ou de oferta e ' +
      'chaveado por temporada. Gravar id que ninguem resolve e inventario, nao dado.',
  },
  {
    // O caso que a auditoria de 22/08 nomeou: pedido a cada temporada e RECUSADO
    // pelo proprio normalizador, sem que nada registrasse a recusa.
    value: 'watch/providers',
    types: ['tv_season'],
    reason:
      'Disponibilidade por temporada. `normalizeWatchProviders` aceita SO `movie`/`tv` e ' +
      'recusa este bloco — a recusa e deliberada: `watch_availability` e chaveada por ' +
      'entidade renderizavel com pagina de oferta, e a temporada nao tem essa pagina. ' +
      'Ativar exigiria escopo de produto (oferta por temporada), decisao de licenca por ' +
      'fornecedor e uma superficie que hoje nao existe. Fica declarado, nao silencioso.',
  },
]

/** Todo PAR `(tipo, valor)` pedido ao TMDB, em qualquer tipo de detalhe. */
export function allRequestedAppendPairs(): readonly AppendPair[] {
  const pares: AppendPair[] = []
  for (const type of Object.keys(TMDB_APPEND_BY_TYPE) as TmdbAppendableType[]) {
    for (const value of TMDB_APPEND_BY_TYPE[type]) pares.push({ type, value })
  }
  return pares
}

/** Todo valor de append pedido, em qualquer tipo, sem repeticao. */
export function allRequestedAppendValues(): readonly string[] {
  return [...new Set(allRequestedAppendPairs().map((par) => par.value))].sort()
}

/** Chave estavel de um par, para comparacao em Set/Map. */
export function appendPairKey(pair: AppendPair): string {
  return `${pair.type}:${pair.value}`
}

/** Expande as entradas do registro em pares `(tipo, valor)`. */
function pairsOf(entries: readonly { value: string; types: readonly TmdbAppendableType[] }[]): Set<string> {
  const chaves = new Set<string>()
  for (const entry of entries) {
    for (const type of entry.types) chaves.add(appendPairKey({ type, value: entry.value }))
  }
  return chaves
}

/**
 * Pares pedidos que nao estao classificados nem como consumidos nem como adiados.
 *
 * E aqui que a cegueira antiga aparecia: com a chave sendo so o valor, os sete
 * pares de `tv_season` herdavam a classificacao de `movie`/`tv` e sumiam.
 */
export function unclassifiedAppendPairs(): readonly AppendPair[] {
  const classificados = new Set([...pairsOf(APPEND_CONSUMED), ...pairsOf(APPEND_DEFERRED)])
  return allRequestedAppendPairs().filter((par) => !classificados.has(appendPairKey(par)))
}

/** Pares classificados nas DUAS listas ao mesmo tempo (o registro se contradiz). */
export function doublyClassifiedAppendPairs(): readonly AppendPair[] {
  const consumidos = pairsOf(APPEND_CONSUMED)
  const adiados = pairsOf(APPEND_DEFERRED)
  return allRequestedAppendPairs().filter(
    (par) => consumidos.has(appendPairKey(par)) && adiados.has(appendPairKey(par)),
  )
}

/**
 * Pares que o registro classifica e NINGUEM pede.
 *
 * Entrada morta e pior que ausencia: da a impressao de cobertura. Se um valor
 * sai do append (ou sai de UM tipo), a linha correspondente sai daqui junto.
 */
export function unrequestedRegistryPairs(): readonly AppendPair[] {
  const pedidos = new Set(allRequestedAppendPairs().map(appendPairKey))
  const registrados = [...pairsOf(APPEND_CONSUMED), ...pairsOf(APPEND_DEFERRED)]
  return registrados
    .filter((chave) => !pedidos.has(chave))
    .map((chave) => {
      const corte = chave.indexOf(':')
      return {
        type: chave.slice(0, corte) as TmdbAppendableType,
        value: chave.slice(corte + 1),
      }
    })
}
