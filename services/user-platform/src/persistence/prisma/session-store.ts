/**
 * session-store.ts — adapter Prisma de `SessionStore` (Backend C, C7B2).
 *
 * O token CRU nunca chega aqui: o dominio ja o transformou em `tokenHash` e
 * `csrfTokenHash` (`buildSessionRecord`). Este adapter grava hashes, le por
 * hash e revoga por id — nao gera token, nao gera hash, nao interpreta nada.
 *
 * TEMPO ENTRA POR PARAMETRO. Nenhuma chamada de relogio aqui dentro: `now` vem
 * de quem compoe, igual ao resto do dominio. Isso mantem o teste deterministico
 * e impede uma segunda fonte de "agora" divergindo da politica pura.
 */

import type { SessionRecord } from "../../auth/types.js";
import type { SessionStore } from "../ports.js";
import type {
  SessionCreateResult,
  SessionListActiveInput,
  SessionLookupResult,
  SessionRevokeInput,
  SessionRevokeResult,
  TransactionScope,
} from "../types.js";
import type { PrismaExecutor } from "./executor.js";
import { toSessionAccessRecord } from "./mappers.js";

/** Forma persistivel de `ip_hash` (a coluna NAO tem CHECK no banco). */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * SELECT MINIMO do lookup: exatamente o que `evaluateSessionAccess` consome
 * (`expiresAt`, `revokedAt`), mais `id` (revogacao por id), `userId` (buscar o
 * status da conta) e `csrfTokenHash` (double submit da borda de mutacao).
 *
 * `tokenHash` continua de fora: a busca e POR ele, entao quem consultou ja o
 * tem e devolve-lo so ampliaria a superficie do segredo. `csrfTokenHash` e
 * outro caso — e um segredo DIFERENTE, apresentado em outro canal, que o
 * chamador nao tem como derivar do token de sessao (ver `SessionAccessRecord`).
 */
const SESSION_ACCESS_SELECT = {
  id: true,
  userId: true,
  expiresAt: true,
  revokedAt: true,
  csrfTokenHash: true,
} as const;

export function createPrismaSessionStore(executor: PrismaExecutor): SessionStore {
  return {
    async create(_scope: TransactionScope, record: SessionRecord): Promise<SessionCreateResult> {
      // IP CRU NAO PASSA. O dominio ja barra isso em `buildSessionRecord`, mas
      // `SessionRecord.ipHash` e `string | null` — o tipo nao carrega garantia
      // nenhuma, e a coluna `ip_hash` NAO tem CHECK no banco. Esta e a ultima
      // linha antes do disco: uma composicao que montasse o record a mao gravaria
      // PII em claro em silencio. Falha fechado, sem o valor na mensagem.
      if (record.ipHash !== null && !SHA256_HEX.test(record.ipHash)) {
        throw new Error("origem da sessao fora da forma esperada (sha256 hex ou nulo)");
      }

      // Insercao NAO-ABORTIVA (regra herdada de C7B1.1): `ON CONFLICT DO NOTHING`
      // em vez de deixar a unique de `token_hash` levantar P2002, que deixaria a
      // transacao envenenada.
      const criadas = await executor.userSession.createManyAndReturn({
        data: [
          {
            userId: record.userId,
            tokenHash: record.tokenHash,
            csrfTokenHash: record.csrfTokenHash,
            expiresAt: record.expiresAt,
            rotatedFromId: record.rotatedFromSessionId,
            ipHash: record.ipHash,
            userAgent: record.userAgent,
          },
        ],
        select: { id: true },
        skipDuplicates: true,
      });

      const row = criadas[0];
      if (row !== undefined) {
        return { kind: "created", sessionId: row.id };
      }

      // Zero linhas = alguma unique barrou. O alvo e CONFIRMADO por leitura,
      // nunca presumido: a tabela tem DUAS uniques (`token_hash` e
      // `rotated_from_id`), alem da PK. Afirmar `session.tokenHash` sem checar
      // diria ao chamador que houve colisao de token quando pode ter sido uma
      // corrente de rotacao ja usada — causa diferente, correcao diferente.
      const porTokenHash = await executor.userSession.findUnique({
        where: { tokenHash: record.tokenHash },
        select: { id: true },
      });
      if (porTokenHash !== null) {
        return {
          kind: "conflict",
          conflict: { reason: "unique_violation", target: "session.tokenHash" },
        };
      }

      // `rotated_from_id` e unique: a sessao de origem ja foi rotacionada. Duplo
      // clique, aba paralela e retry produzem exatamente isso — e o contrato
      // representa o caso, entao ele nao pode virar excecao.
      if (record.rotatedFromSessionId !== null) {
        const porRotacao = await executor.userSession.findUnique({
          where: { rotatedFromId: record.rotatedFromSessionId },
          select: { id: true },
        });
        if (porRotacao !== null) {
          return {
            kind: "conflict",
            conflict: { reason: "unique_violation", target: "session.rotatedFrom" },
          };
        }
      }

      throw new Error("insercao de sessao barrada por unique nao prevista pelo contrato");
    },

    async findByTokenHash(
      _scope: TransactionScope,
      tokenHash: string,
    ): Promise<SessionLookupResult> {
      // SEM filtro de vigencia. `evaluateSessionAccess` compara `now` com
      // `expiresAt` e olha `revokedAt` para separar expirada de revogada — e o
      // motivo interno alimenta auditoria. Filtrar aqui duplicaria a politica e
      // devolveria `not_found` para uma sessao que existe.
      const row = await executor.userSession.findUnique({
        where: { tokenHash },
        select: SESSION_ACCESS_SELECT,
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return { kind: "found", session: toSessionAccessRecord(row) };
    },

    async revoke(
      _scope: TransactionScope,
      input: SessionRevokeInput,
    ): Promise<SessionRevokeResult> {
      if (input.sessionIds.length === 0) {
        return { revokedCount: 0 };
      }
      // `revokedAt: null` na pre-condicao torna a operacao IDEMPOTENTE e
      // atomica: revogar de novo nao reescreve o carimbo original nem conta como
      // mudanca. `updateMany` (nao `update`) e o unico que aceita pre-condicao
      // alem da chave — e, ao contrario de SQL cru, honra o `@updatedAt`.
      const aplicado = await executor.userSession.updateMany({
        where: { id: { in: [...input.sessionIds] }, revokedAt: null },
        data: { revokedAt: input.now },
      });
      return { revokedCount: aplicado.count };
    },

    async listActiveIds(
      _scope: TransactionScope,
      input: SessionListActiveInput,
    ): Promise<readonly bigint[]> {
      // "Ativa" = nao revogada E ainda nao expirada em `now`. O criterio e
      // temporal, e `now` vem por parametro justamente para nao existir um
      // segundo relogio aqui dentro.
      //
      // `gt` (nao `gte`) espelha `evaluateSessionAccess`, onde
      // `now >= expiresAt` JA e expirado: no instante exato do vencimento a
      // sessao nao e mais ativa em nenhuma das duas camadas.
      const rows = await executor.userSession.findMany({
        where: { userId: input.userId, revokedAt: null, expiresAt: { gt: input.now } },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      return rows.map((row) => row.id);
    },
  };
}
