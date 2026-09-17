/**
 * institutional-pages-facts.test.ts — Sobre, Politica editorial, Contato e a
 * metodologia do Cinerie Score so repetem o que ja esta publicado.
 *
 * A regra da remediacao da auditoria de SEO de 11/09/2026 para paginas de
 * confianca: nenhum canal, identificacao ou credencial que nao exista. O teste a
 * torna verificavel em tres frentes:
 *  1. os canais de contato e a identificacao do responsavel (os valores de
 *     `institutional-facts.ts`) constam dos documentos legais do controlador;
 *  2. nenhuma pagina institucional escreve e-mail, CNPJ ou telefone por conta
 *     propria — tudo passa pelo modulo conferido em (1);
 *  3. a nota de IA citada na Politica editorial e a MESMA que a materia exibe.
 */

import { PUBLIC_EDITORIAL_POLICY_PATH } from '@screena/seo'
import { describe, expect, it } from 'vitest'

import { AI_ASSISTED_ARTICLE_NOTE } from '../../apps/web/src/lib/editorial-disclosure'
import { EDITORIAL_POLICY_PATH } from '../../apps/web/src/lib/routes'
import {
  GENERAL_CONTACT_EMAIL,
  PRIVACY_CONTACT_EMAIL,
  SITE_CONTROLLER,
} from '../../apps/web/src/lib/institutional-facts'
import { readSourceWithoutComments } from '../support/source-text'

const TERMOS = readSourceWithoutComments('apps/web/app/pt/termos/page.tsx')
const PRIVACIDADE = readSourceWithoutComments('apps/web/app/pt/privacidade/page.tsx')

const INSTITUCIONAIS = ['sobre', 'politica-editorial', 'contato', 'cinerie-score'].map(
  (slug) => [slug, readSourceWithoutComments(`apps/web/app/pt/${slug}/page.tsx`)] as const,
)

describe('as paginas institucionais so repetem o que o controlador publicou', () => {
  it('CONTROLE: os documentos legais e as quatro paginas foram lidos', () => {
    expect(TERMOS.length).toBeGreaterThan(1000)
    expect(PRIVACIDADE.length).toBeGreaterThan(1000)
    for (const [slug, source] of INSTITUCIONAIS) expect(source.length, slug).toBeGreaterThan(500)
  })

  it('(1) os canais de contato constam dos documentos legais', () => {
    expect(TERMOS).toContain(GENERAL_CONTACT_EMAIL)
    expect(TERMOS).toContain(PRIVACY_CONTACT_EMAIL)
    expect(PRIVACIDADE).toContain(PRIVACY_CONTACT_EMAIL)
  })

  it('(1) a identificacao do responsavel e a dos Termos de Uso, campo a campo', () => {
    for (const valor of Object.values(SITE_CONTROLLER)) expect(TERMOS).toContain(valor)
  })

  it('(2) nenhuma pagina institucional escreve e-mail, CNPJ ou telefone a mao', () => {
    const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z0-9.-]+/i
    const CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/
    const TELEFONE = /\(\d{2}\)\s?\d{4,5}-?\d{4}|\+55\s?\d/
    for (const [slug, source] of INSTITUCIONAIS) {
      expect(source, `${slug}: e-mail escrito a mao`).not.toMatch(EMAIL)
      expect(source, `${slug}: CNPJ escrito a mao`).not.toMatch(CNPJ)
      expect(source, `${slug}: telefone`).not.toMatch(TELEFONE)
    }
  })

  it('(2) CONTROLE NEGATIVO: os detectores casam o que deveriam', () => {
    expect('escreva para contato@cinerie.com').toMatch(/[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z0-9.-]+/i)
    expect("import x from '@screena/seo'").not.toMatch(/[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z0-9.-]+/i)
    expect('CNPJ: 22.739.386/0001-90').toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
  })

  it('(3) a nota de IA da Politica editorial e a da materia', () => {
    const politica = readSourceWithoutComments('apps/web/app/pt/politica-editorial/page.tsx')
    const materia = readSourceWithoutComments('apps/web/app/pt/noticias/[slug]/page.tsx')
    expect(politica).toContain('{AI_ASSISTED_ARTICLE_NOTE}')
    expect(materia).toContain('{AI_ASSISTED_ARTICLE_NOTE}')
    expect(AI_ASSISTED_ARTICLE_NOTE).toMatch(/inteligência artificial\.$/)
  })

  it('(4) o `publishingPrinciples` do JSON-LD aponta para a rota REAL da Politica editorial', () => {
    expect(PUBLIC_EDITORIAL_POLICY_PATH).toBe(EDITORIAL_POLICY_PATH)
  })
})
