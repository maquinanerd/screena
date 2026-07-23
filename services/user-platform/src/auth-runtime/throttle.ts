/**
 * Aplicacao do THROTTLE duravel aos pedidos que disparam e-mail (C7C).
 *
 * A POLITICA nao esta aqui: janela deslizante, teto por escopo e lockout sao
 * `evaluateThrottle`/`registerFailure` (auth/policy.ts), puros e ja testados.
 * Este modulo faz a costura — ler o estado pelo port, deixar o dominio decidir,
 * gravar o proximo estado por compare-and-swap.
 *
 * DIFERENCA DE SEMANTICA, registrada de proposito: no login, `registerFailure`
 * conta FALHAS. Aqui ele conta PEDIDOS — cada solicitacao de e-mail consome uma
 * unidade do orcamento, tenha ela resultado em envio ou nao. Se so contasse
 * "falhas", pedir mil vezes o reset de uma conta que existe sairia de graca, que
 * e exatamente o abuso a evitar. Contar sempre tambem preserva a
 * anti-enumeracao: o orcamento e o mesmo para e-mail existente e inexistente.
 *
 * NAMESPACE DA CHAVE: `user_auth_throttles` tem `@@unique([scope, key])` e
 * nenhuma coluna de finalidade. Sem prefixo, o orcamento do reset e o do reenvio
 * de verificacao (e, no futuro, o do login) disputariam a MESMA linha, e um
 * bloqueio num fluxo derrubaria os outros. O prefixo separa os orcamentos sem
 * migration.
 */

import { evaluateThrottle, registerFailure } from "../auth/policy.js";
import type { ThrottleScope } from "../core/types.js";
import type { AuthThrottleStore } from "../persistence/ports.js";
import type { AuthThrottleState, TransactionScope } from "../persistence/types.js";
import type { AuthEmailPurpose } from "./observability.js";

/**
 * Separador do namespace. ASCII visivel, deliberadamente: chaves compostas com
 * byte de controle ja apareceram tres vezes neste repositorio e sobrevivem
 * invisiveis no editor e no diff (ver tests/governance/no-raw-control-bytes).
 */
export const AUTH_THROTTLE_KEY_SEPARATOR = ":";

/** Chave de orcamento por FINALIDADE + identificador. */
export function buildAuthThrottleKey(purpose: AuthEmailPurpose, identifier: string): string {
  return `${purpose}${AUTH_THROTTLE_KEY_SEPARATOR}${identifier}`;
}

export interface AuthThrottleDecision {
  readonly locked: boolean;
}

/**
 * Tentativas do compare-and-swap antes de desistir.
 *
 * Sob contencao, o perdedor do CAS PRECISA reler e tentar de novo — senao a
 * contagem dele simplesmente some. Com K pedidos simultaneos e nenhuma
 * retentativa, K-1 incrementos seriam descartados e o limite efetivo viraria
 * "quantos pedidos couberem numa mesma janela de concorrencia", nao os 5 que a
 * politica declara.
 */
const MAX_CAS_ATTEMPTS = 4;

/**
 * Consome uma unidade do orcamento da chave.
 *
 * Devolve `locked: true` quando ja havia bloqueio ativo — e nesse caso NAO conta
 * de novo: contar durante o bloqueio estenderia a punicao a cada tentativa e
 * transformaria um limite de 15 minutos em bloqueio permanente para quem
 * recarrega a pagina.
 *
 * O compare-and-swap e RETENTADO com releitura. Se, apos `MAX_CAS_ATTEMPTS`, a
 * linha continuar mudando debaixo de nos, o resultado e `locked: true` —
 * FAIL-CLOSED. Contencao sustentada nesta chave e, por si so, o sinal de abuso
 * que o limitador existe para conter; devolver `locked: false` ali seria
 * transformar a corrida numa forma de burlar o limite.
 */
export async function consumeAuthThrottleBudget(input: {
  readonly throttles: AuthThrottleStore;
  readonly scope: TransactionScope;
  readonly throttleScope: ThrottleScope;
  readonly key: string;
  readonly now: Date;
}): Promise<AuthThrottleDecision> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const read = await input.throttles.read(input.scope, {
      scope: input.throttleScope,
      key: input.key,
    });
    const current: AuthThrottleState | null = read.kind === "found" ? read.state : null;

    const evaluation = evaluateThrottle(current, input.throttleScope, input.now);
    if (evaluation.locked) {
      return { locked: true };
    }

    const next = registerFailure(current, input.throttleScope, input.now);

    // Copia CAMPO A CAMPO: `registerFailure` devolve tambem `previousLockouts`,
    // que nao tem coluna em `user_auth_throttles`. Passar o objeto inteiro faria
    // o adapter receber um campo que ele nao pode gravar; copiar o que existe
    // deixa a lacuna visivel aqui, onde ela esta documentada, em vez de
    // escondida.
    const saved = await input.throttles.save(input.scope, {
      scope: input.throttleScope,
      key: input.key,
      expected: current,
      next: {
        failureCount: next.failureCount,
        windowStartedAt: next.windowStartedAt,
        lockedUntil: next.lockedUntil,
      },
    });

    if (saved.kind === "saved") {
      return { locked: false };
    }
    // `conflict`: outro pedido gravou entre a leitura e a escrita. Reler e
    // recontar sobre o estado NOVO — nunca ignorar, que era o defeito.
  }

  return { locked: true };
}

/**
 * Aplica os DOIS escopos de um pedido: a chave apresentada (e-mail normalizado)
 * e a origem (hash de IP, quando conhecida).
 *
 * Os dois sao consumidos SEMPRE, mesmo quando o primeiro ja travou — senao um
 * atacante que estourasse o orcamento de um e-mail passaria a atacar outros
 * e-mails de graca a partir do mesmo IP, porque o contador de origem nunca teria
 * avancado.
 *
 * A origem desconhecida (`clientIpHash = null`) simplesmente nao consome o
 * escopo de IP; o escopo de e-mail continua valendo. Recusar o pedido inteiro
 * por falta de IP puniria quem esta atras de um proxy que nao propaga a origem.
 */
export async function consumeAuthRequestBudget(input: {
  readonly throttles: AuthThrottleStore;
  readonly scope: TransactionScope;
  readonly purpose: AuthEmailPurpose;
  readonly emailNormalized: string;
  readonly clientIpHash: string | null;
  readonly now: Date;
}): Promise<AuthThrottleDecision> {
  const byEmail = await consumeAuthThrottleBudget({
    throttles: input.throttles,
    scope: input.scope,
    throttleScope: "email",
    key: buildAuthThrottleKey(input.purpose, input.emailNormalized),
    now: input.now,
  });

  let byOrigin: AuthThrottleDecision = { locked: false };
  if (input.clientIpHash !== null) {
    byOrigin = await consumeAuthThrottleBudget({
      throttles: input.throttles,
      scope: input.scope,
      throttleScope: "ip",
      key: buildAuthThrottleKey(input.purpose, input.clientIpHash),
      now: input.now,
    });
  }

  return { locked: byEmail.locked || byOrigin.locked };
}
