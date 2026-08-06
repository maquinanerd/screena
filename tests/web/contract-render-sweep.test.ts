/**
 * VARREDURA DE CONTRATO: todo valor legal sobrevive ate o HTML?
 *
 * Este e o teste que faltava. Quatro defeitos da MESMA classe ja apareceram
 * neste repositorio, um de cada vez, sempre descobertos tarde:
 *
 *   1. `entityCard` com tipo fora de movie/tv — cartao e nota sumiam;
 *   2. `video` com provider `internal` — sumia ate com URL preenchida;
 *   3. `schemaTypeRecommendation` fora de NewsArticle/Article — ignorado;
 *   4. lista/galeria sem item — `<ul>` vazia em vez de ausencia.
 *
 * Todos tinham a mesma forma: valor LEGAL no contrato, selecionavel no CMS, e
 * invisivel na pagina publicada, sem erro nenhum. Um por um, cada um custou uma
 * investigacao.
 *
 * A DEFESA E ESTRUTURAL, NAO UMA LISTA. A varredura e DERIVADA da uniao do
 * contrato (`publishedEditorialBlock.options`), entao um tipo de bloco novo que
 * ninguem cobriu faz este arquivo falhar — em vez de nascer como o quinto
 * defeito da serie. E o unico jeito de a protecao nao envelhecer sozinha.
 */

import { describe, expect, it } from 'vitest'

import { buildArticleBodyBlocks } from '../../apps/web/src/lib/article-body-presenter.js'
import {
  publishedEditorialBlock,
  EMBED_PROVIDERS,
} from '../../packages/editorial-contracts/src/blocks.js'

/* ------------------------------------------------------------------ */
/* A uniao, lida do CONTRATO                                           */
/* ------------------------------------------------------------------ */

/** Os `type` que a uniao publicada aceita, extraidos dela mesma. */
function contractBlockTypes(): readonly string[] {
  const options = (publishedEditorialBlock as unknown as { options: readonly unknown[] }).options
  return options.map((option) => {
    const shape = (option as { shape: Record<string, { value?: unknown }> }).shape
    return String(shape.type?.value ?? '')
  })
}

/* ------------------------------------------------------------------ */
/* Fixtures minimas, uma por tipo                                      */
/* ------------------------------------------------------------------ */

const media = {
  publicPath: '/media/editorial/foto.jpg',
  alt: 'descrição da foto',
  width: 800,
  height: 600,
}

/**
 * Uma instancia minima de cada bloco, na FORMA QUE O SITE RECEBE.
 *
 * DISTINCAO QUE ESTA VARREDURA REVELOU: a forma do contrato NAO e a forma que
 * chega ao renderer. O worker de projecao reescreve blocos antes de gravar —
 * `mediaRef` vira `publicPath` + dimensoes, `sourceRefs` vira `sources` já
 * resolvidas com nome e URL. Um teste que usasse a forma do CONTRATO acusaria
 * "o site nao desenha sourceList" quando o site desenha perfeitamente; e o
 * inverso tambem seria possivel, escondendo um defeito real.
 *
 * Por isso as fixtures abaixo sao pos-projecao, e as que divergem estao
 * marcadas.
 *
 * Falta de entrada aqui NAO e tolerada: o teste de cobertura exige uma fixture
 * para cada membro da uniao — e isso que impede a varredura de envelhecer.
 */
const FIXTURES: Record<string, Record<string, unknown>> = {
  paragraph: { type: 'paragraph', text: 'Texto do parágrafo.' },
  heading: { type: 'heading', level: 2, text: 'Subtítulo' },
  image: { type: 'image', ...media },
  video: { type: 'video', provider: 'youtube', externalId: 'dQw4w9WgXcQ' },
  quote: { type: 'quote', text: 'Citação.' },
  entityCard: { type: 'entityCard', entityKind: 'movie', entityId: '1', note: 'Nota editorial.' },
  factBox: { type: 'factBox', title: 'Ficha', items: [{ label: 'Estreia', value: '2026' }] },
  relatedContent: { type: 'relatedContent', articleRefs: ['1'] },
  // POS-PROJECAO: o worker troca `sourceRefs` por `sources` resolvidas.
  sourceList: { type: 'sourceList', sources: [{ name: 'Variety', url: 'https://variety.com/x' }] },
  divider: { type: 'divider' },
  list: { type: 'list', ordered: false, items: ['um', 'dois'] },
  gallery: { type: 'gallery', items: [{ ...media }] },
  embed: {
    type: 'embed',
    provider: 'youtube',
    externalId: 'dQw4w9WgXcQ',
    canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    originalUrl: 'https://youtu.be/dQw4w9WgXcQ',
  },
}

/**
 * Hidratacao suficiente para os blocos que dependem dela.
 *
 * A FORMA e a de `ArticleBodyHydration`, nao uma inventada: o primeiro rascunho
 * deste arquivo passou um objeto com chaves plausiveis (`articles`, `media`,
 * `sources`) e o presenter estourou em `undefined.get`. Fixture com forma errada
 * testaria outra coisa.
 */
