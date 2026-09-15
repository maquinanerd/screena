/**
 * llms-txt.test.ts — o `/llms.txt` so diz o que o site ja publica.
 *
 * O que se trava: o formato (titulo, resumo, secoes com URL absoluta), os
 * creditos saindo VERBATIM da licenca, nenhuma afirmacao sobre uso por IA alem de
 * apontar o robots.txt, e o arquivo sumindo (404) no ambiente que nao indexa.
 */

import { describe, expect, it } from 'vitest'

import { GET } from '../../apps/web/app/llms.txt/route'
import { DATA_CREDITS } from '../../apps/web/src/config/footer'
import { buildLlmsTxt } from '../../apps/web/src/lib/llms-txt'

const CREDITO = { roleLabel: 'Metadados de catálogo', text: 'Texto exato da licença, sem paráfrase.' }

describe('llms.txt', () => {
  const txt = buildLlmsTxt('https://cinerie.com/', [CREDITO])

  it('(1) titulo, resumo em blockquote e secoes com URL absoluta', () => {
    const linhas = txt.split('\n')
    expect(linhas[0]).toBe('# Cinerie')
    expect(txt).toMatch(/^> .+/m)
    expect(txt).toContain('- [Filmes](https://cinerie.com/pt/filmes/)')
    expect(txt).toContain('- [Notícias](https://cinerie.com/pt/noticias/)')
    // Barra final da origem nao vira barra dupla.
    expect(txt).not.toContain('cinerie.com//')
  })

  it('(2) credito e o texto da licenca, sem reescrita', () => {
    expect(txt).toContain('- Metadados de catálogo: Texto exato da licença, sem paráfrase.')
  })

  it('(3) por padrao, os creditos sao os MESMOS do rodape', () => {
    const padrao = buildLlmsTxt('https://cinerie.com')
    expect(DATA_CREDITS.length).toBeGreaterThan(0)
    for (const credito of DATA_CREDITS) expect(padrao).toContain(credito.text)
  })

  it('(4) sobre IA, so aponta o robots.txt — nao concede nem nega uso por conta propria', () => {
    expect(txt).toContain('(https://cinerie.com/robots.txt)')
    expect(txt).not.toMatch(/treinamento|training|permitid|allowed/i)
  })

  it('(5) ambiente que nao indexa (este, de teste) nao se apresenta: 404', async () => {
    const resposta = GET()
    expect(resposta.status).toBe(404)
  })
})
