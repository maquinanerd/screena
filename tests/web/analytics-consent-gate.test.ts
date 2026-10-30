/**
 * analytics-consent-gate.test.ts — o Google Analytics so tem UMA porta de
 * entrada, e ela passa pelo aviso de cookies.
 *
 * O teste do componente prova que o `ConsentBanner` espera o "Aceitar". Isso
 * nao adianta se outro arquivo carregar o gtag.js por fora — um `<Script>` no
 * layout, um snippet colado numa pagina. Aqui se trava o alcance: o host do
 * gtag.js so aparece no modulo de configuracao (que monta a URL) e no CSP; a
 * funcao que monta a URL so e chamada pelo aviso; e o layout so monta o aviso
 * a partir de `analyticsConfig()`.
 *
 * Tambem trava a outra metade da promessa da Politica de Privacidade: o beacon
 * da Cloudflare e o UNICO script de medicao que carrega sem pergunta.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { GA4_COOKIE_MAX_AGE_SECONDS } from '../../apps/web/src/lib/analytics-config'
import { CONSENT_MAX_AGE_DAYS, CONSENT_STORAGE_KEY } from '../../apps/web/src/lib/analytics-consent'
import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web')

function codigoDoAppPublico(): string[] {
  const arquivos: string[] = []
  const andar = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      const caminho = path.join(dir, entrada)
      if (statSync(caminho).isDirectory()) {
        if (entrada === 'node_modules' || entrada === '.next' || entrada === '__tests__') continue
        andar(caminho)
        continue
      }
      if (/\.(ts|tsx|js|jsx|mjs)$/.test(entrada) && !/\.test\./.test(entrada)) arquivos.push(caminho)
    }
  }
  andar(path.join(WEB_DIR, 'app'))
  andar(path.join(WEB_DIR, 'src'))
  for (const entrada of readdirSync(WEB_DIR)) {
    if (/\.(ts|mjs)$/.test(entrada)) arquivos.push(path.join(WEB_DIR, entrada))
  }
  return arquivos
}

const relativo = (arquivo: string): string => path.relative(WEB_DIR, arquivo).split(path.sep).join('/')

function arquivosQueContem(padrao: RegExp): string[] {
  return codigoDoAppPublico()
    .filter((arquivo) => padrao.test(readSourceWithoutComments(arquivo)))
    .map(relativo)
    .sort()
}

describe('Google Analytics — uma porta de entrada, atras do consentimento', () => {
  it('(1) o host do gtag.js so aparece no modulo dos scripts e no CSP', () => {
    expect(arquivosQueContem(/googletagmanager\.com/)).toEqual(['middleware.ts', 'src/lib/analytics-scripts.ts'])
  })

  it('(2) os hosts de coleta do GA4 so aparecem no CSP', () => {
    expect(arquivosQueContem(/google-analytics\.com|analytics\.google\.com/)).toEqual(['middleware.ts'])
  })

  it('(3) quem monta a URL do gtag.js e so o aviso de cookies', () => {
    const chamadores = arquivosQueContem(/\bga4ScriptUrl\s*\(/)
    expect(chamadores).toEqual(['app/_components/consent-banner.tsx', 'src/lib/analytics-scripts.ts'])
  })

  it('(3b) o aviso de cookies (cliente) nao importa o modulo que le env do servidor', () => {
    const aviso = readSourceWithoutComments(path.join(WEB_DIR, 'app', '_components', 'consent-banner.tsx'))
    expect(aviso).not.toMatch(/analytics-config|lib\/site['"]/)
  })

  it('(4) o layout monta o aviso so com o identificador de analyticsConfig()', () => {
    const layout = readSourceWithoutComments(path.join(WEB_DIR, 'app', 'layout.tsx'))
    expect(layout).toContain('const analytics = analyticsConfig();')
    expect(layout).toContain('<ConsentBanner measurementId={analytics.ga4MeasurementId} />')
  })

  it('(5) nenhum outro script de medicao no app (Tag Manager, Meta, Hotjar, Clarity)', () => {
    // Hosts e chamadas, e nao nomes: a Politica de Privacidade CITA Hotjar e
    // Clarity em texto para dizer que eles nao existem aqui.
    expect(arquivosQueContem(/gtm\.js|connect\.facebook\.net|fbq\(|static\.hotjar\.com|clarity\.ms/i)).toEqual([])
  })

  it('(6) a Politica de Privacidade declara os MESMOS numeros e a MESMA chave do codigo', () => {
    const politica = readSourceWithoutComments(path.join(WEB_DIR, 'app', 'pt', 'privacidade', 'page.tsx'))
    expect(GA4_COOKIE_MAX_AGE_SECONDS / 86_400).toBe(395)
    expect(politica).toContain('Até 13 meses')
    expect(CONSENT_MAX_AGE_DAYS).toBe(180)
    expect(politica).toContain('<strong>6 meses</strong>')
    expect(politica).toContain(CONSENT_STORAGE_KEY)
    expect(politica).toContain('id="cookies"')
    // A frase que o GA4 tornaria falsa nao pode voltar.
    expect(politica).not.toContain('Não há Google Analytics')
    expect(politica).not.toContain('Não há cookie de publicidade, de análise')
  })

  it('(7) CONTROLE: o detector do item 1 reconhece o snippet que o painel do GA4 entrega', () => {
    const snippet = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"></script>'
    expect(/googletagmanager\.com/.test(snippet)).toBe(true)
  })
})
