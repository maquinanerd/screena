/**
 * paragraph-marks.integration.test.ts — A formatacao inline CHEGA na coluna?
 *
 * A pergunta e estreita de proposito, e ela nao tem resposta em teste puro. Os
 * testes de unidade ja provam que a aritmetica de offset esta certa e que o
 * mapper copia `marks`. O que so o Payload real responde e se ele ACEITA o
 * campo novo — e a resposta dele, quando nao aceita, e o SILENCIO: em
 * `payload/dist/fields/hooks/beforeChange/promise.js` um campo que a config nao
 * declara simplesmente nao e percorrido, sem erro e sem log. Foi exatamente
 * assim que todo draft do MNScr gravou corpo vazio respondendo 201.
 *
 * Por isso a assercao central e um IDA E VOLTA pelo banco: grava, RELE do
 * Postgres e compara. Conferir o retorno do `create` provaria so que o Payload
 * devolveu o que recebeu.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { startCmsHarness, type CmsHarness } from './harness.js'

let harness: CmsHarness
let payload: Payload
let chiefId = 0

const TEXT = 'O filme Duna e otimo.'
const MARKS = [
  { start: 8, end: 12, type: 'bold' },
  { start: 8, end: 12, type: 'link', href: 'https://cinerie.com/duna' },
]

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload

  // Escrita editorial exige ator autenticado (`access.ts`). O teste passa pelo
  // mesmo portao do painel, e nao por `overrideAccess`: gravar por fora do
  // controle de acesso provaria a coluna, mas nao o caminho real.
  const chief = await payload.create({
    collection: 'editorial-users',
    data: {
      email: 'chief-marks@cinerie.test',
      password: 'senha-de-teste-chief-0123456789',
      displayName: 'chefe',
      role: 'editor_in_chief',
      active: true,
    } as never,
    overrideAccess: true,
  })
  chiefId = Number(chief.id)
}, 180_000)

afterAll(async () => {
  await harness?.stop()
})

async function chief() {
  const doc = await payload.findByID({
    collection: 'editorial-users',
    id: chiefId,
    overrideAccess: true,
  })
  return { ...doc, collection: 'editorial-users' } as never
}

/** Cria uma materia com UM paragrafo e devolve o id. */
async function createArticle(marks: unknown): Promise<number | string> {
  const created = await payload.create({
    collection: 'articles',
    data: {
      title: `Marcacoes ${randomUUID().slice(0, 8)}`,
      slug: `marcacoes-${randomUUID().slice(0, 8)}`,
      summary: 'Resumo de teste para formatacao inline.',
      body: [
        {
          blockType: 'paragraph',
          blockId: 'blk-1',
          text: TEXT,
          ...(marks === undefined ? {} : { marks }),
        },
      ],
    } as never,
    user: await chief(),
  })
  return created.id
}

/** Rele do banco, sem cache do `create`. */
async function readParagraph(id: number | string): Promise<Record<string, unknown>> {
  const article = (await payload.findByID({
    collection: 'articles',
    id,
    overrideAccess: true,
  })) as unknown as { body?: Record<string, unknown>[] }
  const block = article.body?.[0]
  if (block === undefined) throw new Error('paragrafo ausente depois de reler')
  return block
}

describe('marcacoes inline atravessam o Payload e o Postgres', () => {
  it('grava e RELE as marcacoes intactas', async () => {
    const id = await createArticle(MARKS)
    const block = await readParagraph(id)

    expect(block.text).toBe(TEXT)
    // A assercao que importa: a coluna `marks` existe, e jsonb, e devolveu o
    // mesmo conteudo — nao `null`, nao `[]`, nao `"[object Object]"`.
    expect(block.marks).toEqual(MARKS)
  })

  it('o texto gravado continua LIMPO, sem nenhuma tag', async () => {
    const block = await readParagraph(await createArticle(MARKS))
    expect(String(block.text)).not.toMatch(/[<>]/)
  })

  it('paragrafo sem marcacao continua valendo (artigo antigo)', async () => {
    const block = await readParagraph(await createArticle(undefined))
    expect(block.text).toBe(TEXT)
    // Nulo ou ausente: o que nao pode e a linha deixar de existir.
    expect(block.marks ?? null).toBeNull()
  })

  it('sobrevive ao UPDATE, e nao so ao INSERT', async () => {
    // Payload grava blocos apagando e reinserindo as linhas filhas; um campo que
    // funciona no create e some no update seria invisivel no teste acima.
    const id = await createArticle(undefined)
    await payload.update({
      collection: 'articles',
      id,
      data: {
        body: [{ blockType: 'paragraph', blockId: 'blk-1', text: TEXT, marks: MARKS }],
      } as never,
      user: await chief(),
    })
    expect((await readParagraph(id)).marks).toEqual(MARKS)
  })

  it('remover a formatacao zera a coluna, em vez de deixar o valor velho', async () => {
    const id = await createArticle(MARKS)
    await payload.update({
      collection: 'articles',
      id,
      data: {
        body: [{ blockType: 'paragraph', blockId: 'blk-1', text: TEXT, marks: null }],
      } as never,
      user: await chief(),
    })
    expect((await readParagraph(id)).marks ?? null).toBeNull()
  })
})
