/**
 * identity-conflict.ts — de que UNIQUE veio o conflito, sem olhar o erro do
 * driver (Backend C, C7B1.1).
 *
 * Ate C7B1 o alvo semantico era extraido de `meta.target` do P2002. Isso exigia
 * DEIXAR a violacao acontecer — e uma violacao de constraint aborta a transacao
 * do Postgres mesmo quando o adapter captura a excecao. A insercao passou a ser
 * `ON CONFLICT DO NOTHING`, que nao levanta erro nenhum; em troca, ela tambem
 * nao diz QUAL unique barrou. Este modulo recupera essa informacao por LEITURA.
 *
 * A troca e favoravel: o RESULTADO (criou / nao criou) continua decidido
 * atomicamente pelo banco — nunca por leitura. As leituras aqui so rotulam um
 * conflito que ja aconteceu, e por isso nao introduzem corrida no controle de
 * fluxo. No pior caso o rotulo sai ausente, e `target` e opcional no contrato.
 */

import type { UniqueConflictTarget } from "../types.js";
import type { PrismaExecutor } from "./executor.js";

/** Somente existencia. Nenhuma coluna de PII atravessa esta leitura. */
const EXISTS_SELECT = { id: true } as const;

/**
 * Descobre qual unique de `users` barrou a insercao.
 *
 * ORDEM E SEMANTICA, NAO ESTILO. Quando as DUAS colunas colidem — o caso comum,
 * porque o mesmo endereco costuma repetir bruto e normalizado — o rotulo
 * devolvido e `identity.emailNormalized`: e a chave de identidade da conta (a
 * que fecha o canal de enumeracao e a que `decideSignup` consulta). Dizer
 * `identity.email` ali descreveria o acidente (a grafia) em vez do fato (a conta
 * ja existe).
 *
 * `identity.handle` NAO e investigado: este adapter nunca escreve `handle`, a
 * coluna nasce NULL e o indice unico trata NULLs como distintos — logo esse alvo
 * e estruturalmente inalcancavel por aqui. Ele permanece na uniao para os
 * adapters que vierem, nao para este.
 *
 * `undefined` quando nenhuma das duas leituras encontra a linha. Sob READ
 * COMMITTED — o isolamento em que esta camada opera — isso NAO significa "a
 * vencedora ainda nao esta visivel": o `INSERT` so retorna depois que o
 * inseridor concorrente termina, e o statement seguinte enxerga o que ele
 * comitou. Significa que a colisao veio de uma unique que NAO e de e-mail (na
 * pratica, a chave primaria, com a sequence dessincronizada apos um restore).
 *
 * Quem chama trata esse `undefined` como estado sem resultado tipado possivel e
 * falha fechado — devolver `unique_violation` ali diria ao usuario que o e-mail
 * dele esta tomado quando esta livre.
 */
export async function classifyIdentityConflict(
  executor: PrismaExecutor,
  input: { readonly email: string; readonly emailNormalized: string },
): Promise<UniqueConflictTarget | undefined> {
  const porNormalizado = await executor.user.findUnique({
    where: { emailNormalized: input.emailNormalized },
    select: EXISTS_SELECT,
  });
  if (porNormalizado !== null) {
    return "identity.emailNormalized";
  }

  const porBruto = await executor.user.findUnique({
    where: { email: input.email },
    select: EXISTS_SELECT,
  });
  if (porBruto !== null) {
    return "identity.email";
  }

  return undefined;
}
