/**
 * sitemap-localizacao-titulo-proprio.test.ts — a D3 no SQL do sitemap exige
 * titulo PROPRIO, nao titulo qualquer.
 *
 * ============================================================================
 * O DEFEITO MEDIDO, E POR QUE ELE PASSOU PELOS TESTES
 * ============================================================================
 * O portao de localizacao (decisao do dono D3) foi para producao em 17/09/2026 e
 * nao barrou NINGUEM: 11.922 fichas de slug `tmdb-N` (6.682 filmes e 5.240
 * series) seguiram no sitemap e com `index` — praticamente a populacao inteira
 * que a auditoria media (~11.666).
 *
 * A causa: a condicao era "existe titulo nao vazio na linha do locale publicado".
 * E existe: a linha pt-BR carrega o titulo ORIGINAL copiado. Amostrado em
 * producao, `/pt/filmes/tmdb-1465816/` sai com `<h1>Τίποτα</h1>`, description
 * gerada de fatos e `index, follow`.
 *
 * Nenhum teste pegou porque nenhum descrevia o caso: as fixtures enriqueciam a
 * ficha com um titulo DIFERENTE ("A Galeria" para `title_original` "Galerie"),
 * que e o caso bom. O caso ruim — copia — nao existia em fixture nenhuma.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 * A regra pura vive em `isLocalizedTitle` e e testada em `packages/seo`. O SQL do
 * sitemap e a SEGUNDA traducao da mesma regra, escrita a mao em oito lugares:
 * contagem e pagina, para filme e para serie, e — desde 22/09/2026 — contagem e
 * pagina de TEMPORADA e de EPISODIO, que herdam a exclusao da serie dona. Aqui
 * se prova que os oito comparam com o original — e, principalmente, que nenhum
 * teste de "titulo nao vazio" sobrou SEM a comparacao ao lado, que e a forma
 * exata do defeito.
 *
 * Guard textual nao prova comportamento: quem prova que pagina e sitemap
 * concordam e `validate:seo-runtime` contra PostgreSQL real (checks 43 a 47 e
 * 55 a 57). Este arquivo existe para o defeito nao voltar por edicao distraida de
 * um dos quatro trechos.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { isLocalizedTitle } from '@screena/seo'

import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const SITEMAP = path.join(REPO_ROOT, 'apps', 'web', 'src', 'server', 'seo', 'sitemap-index.ts')

const TITULO_NAO_VAZIO = "BTRIM(COALESCE(et.title, '')) <> ''"
const CONTRA_ORIGINAL_FILME = "BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(m.title_original, ''))"
const CONTRA_ORIGINAL_SERIE = "BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, ''))"

function ocorrencias(texto: string, literal: string): number {
  return texto.split(literal).length - 1
}

describe('D3 no SQL do sitemap — titulo proprio', () => {
  const fonte = readSourceWithoutComments(SITEMAP)

  it('(1) INSTRUMENTO: o arquivo lido e o do sitemap, com os oito predicados de escopo', () => {
    // 1 import + 4 usos nas fichas + 4 na serie dona de temporada e episodio. Se
    // este numero mudar, um predicado nasceu ou morreu, e as contagens abaixo
    // precisam ser reconferidas em vez de ajustadas.
    expect(ocorrencias(fonte, 'TMDB_FALLBACK_SLUG_SQL_PATTERN')).toBe(9)
  })

  it('(2) filme: contagem e pagina comparam o titulo publicado com m.title_original', () => {
    expect(ocorrencias(fonte, CONTRA_ORIGINAL_FILME)).toBe(2)
  })

  it('(3) serie: contagem e pagina comparam com t.name_original — tambem na serie dona de temporada e episodio', () => {
    expect(ocorrencias(fonte, CONTRA_ORIGINAL_SERIE)).toBe(6)
  })

  it('(4) nenhum "titulo nao vazio" sobrou sem a comparacao ao lado', () => {
    const naoVazio = ocorrencias(fonte, TITULO_NAO_VAZIO)
    const comparados = ocorrencias(fonte, CONTRA_ORIGINAL_FILME) + ocorrencias(fonte, CONTRA_ORIGINAL_SERIE)
    expect(naoVazio).toBe(8)
    expect(comparados).toBe(naoVazio)
  })

  it('(5) CONTROLE: o guard cai se a comparacao for removida de um dos trechos', () => {
    const adulterado = fonte.replace(CONTRA_ORIGINAL_FILME, "BTRIM(COALESCE(et.title, '')) <> ''")
    expect(ocorrencias(adulterado, CONTRA_ORIGINAL_FILME)).toBe(1)
    expect(
      ocorrencias(adulterado, CONTRA_ORIGINAL_FILME) + ocorrencias(adulterado, CONTRA_ORIGINAL_SERIE),
    ).not.toBe(ocorrencias(adulterado, TITULO_NAO_VAZIO))
  })

  it('(6) a regra que o SQL descreve e a mesma da pagina', () => {
    expect(isLocalizedTitle('Τίποτα', 'Τίποτα')).toBe(false)
    expect(isLocalizedTitle('  Τίποτα ', 'Τίποτα  ')).toBe(false)
    expect(isLocalizedTitle('Nada', 'Τίποτα')).toBe(true)
    expect(isLocalizedTitle(null, 'Τίποτα')).toBe(false)
  })
})
