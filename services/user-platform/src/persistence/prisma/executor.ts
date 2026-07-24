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
 * O QUE QUEM COMPUSER (C7C) PRECISA SABER — provado em PostgreSQL real pelos
 * checks 42-53 do validador desta unidade:
 *
 *   1. Conflito esperado NAO envenena a transacao. Os adapters nunca deixam uma
 *      violacao de unicidade acontecer (usam `ON CONFLICT DO NOTHING`), entao
 *      apos um `conflict`/`already_exists` a transacao segue utilizavel: le,
 *      escreve e comita de verdade. Nao ha `catch` em nenhum deles.
 *
 *   2. A garantia acima e de READ COMMITTED — o isolamento default. Sob
 *      REPEATABLE READ ou SERIALIZABLE o proprio `INSERT` levanta `40001`
 *      (Prisma `P2034`) quando a linha conflitante foi comitada depois do
 *      snapshot, e o conflito volta a ser abortivo (check 53). Endurecer o
 *      isolamento do cadastro exige reler esta secao.
 *
 *      Isso NAO vale so para o INSERT: todo `updateMany` com PRE-CONDICAO
 *      (o CAS da senha, a revogacao de sessao, o consumo de token, a marcacao de
 *      e-mail) depende do mesmo reavaliar-na-versao-nova do READ COMMITTED. Sob
 *      REPEATABLE READ o perdedor da corrida recebe `P2034` em vez do resultado
 *      tipado — comprovado em banco real para a marcacao de e-mail.
 *
 *   3. Nao-abortivo nao e o mesmo que nao-bloqueante. `ON CONFLICT DO NOTHING`
 *      ESPERA o inseridor concorrente terminar; sob contencao isso pode estourar
 *      o timeout de transacao do Prisma (`P2028`) ou entrar em deadlock
 *      (`40P01`). Ambos abortam — e nenhum e evitavel neste nivel.
 *
 *   4. Erro que chega ao chamador e falha de verdade: os adapters falham fechado
 *      quando o estado nao tem resultado tipado possivel (unique fora do
 *      contrato, `count > 1` no CAS). Trate-os como fatais, nunca como ramo.
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
export type PrismaExecutor = Pick<
  PrismaClient,
  | "user"
  | "passwordCredential"
  | "userSession"
  | "verificationToken"
  | "authThrottle"
  // C7D: perfil, consentimento, pedidos LGPD e auditoria. Continuam sendo
  // DELEGACOES DE MODEL — nenhum membro de ciclo de vida entrou, entao a
  // garantia estrutural do topo deste arquivo (nao conecta, nao desconecta,
  // nao abre transacao) segue valendo sem depender de varredura.
  | "userProfile"
  | "consentRecord"
  | "dataRequest"
  | "authAuditLog"
>;

/**
 * Superficie da LEITURA DE EXPORTACAO (C7D), separada de proposito.
 *
 * A exportacao e o unico caminho desta unidade que precisa ler o conteudo de
 * produto do titular (listas, tracking, notas, reviews, estatisticas). Somar
 * essas delegacoes ao `PrismaExecutor` daria a TODO adapter de autenticacao
 * acesso de leitura a elas — e a menor superficie possivel e justamente o que
 * torna a garantia estrutural, e nao uma regra que alguem precisa lembrar.
 *
 * Note o que NAO esta aqui: `passwordCredential`, `userSession`,
 * `verificationToken` e `authAuditLog`. O leitor de exportacao NAO CONSEGUE, por
 * tipo, alcancar credencial, sessao, token ou auditoria — as quatro categorias
 * que `DATA_CLASSIFICATION` marca como nunca exportaveis. A exclusao deixa de
 * depender de disciplina do autor do adapter.
 */
export type PrismaExportExecutor = Pick<
  PrismaClient,
  | "user"
  | "userProfile"
  | "consentRecord"
  | "dataRequest"
  | "userList"
  | "userListItem"
  | "userWatchState"
  | "episodeProgress"
  | "viewingEvent"
  | "userRating"
  | "userReview"
  | "userStatsSnapshot"
>;
