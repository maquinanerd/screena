/**
 * registry.ts — Composicao central dos handlers de producao (Backend A §4).
 *
 * `createCatalogHandlerRegistry` monta os ONZE handlers reais sobre dependencias
 * EXPLICITAS. Nao ha handler vazio, placeholder ou retorno de sucesso fingido:
 * cada tipo executa o dominio correspondente ou falha.
 *
 * O registry base (`createCatalogJobRegistry`) ja rejeita tipo duplicado; aqui
 * garantimos a COBERTURA — `assertCompleteRegistry` prova que os 11 tipos do
 * enum tem handler. Um tipo sem handler viraria dead-letter em producao
 * (`no_handler`), entao o erro tem de aparecer na composicao, nao na fila.
 */

import { createCatalogJobRegistry, type CatalogJobHandler, type CatalogJobRegistry } from '../handler.js'
import { CATALOG_JOB_TYPES, type CatalogJobType } from '../types.js'
import type { CatalogJobStorePort } from '../store-port.js'
import type { DiscoverySnapshotStorePort } from '../../discovery-snapshots/index.js'
import type { ChangesRunDeps } from '../../changes/run.js'
import { BootstrapHandler } from './bootstrap-handler.js'
import { DiscoverIdsHandler } from './discover-ids-handler.js'
import { ReprocessRawHandler } from './reprocess-raw-handler.js'
import { SyncChangesHandler } from './sync-changes-handler.js'
import { SyncCreditsHandler } from './sync-credits-handler.js'
import { SyncDetailsHandler } from './sync-details-handler.js'
import { SyncEpisodesHandler } from './sync-episodes-handler.js'
import { SyncExternalIdsHandler } from './sync-external-ids-handler.js'
import { SyncListsHandler } from './sync-lists-handler.js'
import { SyncMediaHandler } from './sync-media-handler.js'
import { SyncSeasonsHandler } from './sync-seasons-handler.js'
import type {
  CatalogCreditsSyncPort,
  CatalogDetailSyncPort,
  CatalogDiscoverIdsPort,
  CatalogEpisodesSyncPort,
  CatalogExternalIdsSyncPort,
  CatalogMediaSyncPort,
  CatalogReprocessRawPort,
  CatalogSeasonsSyncPort,
  DiscoveryListFetchPort,
  SearchReindexPort,
} from './ports.js'

/** Dependencias de producao dos handlers. Todas explicitas e injetaveis. */
export interface CatalogHandlerDependencies {
  /** Fila duravel: enqueue de filhos (bootstrap/discover/details/seasons). */
  readonly store: CatalogJobStorePort
  readonly detailSync: CatalogDetailSyncPort
  readonly creditsSync: CatalogCreditsSyncPort
  readonly externalIdsSync: CatalogExternalIdsSyncPort
  readonly mediaSync: CatalogMediaSyncPort
  readonly seasonsSync: CatalogSeasonsSyncPort
  readonly episodesSync: CatalogEpisodesSyncPort
  readonly discovery: CatalogDiscoverIdsPort
  readonly reprocessRaw: CatalogReprocessRawPort
  readonly listFetch: DiscoveryListFetchPort
  readonly snapshots: DiscoverySnapshotStorePort
  /** Deps do executor de changes, MENOS metrics/log (vem do contexto do job). */
  readonly changes: Omit<ChangesRunDeps, 'metrics' | 'log'>
  readonly search: SearchReindexPort
  readonly now?: () => Date
}

/**
 * Apaga os parametros de tipo de um handler para guarda-lo no registry.
 *
 * O registry e heterogeneo (11 pares I/O distintos) e por isso tipado como
 * `CatalogJobHandler<never, unknown>`. `validateInput` retorna `I`, e nenhum `I`
 * concreto e atribuivel a `never` — dai a erasure. E segura porque o worker so
 * usa a saida de `validateInput` como entrada de `execute` DO MESMO handler:
 * o par permanece consistente, ainda que o registry nao consiga prova-lo.
 */
function eraseHandlerTypes<I, O>(handler: CatalogJobHandler<I, O>): CatalogJobHandler<never, unknown> {
  return handler as unknown as CatalogJobHandler<never, unknown>
}

/**
 * Monta os 11 handlers de producao.
 *
 * Lanca se algum tipo do enum ficar sem handler — falhar na composicao (uma vez,
 * no boot) e infinitamente melhor que descobrir na fila, um dead-letter por vez.
 */
export function createCatalogHandlerRegistry(
  deps: CatalogHandlerDependencies,
): CatalogJobRegistry {
  const handlers: CatalogJobHandler<never, unknown>[] = [
    eraseHandlerTypes(new BootstrapHandler({ store: deps.store })),
    eraseHandlerTypes(new DiscoverIdsHandler({ discovery: deps.discovery, store: deps.store })),
    eraseHandlerTypes(
      new SyncDetailsHandler({ detailSync: deps.detailSync, store: deps.store, search: deps.search }),
    ),
    eraseHandlerTypes(new SyncCreditsHandler({ creditsSync: deps.creditsSync })),
    eraseHandlerTypes(new SyncExternalIdsHandler({ externalIdsSync: deps.externalIdsSync })),
    eraseHandlerTypes(new SyncMediaHandler({ mediaSync: deps.mediaSync })),
    eraseHandlerTypes(new SyncSeasonsHandler({ seasonsSync: deps.seasonsSync, store: deps.store })),
    eraseHandlerTypes(new SyncEpisodesHandler({ episodesSync: deps.episodesSync })),
    eraseHandlerTypes(
      new SyncListsHandler({ listFetch: deps.listFetch, snapshots: deps.snapshots, now: deps.now }),
    ),
    eraseHandlerTypes(new SyncChangesHandler({ changes: deps.changes })),
    eraseHandlerTypes(new ReprocessRawHandler({ reprocessRaw: deps.reprocessRaw })),
  ]

  const registry = createCatalogJobRegistry(handlers)
  assertCompleteRegistry(registry)
  return registry
}

/** Tipos do enum que nao tem handler no registry. */
export function missingHandlerTypes(registry: CatalogJobRegistry): CatalogJobType[] {
  return CATALOG_JOB_TYPES.filter((type) => !registry.has(type))
}

/** Lanca quando algum tipo do enum ficou sem handler. */
export function assertCompleteRegistry(registry: CatalogJobRegistry): void {
  const missing = missingHandlerTypes(registry)
  if (missing.length > 0) {
    throw new Error(`registry incompleto: sem handler para [${missing.join(', ')}]`)
  }
}
