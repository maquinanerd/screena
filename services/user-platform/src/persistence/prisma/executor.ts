/**
 * executor.ts — EXECUTOR Prisma injetado nos adapters (Backend C, C7B1).
 *
 * O adapter NUNCA constroi seu proprio client: recebe um executor pronto. Isso
 * permite que a composicao futura (C7C) rode identidade e credencial na MESMA
 * transacao de cadastro sem que os adapters saibam que uma transacao existe:
 *
 *   prisma.$transaction(async (tx) => {
 *     const identities  = createPrismaIdentityStore(tx);
 *     const credentials = createPrismaPasswordCredentialStore(tx);
 *   });
 *
 * A garantia de "nao conecta, nao desconecta, nao abre transacao" e ESTRUTURAL,
 * nao apenas uma regra de varredura: `PrismaExecutor` e um `Pick` das DUAS
 * delegacoes usadas. `$connect`, `$disconnect`, `$transaction` e todos os
 * demais models simplesmente NAO EXISTEM no tipo — chama-los nao compila. Uma
 * guarda de regex pode ser contornada por indirecao; um tipo que nao tem o
 * membro, nao.
 *
 * PRE-CONDICAO CRITICA PARA QUEM COMPUSER (C7C) — nao e teoria, esta provada em
 * PostgreSQL real pelos checks 39 e 40 do validador desta unidade:
 *
 *   Um CONFLITO capturado por estes adapters (P2002/P2003 virando
 *   `conflict`/`already_exists`/`user_not_found`) deixa a transacao do Postgres
 *   ABORTADA. O Prisma nao emite SAVEPOINT por statement, entao o erro do banco
 *   nao e "desfeito" so porque o adapter o converteu em valor. A partir dali:
 *     - a proxima chamada no MESMO escopo lanca `25P02` cru, em vez de devolver
 *       resultado de contrato;
 *     - se o callback simplesmente retornar, o COMMIT vira ROLLBACK e as
 *       escritas anteriores bem-sucedidas somem SEM erro.
 *
 *   Consequencia pratica: dentro de transacao, um conflito e TERMINAL. Quem
 *   compoe deve encerrar o escopo ao receber conflito (propagando-o para fora),
 *   ou isolar a tentativa num savepoint proprio — o adapter nao pode faze-lo,
 *   porque o executor deliberadamente nao expoe `$executeRaw`.
 *
 *   Isso NAO e defeito destes adapters (isolados, eles honram o contrato); e uma
 *   propriedade do Postgres que a composicao precisa conhecer antes de existir.
 */

import type { PrismaClient } from "@screena/db/server";

/**
 * MENOR superficie que os adapters de C7B1 precisam: duas delegacoes, nada mais.
 *
 * Satisfeito estruturalmente tanto pelo `PrismaClient` completo quanto pelo
 * client de transacao interativa — o Prisma define este ultimo como
 * `Omit<PrismaClient, ITXClientDenyList>`, e a lista negada contem apenas os
 * membros de CICLO DE VIDA (conectar, desconectar, abrir transacao, estender).
 * As delegacoes de model sobrevivem intactas ao `Omit`, entao um `Pick` das duas
 * que usamos e satisfeito pelos dois — e a composicao escolhe o escopo sem que o
 * adapter mude uma linha.
 *
 * Derivar o tipo do proprio `PrismaClient` (em vez de reescrever as assinaturas
 * a mao) faz de uma mudanca de versao do driver um erro de typecheck, nao uma
 * divergencia silenciosa.
 */
export type PrismaExecutor = Pick<PrismaClient, "user" | "passwordCredential">;
