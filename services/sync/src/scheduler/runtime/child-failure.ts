/**
 * child-failure.ts — o motivo REAL de um processo filho ter falhado.
 *
 * O DEFEITO QUE ISTO FECHA (medido em producao, 2026-08-25 01:24 UTC)
 * ---------------------------------------------------------------------------
 * O agendador roda quatro filas por processo filho (`sync-omdb-ratings`,
 * `promote-omdb-awards`, `compute-cinerie-score`, `catalog search-reindex`).
 * `runScript` CAPTURA o `stderr` do filho — e os quatro chamadores o
 * DESCARTAVAM, montando um detalhe que so repetia o codigo de saida:
 *
 *     detail: `compute-cinerie-score saiu com codigo ${result.code}`
 *
 * Pior: `describeRun` monta a linha de log com `codigoxN` e NUNCA imprime o
 * `detail`. Ou seja, o diagnostico era jogado fora duas vezes. O que o operador
 * via em producao, a cada tique, era isto e nada mais:
 *
 *     cinerie_score: FALHOU (0 de 1) · 917ms · cota: nenhuma · motivos: score_child_failedx1
 *
 * Uma fila que falha ha dias sem dizer por que nao e observabilidade: e um
 * alarme sem mensagem. O erro estava na memoria do processo o tempo todo.
 *
 * REDACAO NAO E OPCIONAL
 * ---------------------------------------------------------------------------
 * O `stderr` de um filho que fala com o banco costuma trazer a string de
 * conexao inteira (o Prisma imprime a URL em varios erros), e um filho que fala
 * com API externa pode trazer token em cabecalho. Publicar `stderr` cru no log
 * seria trocar um silencio por um vazamento. Tudo passa por `redactSecrets`
 * ANTES de virar texto de log.
 *
 * MODULO PURO: sem rede, banco, IO, Date nem Math.random.
 */

/** Teto do trecho de `stderr` que entra no detalhe. */
export const CHILD_STDERR_MAX = 400

/**
 * Padroes que NUNCA podem sair no log. Cada um vira `<REDACTED>`.
 *
 * Deliberadamente largo: falso positivo aqui custa uma palavra mascarada num
 * diagnostico; falso negativo custa um segredo em log de producao.
 */
const SEGREDOS: readonly RegExp[] = [
  // URL com credencial embutida: postgres://user:senha@host, redis://, amqp://...
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi,
  // atribuicao de chave/segredo/token/senha em qualquer formato comum
  /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|SALT|CREDENTIAL)[A-Za-z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi,
  // cabecalho Authorization / Bearer.
  //
  // O `(?:bearer\s+)?` no meio nao e decoracao: sem ele,
  // `authorization: Bearer abc.def` casava so ate a palavra "Bearer" e o TOKEN
  // sobrava no texto. Foi assim que o primeiro teste desta suite reprovou.
  /\b(authorization|proxy-authorization|bearer)\b\s*[:=]?\s*(?:bearer\s+)?\S+/gi,
]

/**
 * Mascara segredos num texto livre. Idempotente: aplicar duas vezes nao muda
 * nada alem do que a primeira ja mascarou.
 */
export function redactSecrets(text: string): string {
  let out = text
  // 1) URL com credencial: preserva o esquema para o diagnostico continuar util.
  out = out.replace(SEGREDOS[0]!, (m) => `${m.slice(0, m.indexOf('://') + 3)}<REDACTED>@`)
  // 2) atribuicoes nomeadas: preserva o NOME da variavel, mascara o valor.
  out = out.replace(SEGREDOS[1]!, (_m, nome: string) => `${nome}=<REDACTED>`)
  // 3) Authorization / Bearer.
  out = out.replace(SEGREDOS[2]!, (_m, rotulo: string) => `${rotulo} <REDACTED>`)
  return out
}

/**
 * Reduz o `stderr` do filho ao que cabe num log: colapsa espaco, tira ruido de
 * pilha e fica com o FIM (onde costuma estar a mensagem que interessa, depois
 * do preambulo do runner).
 */
export function tailOfStderr(stderr: string, max: number = CHILD_STDERR_MAX): string {
  const limpo = redactSecrets(stderr)
    .split(/\r?\n/)
    // Linha de pilha (`    at foo (...)`) raramente diz mais que a mensagem.
    .filter((l) => !/^\s*at\s+\S+/.test(l))
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(' | ')
  if (limpo.length <= max) return limpo
  // Corta pelo FIM: a causa costuma estar na ultima mensagem, nao na primeira.
  return `...${limpo.slice(limpo.length - max)}`
}

/**
 * O `detail` de uma falha de processo filho: o que saiu, com que codigo, e
 * POR QUE — nesta ordem.
 *
 * Quando o filho nao escreveu nada em `stderr`, diz isso explicitamente em vez
 * de silenciar: "sem stderr" e um fato diagnostico (aponta para crash sem
 * mensagem, OOM ou sinal), nao um vazio.
 */
export function describeChildFailure(
  script: string,
  code: number | null,
  stderr: string,
): string {
  const causa = tailOfStderr(stderr)
  const saida = code === null ? 'sem codigo (morto por sinal ou nao iniciado)' : `codigo ${String(code)}`
  return causa.length === 0
    ? `${script} saiu com ${saida}; o processo nao escreveu nada em stderr`
    : `${script} saiu com ${saida}: ${causa}`
}
