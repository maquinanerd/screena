/**
 * source-text.ts — A UNICA porta pela qual um guard le codigo-fonte.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE MODULO EXISTE PARA TORNAR IMPOSSIVEL
 * ============================================================================
 * Um guard textual le o arquivo com `readFileSync(p, 'utf8')` e procura um
 * literal. O arquivo contem um COMENTARIO que explica a regra e cita o literal.
 * O guard casa com a explicacao, fica verde, e certifica exatamente o defeito
 * que existia para impedir.
 *
 * Aconteceu quatro vezes. Foi consertado uma a uma, o que e conserto de
 * INSTANCIA, nao de PADRAO: enquanto `readFileSync` continuar sendo a forma
 * natural de escrever um guard, o quinto sai errado do mesmo jeito.
 *
 * Por isso a porta padrao — `readSourceWithoutComments` — ja entrega o arquivo
 * SEM comentarios. Escrever o guard do jeito certo passa a ser o caminho mais
 * curto, e `tests/governance/guard-source-reading.test.ts` recusa quem ler
 * fonte por fora daqui.
 *
 * ============================================================================
 * O QUE ESTE MODULO NAO FAZ, E POR QUE IMPORTA
 * ============================================================================
 * NAO toca em STRING. Um `//` dentro de uma URL nao e comentario, e um
 * removedor ingenuo transformaria a URL em lixo — quebrando em silencio todo
 * guard que procura host, rota ou endereco. O scanner abaixo conhece aspas
 * simples, duplas, template literal e escape.
 *
 * NAO inventa comentario onde a linguagem nao tem. Em `.md` e `.json` o
 * conteudo volta CRU: uma barra dupla de URL em markdown seria devorada por uma
 * regra de `.ts`. A linguagem sai da extensao, e extensao desconhecida nao e
 * adivinhada — cai em `none`, que preserva tudo.
 *
 * PRESERVA AS POSICOES. Comentario vira ESPACO, nao vazio: linha e coluna de
 * qualquer casamento continuam valendo para a mensagem de erro, e a quebra de
 * linha e mantida para que a contagem de linhas nao mude.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** A raiz do repositorio, para os guards resolverem caminho relativo. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * As familias de comentario que conhecemos.
 *
 * `none` e uma AFIRMACAO, nao uma lacuna: markdown e JSON nao tem comentario, e
 * fingir que tem corromperia URL e conteudo.
 */
export type CommentSyntax = 'c-like' | 'sql' | 'hash' | 'none'

const SYNTAX_BY_EXTENSION: Readonly<Record<string, CommentSyntax>> = {
  '.ts': 'c-like',
  '.tsx': 'c-like',
  '.js': 'c-like',
  '.jsx': 'c-like',
  '.mjs': 'c-like',
  '.cjs': 'c-like',
  '.css': 'c-like',
  '.scss': 'c-like',
  '.sql': 'sql',
  '.yml': 'hash',
  '.yaml': 'hash',
  '.md': 'none',
  '.mdx': 'none',
  '.json': 'none',
  '.txt': 'none',
  '.html': 'none',
}

/** A sintaxe de comentario de um arquivo, pela extensao. */
export function commentSyntaxFor(filePath: string): CommentSyntax {
  return SYNTAX_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'none'
}

/** Troca o trecho por espacos, mantendo as quebras de linha (posicao preservada). */
function blank(text: string): string {
  let out = ''
  for (const ch of text) out += ch === '\n' ? '\n' : ' '
  return out
}

/** Depois destes caracteres, uma barra abre expressao regular — nao divisao. */
const REGEX_CAN_FOLLOW = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', 'n',
])

/**
 * Remove comentarios preservando strings e posicoes.
 *
 * O scanner anda caractere a caractere porque expressao regular nao distingue
 * uma barra dupla de comentario de uma barra dupla dentro de string — e essa
 * distincao e o motivo deste modulo existir.
 */
