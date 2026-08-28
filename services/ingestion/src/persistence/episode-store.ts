/**
 * episode-store.ts — Adapter Prisma das referencias de episodio (Backend A §7).
 * COBERTO por `tsconfig.runtime.json` (`pnpm typecheck` encadeia os dois).
 *
 * Resolve serie -> temporada -> episodio pela chave natural do TMDB. Se qualquer
 * elo faltar, retorna zeros: a ingestao NUNCA cria a entidade dona aqui.
 *
 * Creditos usam REPLACE-SET (deleteMany + createMany numa transacao), o que torna
 * o sync idempotente.
 *
 * O STILL nasce no estado que a licenca vigente autoriza (`MediaBirthPolicy`,
 * `../media-promotion/birth.ts`) — a mesma politica de `media-store.ts`. Ate
 * 2026-08-28 este `create` carimbava `false`/`unknown` LITERAIS, sem consultar
 * licenca nenhuma: um still de episodio nascia invisivel mesmo com a licenca de
 * imagem do TMDB `official` e `display_allowed = true` desde 21/08.
 *
 * O `update` continua JAMAIS reescrevendo essas duas colunas: reacender no ciclo
 * seguinte desfaria, em silencio, uma revogacao deliberada.
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  EpisodeReferencesInput,
  EpisodeReferencesResult,
  EpisodeStorePort,
} from '../episodes/index.js'
import type { MediaBirthPolicyReader } from './media-birth-reader.js'

/** Resultado neutro: entidade dona ausente ou nada a persistir. */
const ZERO_RESULT: EpisodeReferencesResult = {
  cast: 0,
  guestStars: 0,
  crew: 0,
  externalIds: 0,
  stills: 0,
}

/** Hash estavel e barato do still (a identidade do still e o proprio file_path). */
function stillPayloadHash(filePath: string): string {
  return `still:${filePath}`
}

/**
 * Cria um `EpisodeStorePort` apoiado no Prisma.
 *
 * `readBirthPolicy` e obrigatorio pelo mesmo motivo de `MediaStorePort`: um
 * default aqui transformaria "esqueci de fiar" em "nasce apagado", em silencio.
 */
