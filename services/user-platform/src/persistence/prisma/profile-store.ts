/**
 * profile-store.ts — adapter Prisma de `UserProfileStore` (Backend C, C7D).
 *
 * Implementa EXATAMENTE os dois metodos do port: ler o perfil publico e gravar
 * o estado completo dele.
 *
 * O port ATRAVESSA DUAS TABELAS de proposito (`users.display_name`,
 * `users.handle` + `user_profiles`), e este adapter e o unico lugar onde essa
 * juncao existe. As duas escritas acontecem no MESMO executor — que em producao
 * e o client de uma transacao interativa —, entao nao ha estado intermediario
 * observavel em que o nome tenha mudado e o perfil nao.
 *
 * ORDEM DAS ESCRITAS IMPORTA: `users` primeiro. Se `handle` colidir, a colisao
 * acontece ANTES de qualquer escrita em `user_profiles`, e o `conflict` sai sem
 * ter tocado a segunda tabela. A ordem inversa gravaria o perfil e so entao
 * descobriria que o handle e de outra pessoa.
 */

import type { UserProfileStore } from "../ports.js";
import type {
  AuthenticatedUserLookupResult,
  ProfileLookupResult,
  ProfileUpsertInput,
  ProfileUpsertResult,
  TransactionScope,
} from "../types.js";
import type { PrismaExecutor } from "./executor.js";
import { toAuthenticatedUserRecord, toProfileRecord } from "./mappers.js";

/**
 * SELECT do perfil. Deliberadamente SEM `email`: e-mail e identidade, nao
 * perfil, e devolve-lo por este caminho espalharia PII para uma tela que nao a
 * consome (a tela de conta le o e-mail pelo caminho de identidade).
 */
const USER_NAMES_SELECT = { displayName: true, handle: true } as const;

const PROFILE_SELECT = {
  bio: true,
  avatarPath: true,
  locale: true,
  countryCode: true,
  timezone: true,
  visibility: true,
  theme: true,
  density: true,
  posterSize: true,
} as const;

export function createPrismaUserProfileStore(executor: PrismaExecutor): UserProfileStore {
  return {
    async findByUserId(
      _scope: TransactionScope,
      userId: bigint,
    ): Promise<ProfileLookupResult> {
      // UMA leitura com include: `user_profiles` e 1-1 com `users`, entao o
      // driver resolve a juncao sozinho. Duas leituras separadas veriam a mesma
      // transacao e dariam o mesmo resultado, mas custariam um round-trip a mais
      // no caminho quente da tela de perfil.
      const row = await executor.user.findUnique({
        where: { id: userId },
        select: { ...USER_NAMES_SELECT, profile: { select: PROFILE_SELECT } },
      });

      if (row === null) {
        return { kind: "not_found" };
      }

      // Conta SEM linha de perfil e o estado normal de quem acabou de se
      // cadastrar (o cadastro nao cria perfil). Devolver `not_found` aqui faria
      // a tela de perfil de todo usuario novo parecer conta inexistente; o
      // mapeador aplica os DEFAULTS DA COLUNA para essa conta.
      return { kind: "found", profile: toProfileRecord(row) };
    },

    async findAuthenticatedUser(
      _scope: TransactionScope,
      userId: bigint,
    ): Promise<AuthenticatedUserLookupResult> {
      // SEM filtro de status: quem decide elegibilidade e o dominio. Uma conta
      // em `pending_deletion` PRECISA ser lida — e justamente ela que ve a tela
      // "sua conta sera encerrada em N dias".
      const row = await executor.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          handle: true,
          displayName: true,
          email: true,
          emailNormalized: true,
          emailVerifiedAt: true,
          role: true,
          status: true,
          createdAt: true,
          deletedAt: true,
          profile: { select: { locale: true, visibility: true } },
        },
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return { kind: "found", user: toAuthenticatedUserRecord(row) };
    },

    async upsert(
      _scope: TransactionScope,
      input: ProfileUpsertInput,
    ): Promise<ProfileUpsertResult> {
      // NOME PUBLICO primeiro, por `updateMany` com pre-condicao de handle livre.
      //
      // Nao e `update` simples porque `handle` tem unique e uma colisao
      // levantaria P2002 — que ABORTA a transacao interativa (regra da camada,
      // C7B1.1: conflito esperado nao pode envenenar a transacao). Aqui a
      // colisao e detectada por uma SONDA previa e o UPDATE so roda quando o
      // handle esta livre ou ja e do proprio titular.
      if (input.handle !== null) {
        const dono = await executor.user.findUnique({
          where: { handle: input.handle },
          select: { id: true },
        });
        if (dono !== null && dono.id !== input.userId) {
          return {
            kind: "conflict",
            conflict: { reason: "unique_violation", target: "identity.handle" },
          };
        }
      }

      const nomes = await executor.user.updateMany({
        where: { id: input.userId },
        data: { displayName: input.displayName, handle: input.handle },
      });

      if (nomes.count > 1) {
        // `id` e chave primaria: impossivel. Falha fechado — nao ha resultado
        // tipado que descreva "atualizei varias contas".
        throw new Error("invariante violada: mais de uma identidade para a mesma chave primaria");
      }
      if (nomes.count === 0) {
        return {
          kind: "conflict",
          conflict: { reason: "unique_violation", target: "identity.handle" },
        };
      }

      // PERFIL depois. `upsert` porque a conta pode nao ter linha ainda; o
      // `create` repete os mesmos valores do `update` — nenhum campo nasce com
      // default aqui, o estado completo vem do chamador (ver `ProfileUpsertInput`).
      const perfil = await executor.userProfile.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          bio: input.bio,
          avatarPath: input.avatarPath,
          locale: input.locale,
          countryCode: input.countryCode,
          timezone: input.timezone,
          visibility: input.visibility,
          theme: input.theme,
          density: input.density,
          posterSize: input.posterSize,
        },
        update: {
          bio: input.bio,
          avatarPath: input.avatarPath,
          locale: input.locale,
          countryCode: input.countryCode,
          timezone: input.timezone,
          visibility: input.visibility,
          theme: input.theme,
          density: input.density,
          posterSize: input.posterSize,
        },
        select: PROFILE_SELECT,
      });

      return {
        kind: "saved",
        profile: toProfileRecord({
          displayName: input.displayName,
          handle: input.handle,
          profile: perfil,
        }),
      };
    },
  };
}