export function stripComments(source: string, syntax: CommentSyntax): string {
  if (syntax === 'none') return source

  let out = ''
  let i = 0
  const n = source.length
  // Ultimo caractere significativo, usado so para decidir se uma barra abre
  // expressao regular ou e divisao.
  let lastSignificant = ''

  while (i < n) {
    const ch = source.charAt(i)
    const next = i + 1 < n ? source.charAt(i + 1) : ''

    // --- string: copiada INTEIRA, sem interpretacao de comentario ---
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < n) {
        const c = source.charAt(j)
        if (c === '\\') {
          j += 2
          continue
        }
        if (c === quote) {
          j += 1
          break
        }
        // Aspas simples/duplas nao atravessam linha: parar na quebra impede que
        // uma aspa solta (um apostrofo em comentario, por exemplo) engula o resto.
        if (c === '\n' && quote !== '`') break
        j += 1
      }
      out += source.slice(i, j)
      lastSignificant = quote
      i = j
      continue
    }

    if (syntax === 'c-like') {
      if (ch === '/' && next === '/') {
        let j = i
        while (j < n && source.charAt(j) !== '\n') j += 1
        out += blank(source.slice(i, j))
        i = j
        continue
      }
      if (ch === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2)
        const j = end === -1 ? n : end + 2
        out += blank(source.slice(i, j))
        i = j
        continue
      }
      // Expressao regular literal: copiada inteira. Sem isto, um padrao contendo
      // barra em classe de caracteres seria lido como comentario.
      if (ch === '/' && (lastSignificant === '' || REGEX_CAN_FOLLOW.has(lastSignificant))) {
        let j = i + 1
        let inClass = false
        let closed = false
        while (j < n) {
          const c = source.charAt(j)
          if (c === '\\') {
            j += 2
            continue
          }
          if (c === '\n') break
          if (c === '[') inClass = true
          else if (c === ']') inClass = false
          else if (c === '/' && !inClass) {
            j += 1
            closed = true
            break
          }
          j += 1
        }
        if (closed) {
          out += source.slice(i, j)
          lastSignificant = '/'
          i = j
          continue
        }
        // Nao fechou na linha: nao era regex. Segue como caractere comum.
      }
    }

    if (syntax === 'sql') {
      if (ch === '-' && next === '-') {
        let j = i
        while (j < n && source.charAt(j) !== '\n') j += 1
        out += blank(source.slice(i, j))
        i = j
        continue
      }
      if (ch === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2)
        const j = end === -1 ? n : end + 2
        out += blank(source.slice(i, j))
        i = j
        continue
      }
    }

    if (syntax === 'hash' && ch === '#') {
      let j = i
      while (j < n && source.charAt(j) !== '\n') j += 1
      out += blank(source.slice(i, j))
      i = j
      continue
    }

    out += ch
    if (ch.trim().length > 0) lastSignificant = ch
    i += 1
  }

  return out
}

/**
 * A PORTA PADRAO: o conteudo do arquivo SEM comentarios.
 *
 * Use isto em todo guard que procura CODIGO. Se o literal so aparece num
 * comentario, o guard nao casa — que e o comportamento correto.
 */
export function readSourceWithoutComments(filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath)
  return stripComments(readFileSync(absolute, 'utf8'), commentSyntaxFor(absolute))
}

/**
 * A saida DELIBERADA: o arquivo cru, comentarios inclusive.
 *
 * Existe porque alguns guards medem justamente o texto humano — prosa de
 * documentacao, byte de controle, acento, o proprio comentario. `reason` e
 * obrigatorio e nao e decoracao: torna a escolha visivel na revisao e
 * greppavel depois. Quem quiser o cru por preguica tem de escrever por que.
 */
export function readSourceRaw(filePath: string, reason: string): string {
  if (reason.trim().length === 0) {
    throw new Error(
      'readSourceRaw exige um motivo declarado: por que este guard precisa dos comentarios?',
    )
  }
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath)
  return readFileSync(absolute, 'utf8')
}
