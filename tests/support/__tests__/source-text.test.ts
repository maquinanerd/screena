/**
 * O removedor de comentarios tem de acertar as DUAS metades.
 *
 * Tirar comentario e a metade facil. A dificil e NAO tirar o que parece
 * comentario e nao e: a barra dupla de uma URL dentro de string. Um removedor
 * que erra essa metade quebra, em silencio, todo guard que procura host ou
 * rota — e um guard que nao casa mais com nada tambem fica verde.
 */

import { describe, expect, it } from 'vitest'

import {
  commentSyntaxFor,
  readSourceWithoutComments,
  readSourceRaw,
  stripComments,
} from '../source-text.js'

describe('stripComments: tira comentario', () => {
  it('tira comentario de linha', () => {
    const out = stripComments("const a = 1 // segredo\nconst b = 2\n", 'c-like')
    expect(out).not.toContain('segredo')
    expect(out).toContain('const a = 1')
    expect(out).toContain('const b = 2')
  })

  it('tira comentario de bloco, inclusive multilinha', () => {
    const out = stripComments('const a = 1\n/* linha1\n   segredo */\nconst b = 2\n', 'c-like')
    expect(out).not.toContain('segredo')
    expect(out).toContain('const b = 2')
  })

  it('tira comentario de SQL (--) e de bloco', () => {
    const out = stripComments("-- segredo\nINSERT INTO t VALUES ('x');\n/* segredo2 */\n", 'sql')
    expect(out).not.toContain('segredo')
    expect(out).not.toContain('segredo2')
    expect(out).toContain('INSERT INTO t')
  })

  it('tira comentario de YAML (#)', () => {
    const out = stripComments('key: valor # segredo\n', 'hash')
    expect(out).not.toContain('segredo')
    expect(out).toContain('key: valor')
  })
})

describe('stripComments: NAO tira o que so parece comentario', () => {
  it('preserva a barra dupla de URL dentro de string', () => {
    // O caso que quebraria guard de host/rota em silencio.
    const fonte = "const u = 'https://files.tmdb.org/p/exports'\n"
    expect(stripComments(fonte, 'c-like')).toContain('https://files.tmdb.org/p/exports')
  })

  it('preserva URL em aspas duplas e em template literal', () => {
    expect(stripComments('const a = "https://cinerie.com/pt/"\n', 'c-like')).toContain(
      'https://cinerie.com/pt/',
    )
    expect(stripComments('const b = `https://image.tmdb.org/t/p/w500`\n', 'c-like')).toContain(
      'https://image.tmdb.org/t/p/w500',
    )
  })

  it('preserva `--` dentro de string em SQL', () => {
    const fonte = "INSERT INTO t VALUES ('a--b');\n"
    expect(stripComments(fonte, 'sql')).toContain('a--b')
  })

  it('preserva `#` dentro de string em YAML', () => {
    expect(stripComments("cor: '#f0443e'\n", 'hash')).toContain('#f0443e')
  })

  it('preserva barra em classe de caracteres de expressao regular', () => {
    const fonte = 'const re = /[/]a/\nconst depois = 1\n'
    const out = stripComments(fonte, 'c-like')
    expect(out).toContain('const depois = 1')
  })

  it('nao trata escape dentro de string como fim de string', () => {
    const fonte = "const a = 'ele disse \\'oi\\' // nao e comentario'\nconst b = 2\n"
    const out = stripComments(fonte, 'c-like')
    expect(out).toContain('nao e comentario')
    expect(out).toContain('const b = 2')
  })

  it('aspas soltas em comentario nao engolem o resto do arquivo', () => {
    // Um apostrofo em prosa pt-BR ("nao ha") ja bastaria para um scanner
    // ingenuo tratar todo o resto do arquivo como string.
    const fonte = "// o que nao 'e comentario\nconst visivel = 'ok'\n"
    const out = stripComments(fonte, 'c-like')
    expect(out).toContain('const visivel')
  })
})

describe('stripComments: linguagem sem comentario volta CRUA', () => {
  it('markdown nao perde a barra dupla de URL', () => {
    const md = 'Veja [isto](https://cinerie.com/pt/filmes/) // isto nao e comentario\n'
    expect(stripComments(md, 'none')).toBe(md)
  })

  it('extensao desconhecida cai em `none` (nao adivinha)', () => {
    expect(commentSyntaxFor('arquivo.qualquercoisa')).toBe('none')
    expect(commentSyntaxFor('a.md')).toBe('none')
    expect(commentSyntaxFor('a.json')).toBe('none')
  })

  it('a sintaxe sai da extensao', () => {
    expect(commentSyntaxFor('a.ts')).toBe('c-like')
    expect(commentSyntaxFor('a.tsx')).toBe('c-like')
    expect(commentSyntaxFor('migration.sql')).toBe('sql')
    expect(commentSyntaxFor('ci.yml')).toBe('hash')
  })
})

describe('stripComments: as posicoes sobrevivem', () => {
  it('a contagem de linhas nao muda', () => {
    const fonte = 'a\n// b\n/* c\n   d */\ne\n'
    const antes = fonte.split('\n').length
    expect(stripComments(fonte, 'c-like').split('\n').length).toBe(antes)
  })

  it('o comprimento total nao muda (comentario vira espaco)', () => {
    const fonte = 'const a = 1 // segredo\n'
    expect(stripComments(fonte, 'c-like').length).toBe(fonte.length)
  })
})

// AGULHA-9f2a: esta linha e um comentario e a proxima ocorrencia contigua da
// agulha no arquivo esta AQUI, so aqui. No codigo ela e montada em pedacos de
// proposito — se aparecesse como string inteira, sobreviveria ao strip (strings
// sao preservadas) e o teste abaixo ficaria verde sem provar nada.
const ESTE_ARQUIVO = 'tests/support/__tests__/source-text.test.ts'
const AGULHA = ['AGULHA', '9f2a'].join('-')

describe('as duas portas', () => {
  it('a agulha existe MESMO no arquivo cru (senao o teste seguinte nao prova nada)', () => {
    const cru = readSourceRaw(ESTE_ARQUIVO, 'este teste mede a diferenca entre as duas portas')
    expect(cru).toContain(AGULHA)
  })

  it('readSourceWithoutComments NAO ve a agulha, porque ela so vive em comentario', () => {
    expect(readSourceWithoutComments(ESTE_ARQUIVO)).not.toContain(AGULHA)
  })

  it('readSourceRaw exige motivo escrito', () => {
    expect(() => readSourceRaw('tests/support/source-text.ts', '   ')).toThrow(/motivo/)
  })
})
