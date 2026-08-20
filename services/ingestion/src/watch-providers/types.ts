/**
 * types.ts — Portas e relatorio do reprocessamento de `watch/providers`.
 * Modulo PURO (sem Prisma, sem rede).
 *
 * O reprocessamento le `tmdb_raw` (payload JA arquivado) e escreve
 * `watch_availability`. ZERO chamada ao TMDB: um "reprocessamento" que refizesse
 * fetch seria um sync disfarcado, com custo de cota escondido — a mesma regra
 * que `reprocess_raw` ja declara.
 */

import type {
  WatchProviderOffer,
  WatchProviderRejection,
  WatchProviderRejectionReason,
  WatchProvidersEntityType,
} from '../normalizers/watch-providers.js'

/** Uma linha bruta lida do deposito do bruto (Postgres `tmdb_raw` ou objeto). */
export interface RawWatchSourceRow {
  readonly tmdbId: number
  readonly baseLanguage: string
  readonly payload: unknown
  /**
   * `false` = o id existe no CATALOGO e o bruto NAO existe no deposito.
   *
   * Campo obrigatorio, e nao um `payload` opcional, porque `payload` pode ser
   * `null` legitimamente: ausencia jamais pode ser representada por um valor do
   * dominio do payload. Enquanto a fonte enumerava o proprio deposito, esta
   * distincao nao existia — o que faltava nao voltava na consulta, e por isso
   * nao podia ser contado. Ver `catalog-source.ts`.
   */
  readonly present: boolean
}

/** Porta de leitura do bruto arquivado, por tipo de entidade. */
export interface RawWatchSource {
  count(entityType: WatchProvidersEntityType): Promise<number>
  list(
    entityType: WatchProvidersEntityType,
    limit: number,
  ): Promise<readonly RawWatchSourceRow[]>
}

/**
 * Porta de enumeracao do CATALOGO (`movies`/`tv_shows`) — o universo real.
 *
 * Separada de `RawWatchSource` de proposito: e ela que fornece o denominador do
 * veredito de cobertura. Um denominador tirado do deposito faz o comando medir a
 * si mesmo, que foi exatamente como "corpus INTEIRO" acabou impresso sobre um
 * universo com 39 entidades invisiveis.
 */
export interface CatalogEntityIndex {
  count(entityType: WatchProvidersEntityType): Promise<number>
  listTmdbIds(
    entityType: WatchProvidersEntityType,
    limit: number,
  ): Promise<readonly number[]>
}

/** Uma entidade local ja resolvida (tmdbId -> id interno). */
export interface ResolvedWatchEntity {
  readonly tmdbId: number
  /** Id interno (BigInt serializado como string). */
  readonly entityId: string
}

/**
 * Porta de resolucao tmdbId -> id interno.
 *
 * Separada da escrita de proposito: uma entidade presente em `tmdb_raw` mas
 * ainda NAO promovida para `movies`/`tv_shows` nao tem id interno, e gravar
 * oferta apontando para id inexistente violaria a FK. O desfecho e
 * `unresolved` — contado e nomeado, nunca descartado em silencio.
 */
export interface WatchEntityResolver {
  resolve(
    entityType: WatchProvidersEntityType,
    tmdbIds: readonly number[],
  ): Promise<readonly ResolvedWatchEntity[]>
}

/** Resultado de um replace de snapshot por (entidade, pais). */
export interface WatchSnapshotOutcome {
  /** Linhas inseridas ou atualizadas por identidade. */
  readonly upserted: number
  /** Ofertas que sumiram do snapshot: revogadas + marcadas stale, nunca apagadas. */
  readonly revoked: number
}

/**
 * Porta de escrita em `watch_availability`, escopada por
 * (entidade, pais, `provider_api` deste worker).
 *
 * Toda linha nasce `display_allowed = false` (invariante 6). Este contrato NAO
 * expoe nenhum campo de licenca/atribuicao/revisao: acender a exibicao e
 * decisao HUMANA, feita por outro caminho.
 */
export interface WatchOfferStore {
  replaceSnapshot(input: {
    readonly entityType: WatchProvidersEntityType
    readonly entityId: string
    readonly countryCode: string
    readonly offers: readonly WatchProviderOffer[]
    readonly fetchedAt: Date
    readonly staleAfter: Date
  }): Promise<WatchSnapshotOutcome>
}

/** Desfecho de UMA entidade reprocessada. */
export type WatchReprocessOutcome =
  /** Ofertas reconhecidas e gravadas (ou planejadas, em dry-run). */
  | 'applied'
  /** Payload reconhecido, zero pais com oferta: o titulo nao tem oferta. */
  | 'empty'
  /**
   * O titulo TEM oferta, mas nenhuma nos territorios ingeridos. Desfecho
   * proprio de proposito: colapsa-lo em `empty` afirmaria "este titulo nao tem
   * onde assistir" quando a verdade e "nos e que nao ingerimos aquele pais".
   */
  | 'out-of-scope'
  /** Payload NAO reconhecido: snapshot preservado, nada tocado. */
  | 'unrecognized'
  /** Entidade ainda nao promovida para a tabela tipada: sem id interno. */
  | 'unresolved'
  /**
   * O id esta no catalogo e o bruto NAO existe no deposito consultado.
   *
   * Nao e `unrecognized` (la existe payload, e ele que nao serve) e nao e
   * `unresolved` (la o bruto existe e a entidade e que nao foi promovida). E o
   * desfecho que a fonte antiga era estruturalmente incapaz de produzir.
   */
  | 'missing-raw'
  /** Erro na escrita. Sempre acompanhado da causa em `failures`. */
  | 'failed'

