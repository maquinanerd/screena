/**
 * HARNESS do validador C8: monta as deps REAIS de biblioteca (stores Prisma
 * sobre `prisma.$transaction`) e semeia um catalogo minimo.
 *
 * NAO e a composicao de producao — nao le env, nao chama a Brevo. Prova
 * PERSISTENCIA e ORQUESTRACAO contra Postgres real; o transporte de e-mail ja
 * tem cobertura propria.
 */

import type { PrismaClient } from "@prisma/client";

import {
  generateOpaqueToken,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from "../src/core/crypto.js";
import {
  createEntityProbe,
  createEpisodeProbe,
  createPrismaAccountLifecycleStore,
  createPrismaAuthAuditStore,
  createPrismaAuthThrottleStore,
  createPrismaAuthTokenStore,
  createPrismaCatalogReadStore,
  createPrismaConsentStore,
  createPrismaDataRequestStore,
  createPrismaEpisodeProgressStore,
  createPrismaExportReadStore,
  createPrismaIdentityStore,
  createPrismaImportJobStore,
  createPrismaPasswordCredentialStore,
  createPrismaProductContentPurgeStore,
  createPrismaSessionStore,
  createPrismaUserListItemStore,
  createPrismaUserListStore,
  createPrismaUserProfileStore,
  createPrismaUserRatingStore,
  createPrismaUserWatchStateStore,
  createPrismaViewingEventStore,
} from "../src/persistence/prisma/index.js";
import type { AuthRuntimeDeps, AuthStores, LibraryStores } from "../src/auth-runtime/deps.js";
import type { TransactionScope } from "../src/persistence/types.js";

const SCOPE: TransactionScope = { transactional: true };

const noopEmailProvider = {
  sendEmailVerification: async () => ({ providerMessageId: "noop" }),
  sendPasswordReset: async () => ({ providerMessageId: "noop" }),
};

/** Monta `AuthRuntimeDeps` completo sobre um PrismaClient real. */
export function buildLibraryDeps(prisma: PrismaClient): AuthRuntimeDeps {
  const pending: Promise<void>[] = [];
  return {
    runInTransaction: <T>(work: (scope: TransactionScope, stores: AuthStores) => Promise<T>): Promise<T> =>
      prisma.$transaction((tx) =>
        work(SCOPE, {
          identities: createPrismaIdentityStore(tx),
          credentials: createPrismaPasswordCredentialStore(tx),
          sessions: createPrismaSessionStore(tx),
          authTokens: createPrismaAuthTokenStore(tx),
          throttles: createPrismaAuthThrottleStore(tx),
          profiles: createPrismaUserProfileStore(tx),
          consents: createPrismaConsentStore(tx),
          dataRequests: createPrismaDataRequestStore(tx),
          audit: createPrismaAuthAuditStore(tx),
          accountLifecycle: createPrismaAccountLifecycleStore(tx),
          exportReader: createPrismaExportReadStore(tx),
          productContentPurge: createPrismaProductContentPurgeStore(tx),
        }),
      ),
    runInLibraryTransaction: <T>(
      work: (scope: TransactionScope, stores: LibraryStores) => Promise<T>,
    ): Promise<T> =>
      prisma.$transaction(
        (tx) => {
          const entityProbe = createEntityProbe(tx);
          const episodeProbe = createEpisodeProbe(tx);
          return work(SCOPE, {
            watchStates: createPrismaUserWatchStateStore(tx, entityProbe),
            episodeProgress: createPrismaEpisodeProgressStore(tx, episodeProbe),
            viewingEvents: createPrismaViewingEventStore(tx),
            lists: createPrismaUserListStore(tx),
            listItems: createPrismaUserListItemStore(tx, entityProbe),
            ratings: createPrismaUserRatingStore(tx, entityProbe),
            imports: createPrismaImportJobStore(tx),
            catalog: createPrismaCatalogReadStore(tx),
          });
        },
        // A serie gigante exige uma janela maior que o default de 5 s.
        { timeout: 120_000, maxWait: 20_000 },
      ),
    emailProvider: noopEmailProvider,
    scheduleDelivery: (task) => {
      pending.push(task());
    },
    publicAppUrl: new URL("https://validator.local"),
    passwordResetExpirationMinutes: 120,
    emailVerificationExpirationMinutes: 1440,
    now: () => new Date(),
    generateSecret: generateOpaqueToken,
    hashSecret: sha256Hex,
    hashPassword,
    logger: () => undefined,
    verifyPassword,
    decoyPasswordHash: hashPassword(`decoy-${generateOpaqueToken()}`),
    sessionTtlHours: 720,
    production: false,
    policyVersions: { terms_of_service: "2026-07", privacy_policy: "2026-07" },
    deletionGraceDays: 30,
  };
}

/** Cria um usuario ativo direto no banco (o cadastro completo ja tem validador). */
export async function seedUser(prisma: PrismaClient, email: string): Promise<bigint> {
  const user = await prisma.user.create({
    data: { email, emailNormalized: email.toLowerCase(), emailVerifiedAt: new Date() },
    select: { id: true },
  });
  return user.id;
}

/** Cria um filme. `entities` e mantido por TRIGGER (20260715120000). */
export async function seedMovie(
  prisma: PrismaClient,
  input: { readonly tmdbId: number; readonly title: string; readonly year: number },
): Promise<bigint> {
  const movie = await prisma.movie.create({
    data: {
      tmdbId: input.tmdbId,
      titleOriginal: input.title,
      releaseDate: new Date(Date.UTC(input.year, 0, 15)),
      runtimeMinutes: 120,
    },
    select: { id: true },
  });
  return movie.id;
}

/**
 * Cria uma serie com N temporadas x M episodios (+ especiais opcionais).
 *
 * Usa `createMany` para que semear 5 mil episodios seja viavel — semear um a um
 * tornaria o proprio validador lento demais para rodar em CI.
 */
export async function seedSeries(
  prisma: PrismaClient,
  input: {
    readonly tmdbId: number;
    readonly name: string;
    readonly seasons: number;
    readonly episodesPerSeason: number;
    readonly withSpecials?: boolean;
  },
): Promise<{ readonly tvShowId: bigint; readonly episodeIds: bigint[] }> {
  const show = await prisma.tvShow.create({
    data: { tmdbId: input.tmdbId, nameOriginal: input.name, firstAirDate: new Date("2000-01-01") },
    select: { id: true },
  });

  const numeros = input.withSpecials === true ? [0] : [];
  for (let s = 1; s <= input.seasons; s += 1) numeros.push(s);

  const episodeIds: bigint[] = [];
  for (const seasonNumber of numeros) {
    const season = await prisma.season.create({
      data: { tvShowId: show.id, seasonNumber, episodeCount: input.episodesPerSeason },
      select: { id: true },
    });
    await prisma.episode.createMany({
      data: Array.from({ length: input.episodesPerSeason }, (_, i) => ({
        seasonId: season.id,
        tvShowId: show.id,
        episodeNumber: i + 1,
        runtimeMinutes: 30,
      })),
    });
    const criados = await prisma.episode.findMany({
      where: { seasonId: season.id },
      select: { id: true },
      orderBy: { episodeNumber: "asc" },
    });
    for (const e of criados) {
      episodeIds.push(e.id);
    }
  }


  return { tvShowId: show.id, episodeIds };
}