export function createPrismaEpisodeStore(
  prisma: PrismaClient,
  readBirthPolicy: MediaBirthPolicyReader,
): EpisodeStorePort {
  return {
    async syncEpisodeReferences(input: EpisodeReferencesInput): Promise<EpisodeReferencesResult> {
      // 1. Resolucao da entidade dona (serie -> temporada -> episodio).
      const tvShow = await prisma.tvShow.findUnique({
        where: { tmdbId: input.tvShowTmdbId },
        select: { id: true },
      })
      if (tvShow === null) return ZERO_RESULT

      const season = await prisma.season.findUnique({
        where: {
          tvShowId_seasonNumber: { tvShowId: tvShow.id, seasonNumber: input.seasonNumber },
        },
        select: { id: true },
      })
      if (season === null) return ZERO_RESULT

      const episode = await prisma.episode.findUnique({
        where: {
          seasonId_episodeNumber: { seasonId: season.id, episodeNumber: input.episodeNumber },
        },
        select: { id: true, tmdbId: true },
      })
      if (episode === null) return ZERO_RESULT

      const entityId = episode.id
      // `as const`: sem isso o literal alarga para `string` e nao casa com o
      // enum EntityType que o Prisma exige em createMany.
      const entityType = 'episode' as const

      // 2. Stubs de pessoa: o credito so liga depois que a pessoa existe. `update: {}`
      // preserva o que o sync de pessoa ja enriqueceu (nao rebaixa para o stub).
      const allCredits = [...input.cast, ...input.guestStars, ...input.crew]
      const nameByTmdbId = new Map<number, string>()
      for (const credit of allCredits) {
        if (!nameByTmdbId.has(credit.personTmdbId)) {
          nameByTmdbId.set(credit.personTmdbId, credit.name)
        }
      }
      for (const [tmdbId, name] of nameByTmdbId) {
        await prisma.person.upsert({ where: { tmdbId }, create: { tmdbId, name }, update: {} })
      }

      const idByTmdbId = new Map<number, bigint>()
      if (nameByTmdbId.size > 0) {
        const people = await prisma.person.findMany({
          where: { tmdbId: { in: [...nameByTmdbId.keys()] } },
          select: { id: true, tmdbId: true },
        })
        for (const person of people) idByTmdbId.set(person.tmdbId, person.id)
      }

      // 3. Creditos (elenco + guest stars na mesma tabela, separados por is_guest).
      const toCastData = (credits: EpisodeReferencesInput['cast']) =>
        credits
          .map((credit) => {
            const personId = idByTmdbId.get(credit.personTmdbId)
            if (personId === undefined) return undefined
            return {
              personId,
              entityType,
              entityId,
              character: credit.character,
              billingOrder: credit.billingOrder,
              creditId: credit.creditId,
              isGuest: credit.isGuest,
            }
          })
          .filter((row) => row !== undefined)

      const castData = toCastData(input.cast)
      const guestStarData = toCastData(input.guestStars)
      const crewData = input.crew
        .map((credit) => {
          const personId = idByTmdbId.get(credit.personTmdbId)
          if (personId === undefined) return undefined
          return {
            personId,
            entityType,
            entityId,
            department: credit.department,
            job: credit.job,
            creditId: credit.creditId,
          }
        })
        .filter((row) => row !== undefined)

      // REPLACE-SET numa transacao: apaga o conjunto atual e regrava. `skipDuplicates`
      // e obrigatorio porque `credit_id` e unique GLOBAL — o TMDB reaproveita o mesmo
      // credit_id da serie nos creditos do episodio, e a colisao nao pode derrubar o sync.
      // Elenco e guest stars vao em createMany separados so para contar cada um sem chute.
      const operations = [
        prisma.castMember.deleteMany({ where: { entityType, entityId } }),
        prisma.crewMember.deleteMany({ where: { entityType, entityId } }),
      ]
      const writeIndex = { cast: -1, guestStars: -1, crew: -1 }
      if (castData.length > 0) {
        writeIndex.cast = operations.length
        operations.push(prisma.castMember.createMany({ data: castData, skipDuplicates: true }))
      }
      if (guestStarData.length > 0) {
        writeIndex.guestStars = operations.length
        operations.push(prisma.castMember.createMany({ data: guestStarData, skipDuplicates: true }))
      }
      if (crewData.length > 0) {
        writeIndex.crew = operations.length
        operations.push(prisma.crewMember.createMany({ data: crewData, skipDuplicates: true }))
      }
      const results = await prisma.$transaction(operations)
      const written = (index: number): number => (index < 0 ? 0 : (results[index]?.count ?? 0))

      // 4. Ids externos (imdb/tvdb): um por source, por episodio.
      let externalIds = 0
      for (const row of input.externalIds) {
        await prisma.entityExternalId.upsert({
          where: {
            entityType_entityId_source: { entityType, entityId, source: row.source },
          },
          create: { entityType, entityId, source: row.source, externalId: row.externalId },
          update: { externalId: row.externalId },
        })
        externalIds += 1
      }

      // 5. Stills. `episodes.tmdb_id` e nullable e tmdb_images e chaveada por tmdb_id:
      // sem id TMDB nao ha chave natural, entao o episodio fica sem still (nao inventa).
      let stills = 0
      const episodeTmdbId = episode.tmdbId
      if (episodeTmdbId !== null) {
        // Uma leitura de licenca por lote de stills, nao por still.
        const birth = await readBirthPolicy()
        for (const still of input.stills) {
          const metadata = {
            languageCode: still.languageCode,
            width: still.width,
            height: still.height,
            aspectRatio: still.aspectRatio,
            voteAverage: still.voteAverage,
            voteCount: still.voteCount,
            payloadHash: stillPayloadHash(still.filePath),
          }
          const nascimento = birth.forImage({ filePath: still.filePath })
          await prisma.tmdbImage.upsert({
            where: {
              entityType_tmdbId_imageType_filePath: {
                entityType,
                tmdbId: episodeTmdbId,
                imageType: 'still',
                filePath: still.filePath,
              },
            },
            create: {
              providerApi: 'tmdb',
              entityType,
              tmdbId: episodeTmdbId,
              imageType: 'still',
              filePath: still.filePath,
              ...metadata,
              // Invariante 6 continua valendo — o que mudou e QUEM responde:
              // a licenca vigente, e nao um literal.
              licenseStatus: nascimento.licenseStatus as never,
              displayAllowed: nascimento.displayAllowed,
            },
            // NUNCA toca displayAllowed/licenseStatus: reacender no update
            // desfaria uma revogacao deliberada.
            update: { ...metadata, fetchedAt: new Date() },
          })
          stills += 1
        }
      }

      return {
        cast: written(writeIndex.cast),
        guestStars: written(writeIndex.guestStars),
        crew: written(writeIndex.crew),
        externalIds,
        stills,
      }
    },
  }
}
