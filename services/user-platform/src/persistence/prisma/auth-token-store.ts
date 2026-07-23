/**
 * auth-token-store.ts — adapter Prisma de `AuthTokenStore` (Backend C, C7B2).
 *
 * UM adapter para verificacao de e-mail E recuperacao de senha, porque o schema
 * tem UMA tabela discriminada por um enum fechado e o dominio produz a MESMA
 * struct (`VerificationTokenRecord`) nos dois fluxos.
 *
 * O token CRU nunca chega aqui — so o hash. O adapter nao gera token, nao gera
 * hash, nao interpreta e nao compara nada em claro. `now` entra por parametro.
 */

import type { AuthTokenPurpose } from "../../core/types.js";
import type { VerificationTokenRecord } from "../../auth/types.js";
import type { AuthTokenStore } from "../ports.js";
import type {
  AuthTokenConsumeInput,
  AuthTokenConsumeResult,
  AuthTokenInvalidatePendingInput,
  AuthTokenInvalidatePendingResult,
  AuthTokenIssueResult,
  TransactionScope,
} from "../types.js";
import type { PrismaExecutor } from "./executor.js";
import { toAuthTokenPurpose } from "./mappers.js";

export function createPrismaAuthTokenStore(executor: PrismaExecutor): AuthTokenStore {
  return {
    async issue(
      _scope: TransactionScope,
      record: VerificationTokenRecord,
    ): Promise<AuthTokenIssueResult> {
      // Insercao NAO-ABORTIVA (C7B1.1): colisao do unique de `token_hash`
      // devolve zero linhas em vez de levantar P2002 e envenenar a transacao.
      //
      // NAO ha invalidacao implicita do token anterior: o schema nao tem unique
      // por (user, purpose) e `evaluateVerificationResend` autoriza emitir sem
      // olhar pendentes. Varios tokens validos ao mesmo tempo e o comportamento
      // ATUAL do dominio; queima-los aqui seria inventar politica. Para reset, a
      // queima existe e e explicita — `invalidatePending`, pedida por
      // `applyPasswordReset`.
      const criadas = await executor.verificationToken.createManyAndReturn({
        data: [
          {
            userId: record.userId,
            purpose: record.purpose,
            tokenHash: record.tokenHash,
            expiresAt: record.expiresAt,
          },
        ],
        select: { id: true },
        skipDuplicates: true,
      });

      const row = criadas[0];
      if (row !== undefined) {
        return { kind: "issued", tokenId: row.id };
      }

      // Alvo CONFIRMADO por leitura, nunca presumido: `token_hash` e a unica
      // unique da tabela alem da PK, mas afirmar sem checar repetiria o defeito
      // que o C7B1.1 corrigiu na credencial.
      const existente = await executor.verificationToken.findUnique({
        where: { tokenHash: record.tokenHash },
        select: { id: true },
      });
      if (existente === null) {
        throw new Error("insercao de token barrada por unique nao prevista pelo contrato");
      }
      return {
        kind: "conflict",
        conflict: { reason: "unique_violation", target: "authToken.tokenHash" },
      };
    },

    async consume(
      _scope: TransactionScope,
      input: AuthTokenConsumeInput,
    ): Promise<AuthTokenConsumeResult> {
      // CONSUMO ATOMICO. As quatro pre-condicoes — hash, proposito, ainda nao
      // consumido e ainda nao expirado — vivem no WHERE, avaliadas pelo banco no
      // MESMO comando que grava `consumedAt`. Ler, decidir em memoria e depois
      // gravar abriria a janela de replay em que duas tentativas concorrentes
      // leem "nao consumido" e ambas vencem.
      //
      // `gt: now` espelha `evaluateTokenConsumption`, onde `now >= expiresAt` ja
      // e expirado: no instante exato do vencimento o token nao entra.
      //
      // `purpose` e PRE-CONDICAO, nao filtro posterior: um token de verificacao
      // nunca redefine senha, e um de reset nunca verifica e-mail.
      const aplicado = await executor.verificationToken.updateMany({
        where: {
          tokenHash: input.tokenHash,
          purpose: input.purpose,
          consumedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { consumedAt: input.now },
      });

      if (aplicado.count > 1) {
        // `token_hash` e unique: impossivel. Se acontecer, o banco perdeu a
        // constraint — falhar fechado e a unica resposta honesta.
        throw new Error("invariante violada: mais de um token para a mesma chave unica");
      }

      if (aplicado.count === 1) {
        // O `userId` sai do proprio consumo: `applyEmailVerification` e
        // `applyPasswordReset` precisam saber DE QUEM era o token, e esta e a
        // unica leitura que o amarra ao passo atomico que ja venceu. Nenhuma
        // corrida pode desfazer a vitoria, entao esta leitura nao reabre janela.
        const consumido = await executor.verificationToken.findUnique({
          where: { tokenHash: input.tokenHash },
          select: { userId: true },
        });
        if (consumido === null) {
          throw new Error("invariante violada: token consumido desapareceu");
        }
        return { kind: "consumed", userId: consumido.userId };
      }

      // Zero linhas tem QUATRO causas e o dominio ja sabe nome-las
      // (`TokenConsumptionReason`). A sonda le o minimo para classificar; ela
      // nunca pode transformar corrida em sucesso, porque todo resultado dela e
      // uma recusa.
      //
      // A ordem espelha `evaluateTokenConsumption`: not_found -> wrong_purpose
      // -> already_consumed -> expired.
      const atual = await executor.verificationToken.findUnique({
        where: { tokenHash: input.tokenHash },
        select: { purpose: true, expiresAt: true, consumedAt: true },
      });
      if (atual === null) {
        return { kind: "not_found" };
      }
      if (toAuthTokenPurpose(atual.purpose) !== input.purpose) {
        return { kind: "wrong_purpose" };
      }
      if (atual.consumedAt !== null) {
        return { kind: "already_consumed" };
      }
      return { kind: "expired" };
    },

    async invalidatePending(
      _scope: TransactionScope,
      input: AuthTokenInvalidatePendingInput,
    ): Promise<AuthTokenInvalidatePendingResult> {
      // Queima os pendentes marcando `consumedAt` — nao apaga linha, para nao
      // perder o historico de auditoria. `consumedAt: null` na pre-condicao
      // preserva o carimbo de quem ja tinha sido consumido de verdade.
      const aplicado = await executor.verificationToken.updateMany({
        where: { userId: input.userId, purpose: input.purpose, consumedAt: null },
        data: { consumedAt: input.now },
      });
      return { invalidatedCount: aplicado.count };
    },
  };
}

/** Reexportado para os testes nomearem o proposito sem importar o enum do Prisma. */
export type { AuthTokenPurpose };
