/**
 * Teste de governanca (meta) — presenca das 13 invariantes no CLAUDE.md.
 *
 * Le o CLAUDE.md (via fs, caminho relativo a process.cwd() = raiz do repo) e
 * afirma que a frase-chave de cada uma das 13 Regras de Ouro continua presente.
 *
 * Proposito: travar a governanca. Se alguem reescreve, dilui ou remove o sentido
 * de uma invariante, este teste quebra de proposito — qualquer afrouxamento exige
 * revisao humana explicita, nao um "ajuste de texto" silencioso.
 *
 * NAO afrouxe estas asserts para fazer o teste passar. Se uma frase mudou, a
 * pergunta certa e: a invariante foi enfraquecida? Em caso afirmativo, reverta.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

/**
 * Cada entrada cobre uma das 13 invariantes inegociaveis (CLAUDE.md, secao 2).
 * `needles` lista trechos que devem aparecer TODOS no documento; a comparacao e
 * case-insensitive para nao quebrar por capitalizacao. Use frases curtas e
 * carregadas de sentido — o objetivo e detectar enfraquecimento, nao formatacao.
 */
const INVARIANTS: ReadonlyArray<{ id: number; label: string; needles: readonly string[] }> = [
  {
    id: 1,
    label: 'IMDb != Rotten Tomatoes (fontes/escalas distintas)',
    needles: ['IMDb != Rotten Tomatoes', 'nunca misturar fontes'],
  },
  {
    id: 2,
    label: 'provider_api != rating_source',
    needles: ['provider_api != rating_source', 'nunca e a fonte editorial'],
  },
  {
    id: 3,
    label: 'Zero API externa no render',
    needles: ['Zero API externa no render', 'leem apenas PostgreSQL'],
  },
  {
    id: 4,
    label: 'Zero Gemini no render',
    needles: ['Zero Gemini no render', 'content_blocks offline'],
  },
  {
    id: 5,
    label: 'Pagina fina recebe noindex (gate anti-thin)',
    needles: ['Pagina fina recebe noindex', '2 blocos de valor'],
  },
  {
    id: 6,
    label: 'Dados sem licenca clara nao indexam (display_allowed)',
    needles: ['Dados sem licenca clara', 'display_allowed=false'],
  },
  {
    id: 7,
    label: 'pt-BR publica primeiro; en/es em draft/noindex',
    needles: ['pt-BR publica primeiro', 'en/es nascem em draft/noindex'],
  },
  {
    id: 8,
    label: 'Sem pirataria',
    needles: ['Sem pirataria', 'embed pirata'],
  },
  {
    id: 9,
    label: 'Screena Movies usa acento vermelho',
    needles: ['Screena Movies usa acento vermelho', '--screena-movie-red'],
  },
  {
    id: 10,
    label: 'Screena Series usa acento verde',
    needles: ['Screena Series usa acento verde', '--screena-series-green'],
  },
  {
    id: 11,
    label: 'Diferenciacao filme/serie nunca depende so da cor',
    needles: ['NUNCA depende so da cor', 'label + badge + breadcrumb + schema + URL'],
  },
  {
    id: 12,
    label: 'Entity Writer so escreve com base em payload controlado',
    needles: ['payload controlado do PostgreSQL', 'nao chama APIs externas'],
  },
  {
    id: 13,
    label: 'content_blocks versionados e revisaveis',
    needles: ['content_blocks sao versionados e revisaveis', 'input_hash'],
  },
]

describe('governanca: as 13 invariantes estao presentes no CLAUDE.md', () => {
  let docLower = ''

  beforeAll(async () => {
    const claudeMdPath = resolve(process.cwd(), 'CLAUDE.md')
    const raw = await readFile(claudeMdPath, 'utf-8')
    expect(raw.length).toBeGreaterThan(0)
    docLower = raw.toLowerCase()
  })

  it.each(INVARIANTS)('invariante $id — $label', ({ needles }) => {
    for (const needle of needles) {
      expect(
        docLower.includes(needle.toLowerCase()),
        `Frase-chave ausente no CLAUDE.md: "${needle}". A invariante pode ter sido enfraquecida ou removida.`,
      ).toBe(true)
    }
  })

  it('cobre exatamente as 13 invariantes inegociaveis', () => {
    expect(INVARIANTS).toHaveLength(13)
    expect(INVARIANTS.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })
})
