/**
 * legal-documents.test.ts — os documentos juridicos publicos.
 *
 * DUAS COISAS SAO TRAVADAS AQUI, e a segunda e a que importa a longo prazo.
 *
 * 1. ENQUANTO FOR MINUTA, NAO INDEXA. Documento juridico nao revisado indexado e
 *    pior que ausente: o buscador passa a servi-lo como se fosse a politica
 *    vigente, e a correcao depois nao alcanca quem ja leu.
 *
 * 2. O TEXTO NAO PODE DIVERGIR DO CODIGO. A politica afirma coisas verificaveis
 *    — quais finalidades de consentimento existem, qual a base legal de cada
 *    uma, o que sai numa exportacao, o que sobrevive ao encerramento. Todas essas
 *    afirmacoes tem origem em `services/user-platform/src/privacy/policy.ts`.
 *    Sem este teste, alguem acrescenta uma finalidade no codigo, ninguem lembra
 *    do documento, e a Cinerie passa a tratar um dado que a politica publicada
 *    nao menciona. Isso nao e desatualizacao: e afirmacao falsa numa pagina
 *    publica sobre dado pessoal.
 */

import { describe, expect, it } from 'vitest'

import {
  CONSENT_LEGAL_BASIS,
  DATA_CLASSIFICATION,
  PRIVACY_DURATIONS,
} from '../../services/user-platform/src/privacy/policy.js'
import {
  LEGAL_CONSENT_PURPOSES,
  LEGAL_DATA_CATEGORIES,
  LEGAL_DOCUMENTS_REVIEWED,
  LEGAL_PLACEHOLDERS,
  legalDocumentShouldIndex,
} from '../../apps/web/src/lib/legal.js'

describe('estagio do documento', () => {
  it('minuta NAO indexa; revisado indexa', () => {
    // A funcao e testada nos dois sentidos de proposito: um gate que so recusa
    // passaria igual se estivesse quebrado no sentido de permitir.
    expect(legalDocumentShouldIndex(false)).toBe(false)
    expect(legalDocumentShouldIndex(true)).toBe(true)
  })

  it('o estado ATUAL do repositorio e coerente consigo mesmo', () => {
    expect(legalDocumentShouldIndex()).toBe(LEGAL_DOCUMENTS_REVIEWED)
  })

  it('enquanto houver marcador por preencher, o documento nao esta pronto', () => {
    // O acoplamento e proposital: liberar a indexacao sem trocar `{{CNPJ}}` por
    // um CNPJ real publicaria um documento com lacuna visivel como se fosse a
    // politica vigente.
    if (LEGAL_DOCUMENTS_REVIEWED) {
      expect(
        LEGAL_PLACEHOLDERS.length,
        'documento marcado como revisado ainda declara marcadores por preencher',
      ).toBe(0)
    } else {
      expect(LEGAL_PLACEHOLDERS.length).toBeGreaterThan(0)
    }
  })

  it('todo marcador tem a forma `{{NOME}}` — nada de valor plausivel disfarcado', () => {
    // Um marcador que parecesse um valor real ("Cinerie Ltda") seria pior que a
    // ausencia: o leitor acreditaria nele.
    for (const placeholder of LEGAL_PLACEHOLDERS) {
      expect(placeholder).toMatch(/^\{\{[A-Z_]+\}\}$/)
    }
  })
})

describe('o documento descreve o codigo, nao um modelo generico', () => {
  it('as finalidades da politica sao EXATAMENTE as do codigo', () => {
    const noCodigo = Object.keys(CONSENT_LEGAL_BASIS).sort()
    const noDocumento = LEGAL_CONSENT_PURPOSES.map((purpose) => purpose.kind).sort()
    expect(
      noDocumento,
      'a politica publicada e as finalidades registradas pela plataforma divergiram',
    ).toEqual(noCodigo)
  })

  it('a base legal declarada bate, finalidade por finalidade', () => {
    // Errar aqui e o pior tipo de erro deste documento: dizer que algo e
    // revogavel quando o codigo trata como nao revogavel (ou o contrario)
    // desinforma o titular exatamente no ponto em que ele decide.
    for (const purpose of LEGAL_CONSENT_PURPOSES) {
      expect(purpose.base, `base legal divergente em ${purpose.kind}`).toBe(
        CONSENT_LEGAL_BASIS[purpose.kind],
      )
    }
  })

  it('as categorias de dado sao EXATAMENTE as do codigo', () => {
    const noCodigo = Object.keys(DATA_CLASSIFICATION).sort()
    const noDocumento = LEGAL_DATA_CATEGORIES.map((item) => item.categoria).sort()
    expect(
      noDocumento,
      'ha categoria tratada pela plataforma que a politica nao menciona (ou o inverso)',
    ).toEqual(noCodigo)
  })

  it('o que a politica promete sobre EXPORTACAO e o que o codigo faz', () => {
    // "Sai na exportacao?" e uma promessa ao titular sobre o direito de
    // portabilidade. Prometer o que o codigo nao entrega e o defeito mais grave
    // possivel deste documento.
    for (const item of LEGAL_DATA_CATEGORIES) {
      expect(item.exportavel, `exportabilidade divergente em ${item.categoria}`).toBe(
        DATA_CLASSIFICATION[item.categoria].exportable,
      )
    }
  })

  it('segredo e credencial NUNCA aparecem como exportaveis', () => {
    // Controle explicito e redundante de proposito: se a tabela do codigo um dia
    // marcar um hash como exportavel, isto falha antes de a promessa chegar a
    // pagina publica.
    for (const categoria of ['account_credentials', 'security_sessions', 'security_tokens', 'security_ip'] as const) {
      const noDocumento = LEGAL_DATA_CATEGORIES.find((item) => item.categoria === categoria)
      expect(noDocumento?.exportavel, `${categoria} nao pode ser exportavel`).toBe(false)
      expect(DATA_CLASSIFICATION[categoria].exportable).toBe(false)
    }
  })

  it('o prazo de arrependimento citado no texto e o do codigo', () => {
    // O texto afirma "14 dias" por extenso. Se a constante mudar, a afirmacao
    // vira mentira — e ninguem releria a pagina para conferir.
    expect(PRIVACY_DURATIONS.deletionGraceDays).toBe(14)
    expect(PRIVACY_DURATIONS.authAuditRetentionDays).toBe(365)
  })
})
