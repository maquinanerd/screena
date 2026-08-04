/**
 * block-id.ts — Id estavel de bloco, gerado pela maquina. PURO exceto pela
 * fonte de aleatoriedade, que e INJETADA.
 *
 * O `Block Id` era digitado a mao, obrigatorio, em todo bloco: uma materia de 15
 * blocos exigia quinze identificadores inventados por uma pessoa. A ancora
 * continua existindo — ela e o que liga comentario e correcao a um trecho entre
 * versoes — mas quem a escreve deixa de ser o jornalista.
 *
 * ESTRATEGIA: ALEATORIO, nao derivado. As duas alternativas foram descartadas
 * por violarem a exigencia de o id nao mudar quando o bloco e reordenado ou
 * editado:
 *  - indice (+hash do indice) muda em TODA reordenacao, que e exatamente a
 *    operacao mais comum na edicao de um corpo;
 *  - slug do conteudo muda quando o texto e corrigido — e colide entre dois
 *    paragrafos de texto igual, o que o contrato recusa
 *    (`editorial-contracts/src/blocks.ts:158-170`, id duplicado e erro).
 * Um valor aleatorio gerado UMA vez, na criacao do bloco, e imune as duas
 * coisas: nao depende de posicao nem de conteudo.
 *
 * FORMATO. O contrato exige `/^[A-Za-z0-9][A-Za-z0-9._:-]*$/`
 * (`editorial-contracts/src/common.ts:96-100`). Repare no PRIMEIRO caractere: o
 * corpo do id aceita `_`, `-`, `.` e `:`, mas a primeira posicao aceita SO
 * alfanumerico. O alfabeto padrao do nanoid e `A-Za-z0-9_-` e pode emitir `_`
 * ou `-` em primeira posicao — cerca de 3% dos ids seriam recusados pelo
 * contrato. Falha intermitente e a pior especie: passaria em todo teste manual e
 * derrubaria uma publicacao a cada trinta e poucos blocos.
 *
 * O prefixo `b` fixo elimina a classe inteira do problema, e ainda deixa o id
 * reconhecivel em log.
 */

/** Quantos caracteres hexadecimais compoem o sufixo. */
export const BLOCK_ID_ENTROPY = 12

/** Aceita exatamente o que o contrato aceita. */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

/**
 * Gera um id de bloco.
 *
 * `randomHex` e injetado para o teste ser deterministico e para este modulo nao
 * amarrar-se a `crypto` — o chamador no navegador passa
 * `crypto.getRandomValues`.
 */
export function generateBlockId(randomHex: (length: number) => string): string {
  return `b${randomHex(BLOCK_ID_ENTROPY)}`
}

/** O id serve? Usado para decidir se um bloco ja tem ancora ou precisa de uma. */
export function isUsableBlockId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && BLOCK_ID_PATTERN.test(value)
}

/**
 * Fonte de aleatoriedade do navegador.
 *
 * `crypto.getRandomValues` existe em todo navegador que roda o painel. Nao ha
 * fallback para `Math.random` de proposito: um fallback silencioso mascararia um
 * ambiente sem crypto e produziria ids mais fracos sem ninguem notar.
 */
export function browserRandomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2))
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}