/** Contagem por desfecho. */
export interface WatchReprocessCounts {
  readonly scanned: number
  readonly applied: number
  readonly empty: number
  /** Titulos cujas ofertas cairam TODAS fora dos territorios ingeridos. */
  readonly outOfScope: number
  readonly unrecognized: number
  readonly unresolved: number
  /** Ids do catalogo sem bruto no deposito. Ver o desfecho `missing-raw`. */
  readonly missingRaw: number
  readonly failed: number
  /**
   * Ofertas gravadas por entidades que COMPLETARAM (`applied`).
   *
   * Este numero e o par de `applied`: se `applied` e 0, este e 0. Ate a
   * producao de 2026-08-13 ele somava tambem o que ficara gravado por
   * entidades que falharam depois, e o relatorio saia com
   * `aplicados 0 (ofertas: +41)` — sucesso anunciado num ciclo cujo desfecho
   * foi falha em 100 de 100. O que foi gravado antes da falha agora tem
   * contador PROPRIO (`offersUpsertedOnFailedEntities`).
   */
  readonly offersUpserted: number
  readonly offersRevoked: number
  /**
   * Ofertas ja COMMITADAS por entidades que falharam depois. `replaceSnapshot`
   * e uma transacao POR PAIS: com mais de um territorio no escopo, os paises
   * anteriores ao erro ficam gravados. Nao e sucesso (a entidade nao completou,
   * e a revogacao dos paises restantes nao rodou) e nao e zero (o byte esta no
   * banco) — por isso e um terceiro numero, nao um arredondamento de nenhum dos
   * dois.
   */
  readonly offersUpsertedOnFailedEntities: number
  /** Ofertas descartadas por estarem fora dos territorios ingeridos. */
  readonly offersOutOfScope: number
}

/** Uma falha nomeada. O erro NUNCA evapora: classe + mensagem sanitizada. */
export interface WatchReprocessFailure {
  readonly tmdbId: number
  readonly errorClass: string
  readonly message: string
  /** Paises desta entidade gravados ANTES do erro (snapshot parcial). */
  readonly countriesWritten: readonly string[]
  /** Pais em que a escrita parou. */
  readonly countryFailed: string
}

/** Quantas vezes cada motivo de recusa apareceu no lote. */
export type WatchRejectionTally = Readonly<Partial<Record<WatchProviderRejectionReason, number>>>

/** Relatorio de um ciclo de reprocessamento. */
export interface WatchReprocessReport {
  readonly entityType: WatchProvidersEntityType
  readonly counts: WatchReprocessCounts
  readonly failures: readonly WatchReprocessFailure[]
  /** Recusas agregadas por motivo — nenhum descarte fica anonimo. */
  readonly rejections: WatchRejectionTally
  /**
   * Provedores TMDB distintos vistos, com contagem. Serve para preparar os
   * `watch_provider_aliases`: sem alias, a oferta e ingerida e auditavel mas o
   * trigger de governanca nao a deixa exibir.
   */
  readonly providersSeen: readonly WatchProviderSighting[]
  readonly countriesSeen: readonly string[]
  /** Territorios efetivamente ingeridos nesta execucao (escopo declarado). */
  readonly territories: readonly string[]
  /**
   * Paises vistos no dado e NAO ingeridos, com quantas ofertas cada um trazia.
   * Descarte por escopo e uma decisao — precisa ser legivel, nunca implicito.
   */
  readonly countriesOutOfScope: Readonly<Record<string, number>>
  readonly durationMs: number
  readonly dryRun: boolean
}

/**
 * Um provedor TMDB visto no dado real — a COLHEITA de onde saem os
 * `watch_provider_aliases`.
 *
 * `offerTypes` nao e enfeite: o TMDB registra a MESMA marca sob ids diferentes
 * conforme o papel comercial (Amazon aparece como 9/119 "Amazon Prime Video" e
 * como 10 "Amazon Video"). Sem a quebra por modalidade, a colheita nao permite
 * distinguir servico por assinatura de loja de compra avulsa, e mapear os dois
 * para o mesmo slug afirmaria que uma compra esta inclusa na assinatura. Com
 * ela, a decisao de alias sai do payload, nao do nome.
 */
export interface WatchProviderSighting {
  readonly providerKey: string
  readonly providerName: string
  /** Ofertas no corpus INTEIRO (todos os paises do payload). */
  readonly offers: number
  /**
   * Ofertas DENTRO dos territorios ingeridos — o unico numero que decide se um
   * provedor merece entrar no registro.
   *
   * A contagem global engana: um provedor com 324 ofertas em 7 paises pode ter
   * mais oferta em BR que a Netflix, ou nenhuma. Propor alias por volume mundial
   * num site que so ingere BR e decidir pelo numero errado — e cada provedor
   * canonico novo puxa licenca e decisao de uso no `legal apply`.
   */
  readonly offersInScope: number
  /** Contagem por modalidade (`subscription`, `rent`, `buy`, `free`, `ads`). */
  readonly offerTypes: Readonly<Record<string, number>>
  /**
   * Paises em que o provedor foi visto (ISO alpha-2, ordenados, deduplicados).
   *
   * Os CODIGOS, nao a contagem: a colheita anterior imprimia so "em N pais(es)",
   * e foi exatamente essa lacuna que travou a decisao entre `122` "Disney+" e
   * `337` "Disney Plus" — sem saber SE `122` esta so em IN/ID nao da para dizer
   * se e a marca conjunta Disney+/Hotstar ou o mesmo servico.
   */
  readonly countries: readonly string[]
}

/** Status derivado do ciclo (espelha o enum `SyncStatus`). */
export type WatchReprocessStatus = 'success' | 'partial' | 'failed' | 'empty'

export type { WatchProviderOffer, WatchProviderRejection, WatchProvidersEntityType }