const hydration = {
  entityCards: new Map([
    // A forma e `NewsEntityCardInput`: ficha honesta exige titulo e slug REAIS.
    ['movie:1', {
      entityType: 'movie', id: '1', titleOriginal: 'Filme de teste',
      translationTitle: 'Filme de teste', summary: null, slug: 'filme-de-teste',
      posterPath: null, year: 2026, seasonCount: null,
    }],
    ['tv:1', {
      entityType: 'tv', id: '1', titleOriginal: 'Série de teste',
      translationTitle: 'Série de teste', summary: null, slug: 'serie-de-teste',
      posterPath: null, year: 2026, seasonCount: 2,
    }],
  ]),
  relatedArticles: new Map([['1', { title: 'Outra matéria', slug: 'outra-materia' }]]),
}

function render(block: Record<string, unknown>): ReturnType<typeof buildArticleBodyBlocks> {
  return buildArticleBodyBlocks([{ id: 'sweep-1', ...block }], hydration as never)
}

/* ------------------------------------------------------------------ */

describe('varredura: a cobertura nao pode envelhecer', () => {
  it('TODO membro da uniao tem fixture — tipo novo sem cobertura FALHA aqui', () => {
    const semFixture = contractBlockTypes().filter((type) => FIXTURES[type] === undefined)
    expect(
      semFixture,
      `bloco(s) no contrato sem fixture na varredura: ${semFixture.join(', ')}. ` +
        'Acrescente a fixture e confirme que o renderer desenha — foi assim que os ' +
        'quatro defeitos anteriores entraram.',
    ).toEqual([])
  })

  it('CONTROLE NEGATIVO: a leitura da uniao realmente encontra tipos', () => {
    // Sem isto, um `contractBlockTypes()` quebrado devolveria `[]` e o teste
    // acima passaria vazio — a varredura inteira viraria teatro.
    const types = contractBlockTypes()
    expect(types.length).toBeGreaterThanOrEqual(10)
    expect(types).toContain('paragraph')
    expect(types).toContain('embed')
  })
})

describe('varredura: todo bloco do contrato SOBREVIVE ao renderer', () => {
  it('nenhum tipo legal desaparece', () => {
    const sumiram: string[] = []
    for (const type of contractBlockTypes()) {
      const fixture = FIXTURES[type]
      if (fixture === undefined) continue
      if (render(fixture).length === 0) sumiram.push(type)
    }
    expect(
      sumiram,
      `tipo(s) legal(is) no contrato que o site NAO desenha: ${sumiram.join(', ')}`,
    ).toEqual([])
  })
})

describe('varredura de VALORES: onde os quatro defeitos moravam', () => {
  it('todos os 7 entityKind sobrevivem (ficha ou nota)', () => {
    // Antes da F12, cinco destes sumiam levando a nota junto.
    const sumiram: string[] = []
    for (const entityKind of ['movie', 'tv', 'season', 'episode', 'person', 'character', 'franchise']) {
      const drawn = render({ ...FIXTURES.entityCard, entityKind })
      if (drawn.length === 0) sumiram.push(entityKind)
    }
    expect(sumiram, `entityKind que somem: ${sumiram.join(', ')}`).toEqual([])
  })

  it('todos os 3 provider de video sobrevivem quando ha destino', () => {
    // `internal` sumia ate com URL. Cada provider recebe o destino que lhe cabe.
    const casos: readonly Record<string, unknown>[] = [
      { provider: 'youtube', externalId: 'dQw4w9WgXcQ' },
      { provider: 'vimeo', externalId: '123456789' },
      { provider: 'internal', url: 'https://cdn.cinerie.com/v.mp4' },
    ]
    const sumiram: string[] = []
    for (const caso of casos) {
      if (render({ type: 'video', ...caso }).length === 0) sumiram.push(String(caso.provider))
    }
    expect(sumiram, `provider de video que somem: ${sumiram.join(', ')}`).toEqual([])
  })

  it('todos os provider de embed sobrevivem — derivados do contrato', () => {
    const sumiram: string[] = []
    for (const provider of EMBED_PROVIDERS) {
      const drawn = render({ ...FIXTURES.embed, provider, externalId: 'dQw4w9WgXcQ' })
      if (drawn.length === 0) sumiram.push(provider)
    }
    expect(sumiram, `provider de embed que somem: ${sumiram.join(', ')}`).toEqual([])
  })

  it('todos os niveis de heading sobrevivem', () => {
    for (const level of [2, 3, 4]) {
      expect(render({ type: 'heading', level, text: 'x' }), String(level)).toHaveLength(1)
    }
  })
})

describe('a varredura tem dentes', () => {
  it('CONTROLE NEGATIVO: um tipo inexistente REALMENTE some', () => {
    // Prova que `render` descarta o desconhecido. Sem isto, a varredura poderia
    // estar passando porque o presenter aceita qualquer coisa — e nao porque os
    // blocos do contrato estao cobertos.
    expect(render({ type: 'bloco_que_nao_existe' })).toHaveLength(0)
  })

  it('CONTROLE NEGATIVO: bloco valido de forma mas VAZIO some', () => {
    // O detector precisa distinguir "tipo suportado" de "conteudo utilizavel".
    expect(render({ type: 'paragraph', text: '   ' })).toHaveLength(0)
    expect(render({ type: 'list', ordered: false, items: [] })).toHaveLength(0)
  })
})
