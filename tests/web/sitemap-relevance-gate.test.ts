/**
 * sitemap-relevance-gate.test.ts — o PORTAO DE RELEVANCIA (decisao do dono,
 * 24/09/2026) esta nos OITO lugares do SQL do sitemap e nos tres da pagina.
 *
 * A regra pura vive em `evaluateRelevanceGate` (`@screena/seo`). O SQL do
 * sitemap e a segunda traducao dela, escrita a mao em oito trechos: contagem e
 * pagina de FILME, de SERIE, e — pela serie dona — de TEMPORADA e de EPISODIO.
 * Se um trecho perder o predicado, a meta tag diz `noindex` e o sitemap anuncia a
 * URL (ou o contrario), que e o defeito que os portoes existem para impedir.
 *
 * Guard textual nao prova comportamento: quem prova que pagina e sitemap
 * concordam e `validate:seo-runtime` contra PostgreSQL real (checks do portao de
 * relevancia). Este arquivo segura edicao distraida.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const WEB = path.join(REPO_ROOT, 'apps', 'web', 'src', 'server')
const SITEMAP = path.join(WEB, 'seo', 'sitemap-index.ts')

const CHAVE = '${relevanceOff}'
const VOTOS_FILME = 'COALESCE(m.vote_count_tmdb, 0) >= ${RELEVANCE_GATE_MIN_TMDB_VOTES}'
const VOTOS_SERIE = 'COALESCE(t.vote_count_tmdb, 0) >= ${RELEVANCE_GATE_MIN_TMDB_VOTES}'
const PAIS_FILME = 'SELECT 1 FROM movie_production_countries rc'
const PAIS_SERIE = 'SELECT 1 FROM tv_show_origin_countries rc'
const ANCORA = 'rc.country_code = ANY(${RELEVANCE_ANCHOR_CODES})'
const OFERTA_FILME = "rw.entity_type = 'movie' AND rw.entity_id = m.id"
const OFERTA_SERIE = "rw.entity_type = 'tv' AND rw.entity_id = t.id"
const OFERTA_PAIS = 'rw.country_code = ${RELEVANCE_GATE_OFFER_COUNTRY}'

function ocorrencias(texto: string, literal: string): number {
  return texto.split(literal).length - 1
}

describe('portao de relevancia no SQL do sitemap', () => {
  const fonte = readSourceWithoutComments(SITEMAP)

  it('(1) a chave de emergencia abre os OITO trechos', () => {
    expect(ocorrencias(fonte, CHAVE)).toBe(8)
  })

  it('(2) filme: contagem e pagina, com o pais de producao e a oferta do filme', () => {
    expect(ocorrencias(fonte, VOTOS_FILME)).toBe(2)
    expect(ocorrencias(fonte, PAIS_FILME)).toBe(2)
    expect(ocorrencias(fonte, OFERTA_FILME)).toBe(2)
  })

  it('(3) serie: contagem e pagina, e a serie dona de temporada e episodio (6 trechos)', () => {
    expect(ocorrencias(fonte, VOTOS_SERIE)).toBe(6)
    expect(ocorrencias(fonte, PAIS_SERIE)).toBe(6)
    expect(ocorrencias(fonte, OFERTA_SERIE)).toBe(6)
  })

  it('(4) todo trecho compara com os paises-ancora e o territorio da config', () => {
    expect(ocorrencias(fonte, ANCORA)).toBe(8)
    expect(ocorrencias(fonte, OFERTA_PAIS)).toBe(8)
  })

  it('(5) EXISTS correlacionado, nunca CTE (a PR 323 reverteu um portao em CTE)', () => {
    expect(fonte).not.toMatch(/\bWITH\s+\w+\s+AS\s*\(/i)
  })

  it('(6) os numeros vem de @screena/config, nao de literal solto', () => {
    expect(fonte).toContain('RELEVANCE_GATE_MIN_TMDB_VOTES')
    expect(fonte).not.toMatch(/vote_count_tmdb, 0\) >= 500/)
    expect(fonte).toMatch(/const relevanceOff = !isRelevanceGateEnabled\(\)/)
  })
})

describe('portao de relevancia do lado da pagina', () => {
  it('(7) ficha de filme e de serie combinam D3 + relevancia', () => {
    for (const arquivo of ['movie-page.ts', 'series-page.ts']) {
      const fonte = readSourceWithoutComments(path.join(WEB, arquivo))
      expect(fonte, arquivo).toContain('firstFailedQualityGate([')
      expect(fonte, arquivo).toContain('await evaluateTitleRelevance(prisma, {')
      expect(fonte, arquivo).toContain('voteCountTmdb: true')
    }
  })

  it('(8) temporada e episodio herdam pela serie dona (series-in-index)', () => {
    const fonte = readSourceWithoutComments(path.join(WEB, 'seo', 'series-in-index.ts'))
    expect(fonte).toContain('evaluateTitleRelevance(prisma, {')
    expect(fonte).toContain('if (!relevancia.passed) return false;')
  })

  it('(9) a pagina le a oferta como QUALQUER linha BR, igual ao sitemap', () => {
    const fonte = readSourceWithoutComments(path.join(WEB, 'seo', 'title-relevance.ts'))
    expect(fonte).toContain('countryCode: RELEVANCE_GATE_OFFER_COUNTRY')
    // Nenhum filtro de exibicao: a pergunta e distribuicao, nao licenca de tela.
    expect(fonte).not.toContain('displayAllowed')
    expect(fonte).toContain('if (!isRelevanceGateEnabled()) return RELEVANCE_GATE_OFF_VERDICT;')
  })
})

describe('chave de emergencia e de RUNTIME, nunca de build', () => {
  it('(10) nenhum Dockerfile nem o next.config assa a variavel', () => {
    const arquivos = [
      path.join(REPO_ROOT, 'Dockerfile'),
      path.join(REPO_ROOT, 'apps', 'web', 'next.config.ts'),
    ]
    for (const arquivo of arquivos) {
      expect(readSourceWithoutComments(arquivo), arquivo).not.toContain('CINERIE_RELEVANCE_GATE')
    }
  })
})
