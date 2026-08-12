/**
 * compose.ts — Do CONFIG resolvido ao `RawEntityStore` concreto.
 *
 * A #149 entregou a camada inteira (config por env, contrato, adapters
 * postgres/objeto/S3, retry) mas NINGUEM a consumia: `bin/sync-tmdb-raw.ts`
 * fixava `createPrismaTmdbRawStore` e todo payload cru ia para o Postgres —
 * exatamente o desenho revogado (o disco do banco e emprestado e nao pode
 * crescer). Este modulo e o elo: quem tem um `RawStoreConfig` valido recebe o
 * store certo, sem conhecer os adapters.
 *
 * As DEPENDENCIAS sao injetadas (Prisma, cliente S3) para o modulo continuar
 * testavel sem rede/banco — o mesmo padrao do proprio `s3-object-store`
 * (`S3ClientLike` injetavel). O bin injeta as reais.
 *
 * A garantia "r2 e o driver de PRODUCAO" nao vive aqui: vive em
 * `resolveRawStoreConfig`, que RECUSA `postgres` quando NODE_ENV/VERCEL_ENV
 * indicam producao e recusa omissao de driver em producao. Aqui so se compoe o
 * que a config ja validou — e os testes cobrem os dois lados.
 */

import {
  createObjectRawEntityStore,
  type RawObjectWriteObservation,
} from './object-raw-entity-store.js'
import { createS3RawObjectStore, type S3ClientLike, type S3CommandFactories } from './s3-object-store.js'
import { withObjectStoreRetry } from './retrying-object-store.js'
import type { R2RawStoreConfig, RawStoreConfig } from './config.js'
import type { RawEntityStore } from '../raw-sync/types.js'

/** Tentativas por operacao de objeto (1 original + 2 retries com backoff). */
const RAW_STORE_MAX_ATTEMPTS = 3

export interface ComposeRawStoreDeps {
  /** Constroi o adapter Prisma (`tmdb_raw`) — driver `postgres` (dev/teste). */
  readonly createPrismaStore: () => RawEntityStore
  /** Constroi o cliente S3 real (ou duble, em teste) a partir da config r2. */
  readonly createS3Client: (config: R2RawStoreConfig) => {
    readonly client: S3ClientLike
    readonly commands: S3CommandFactories
  }
  /** Observabilidade de escrita no store de objetos (bytes por put). */
  readonly onWrite?: (observation: RawObjectWriteObservation) => void
  /** Injetavel para teste do backoff; default: setTimeout real. */
  readonly sleep?: (ms: number) => Promise<void>
}

export interface RawStoreComposition {
  readonly store: RawEntityStore
  /** Uma linha para o log do bin. NUNCA carrega credencial/endpoint. */
  readonly description: string
}

export function composeRawEntityStore(
  config: RawStoreConfig,
  deps: ComposeRawStoreDeps,
): RawStoreComposition {
  if (config.driver === 'postgres') {
    return {
      store: deps.createPrismaStore(),
      description: 'driver=postgres (tmdb_raw via Prisma — dev/teste; recusado em producao)',
    }
  }

  const { client, commands } = deps.createS3Client(config)
  const objectStore = withObjectStoreRetry(
    createS3RawObjectStore({ bucket: config.bucket, client, commands }),
    {
      maxAttempts: RAW_STORE_MAX_ATTEMPTS,
      sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    },
  )
  return {
    store: createObjectRawEntityStore({
      objectStore,
      baseLanguage: config.baseLanguage,
      ...(deps.onWrite === undefined ? {} : { onWrite: deps.onWrite }),
    }),
    description: `driver=r2 bucket=${config.bucket} (objeto S3-compatible, retry x${RAW_STORE_MAX_ATTEMPTS})`,
  }
}
