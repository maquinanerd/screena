/**
 * auth-throttle-store.ts — adapter Prisma de `AuthThrottleStore` (Backend C, C7C).
 *
 * Le e grava a contagem de tentativas de `user_auth_throttles`. NAO decide nada:
 * a janela deslizante e o lockout sao `evaluateThrottle`/`registerFailure`
 * (auth/policy.ts), com o `now` injetado. Este arquivo nao chama relogio.
 *
 * A chave (`key`) chega PRONTA do chamador. Para o escopo `ip` ela ja e um hash
 * — o IP em texto claro nunca alcanca esta camada, como a propria coluna
 * documenta no schema.
 *
 * REGRA DA CAMADA (C7B1.1): conflito esperado NAO envenena a transacao. A
 * insercao usa `ON CONFLICT DO NOTHING` e a atualizacao usa `updateMany` com
 * pre-imagem — nenhuma das duas levanta excecao no caminho previsto, e nao ha
 * `catch` neste arquivo.
 */

import type { AuthThrottleStore } from "../ports.js";
import type {
  AuthThrottleKey,
  AuthThrottleReadResult,
  AuthThrottleSaveInput,
  AuthThrottleSaveResult,
  TransactionScope,
} from "../types.js";
import type { PrismaExecutor } from "./executor.js";
import { toAuthThrottleState } from "./mappers.js";

/**
 * SELECT MINIMO: exatamente as tres colunas que `evaluateThrottle` consome.
 * `id`, `createdAt` e `updatedAt` ficam de fora — nenhum consumidor os le, e a
 * chave (`scope`/`key`) quem consultou ja tem.
 */
const THROTTLE_SELECT = {
  failureCount: true,
  windowStartedAt: true,
  lockedUntil: true,
} as const;

/** Conflito de pre-imagem desta tabela. Constante unica para nao divergir. */
const WINDOW_CONFLICT: AuthThrottleSaveResult = {
  kind: "conflict",
  conflict: { reason: "stale_preimage", target: "authThrottle.window" },
};

export function createPrismaAuthThrottleStore(executor: PrismaExecutor): AuthThrottleStore {
  return {
    async read(
      _scope: TransactionScope,
      input: AuthThrottleKey,
    ): Promise<AuthThrottleReadResult> {
      // SEM filtro de vigencia. Uma janela ja vencida ou um lockout ja expirado
      // continuam sendo LINHAS existentes; quem os considera limpos e
      // `evaluateThrottle`, comparando com o `now` injetado. Filtrar aqui criaria
      // uma segunda definicao de "janela aberta", divergente da politica pura.
      const row = await executor.authThrottle.findUnique({
        where: { scope_key: { scope: input.scope, key: input.key } },
        select: THROTTLE_SELECT,
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return { kind: "found", state: toAuthThrottleState(row) };
    },

    async save(
      _scope: TransactionScope,
      input: AuthThrottleSaveInput,
    ): Promise<AuthThrottleSaveResult> {
      if (input.expected === null) {
        // A leitura nao achou linha. Insercao NAO-ABORTIVA: se outro pedido
        // criou a linha nesse meio-tempo, o unique `(scope, key)` devolve ZERO
        // linhas em vez de levantar P2002 e envenenar a transacao. Zero linhas
        // aqui e conflito de pre-imagem — a pre-imagem era "nao existe", e agora
        // existe.
        const criadas = await executor.authThrottle.createManyAndReturn({
          data: [
            {
              scope: input.scope,
              key: input.key,
              failureCount: input.next.failureCount,
              windowStartedAt: input.next.windowStartedAt,
              lockedUntil: input.next.lockedUntil,
            },
          ],
          select: { id: true },
          skipDuplicates: true,
        });
        return criadas.length === 1 ? { kind: "saved" } : WINDOW_CONFLICT;
      }

      // COMPARE-AND-SWAP. As tres colunas de estado entram no WHERE, nao numa
      // comparacao em memoria: ler-comparar-gravar deixaria duas tentativas
      // concorrentes lerem a mesma contagem e a segunda sobrescreveria a
      // primeira, tornando o limite efetivo maior do que a politica declara.
      //
      // `updateMany` (nao `update`) porque so ele aceita pre-condicao alem da
      // chave; e, ao contrario de SQL cru, honra o `@updatedAt` do modelo.
      const aplicado = await executor.authThrottle.updateMany({
        where: {
          scope: input.scope,
          key: input.key,
          failureCount: input.expected.failureCount,
          windowStartedAt: input.expected.windowStartedAt,
          lockedUntil: input.expected.lockedUntil,
        },
        data: {
          failureCount: input.next.failureCount,
          windowStartedAt: input.next.windowStartedAt,
          lockedUntil: input.next.lockedUntil,
        },
      });

      if (aplicado.count > 1) {
        // `(scope, key)` e unique: mais de uma linha e impossivel. Se acontecer,
        // o banco perdeu a constraint — falhar fechado e a unica resposta
        // honesta. A mensagem nao carrega a chave nem o escopo.
        throw new Error("invariante violada: mais de uma contagem para a mesma chave unica");
      }

      return aplicado.count === 1 ? { kind: "saved" } : WINDOW_CONFLICT;
    },
  };
}
