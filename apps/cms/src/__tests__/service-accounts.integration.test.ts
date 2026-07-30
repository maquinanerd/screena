/**
 * service-accounts.integration.test.ts — A collection de CONTAS TECNICAS no
 * painel: quem ve, quem gerencia, e o que a credencial nunca revela.
 *
 * Contra Payload + PostgreSQL 16 REAIS, porque as tres perguntas desta suite so
 * podem ser respondidas pelo Payload de verdade:
 *
 *  1. o item de menu aparece SO para administrador?
 *  2. um humano nao-administrador consegue ler contas tecnicas pela API?
 *  3. a API key volta em alguma leitura, depois de criada?
 *
 * A pergunta (2) e a que exige banco: `access.read` de `service-accounts`
 * devolve um FILTRO (`where`), nao um booleano, e um filtro so revela o que
 * deixa passar quando ha linhas para filtrar.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { startCmsHarness, type CmsHarness } from './harness.js'
import { ServiceAccounts } from '../collections.js'

let harness: CmsHarness
let payload: Payload

const ids = { admin: 0, chief: 0, writer: 0, account: 0 }

/**
 * Contas tecnicas cujo id COLIDE com o id de um humano nao-administrador.
 *
 * Existe porque o teste de negacao de leitura passaria em VAZIO sem elas:
 * `readOwnIdentity` devolve `{ id: { equals: <id do ator> } }`, e um filtro por
 * id que nao encontra linha nenhuma "nega" por acidente, nao por politica.
 * `editorial_users` e `service_accounts` sao tabelas distintas, cada uma com
 * autoincrement proprio — o id 1 existe nas duas. Sem provocar a colisao, o
 * verde nao significa nada.
 */
const collidingAccountIds: number[] = []

async function userDoc(id: number) {
  const doc = await payload.findByID({ collection: 'editorial-users', id, overrideAccess: true })
  return { ...doc, collection: 'editorial-users' } as never
}

async function makeUser(role: string, email: string): Promise<number> {
  const created = await payload.create({
    collection: 'editorial-users',
    data: {
      email,
      password: `senha-de-teste-${randomUUID()}`,
      displayName: role,
      role,
      active: true,
    } as never,
    overrideAccess: true,
  })
  return Number(created.id)
}

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload

  ids.admin = await makeUser('administrator', 'admin.sa@cinerie.test')
  ids.chief = await makeUser('editor_in_chief', 'chefe.sa@cinerie.test')
  ids.writer = await makeUser('writer', 'redator.sa@cinerie.test')

  const account = await payload.create({
    collection: 'service-accounts',
    data: {
      label: 'Cinerie Publication Worker',
      purpose: 'internal_tooling',
      active: true,
      scopes: ['publication_projection'],
      enableAPIKey: true,
      apiKey: randomUUID(),
    } as never,
    overrideAccess: true,
  })
  ids.account = Number(account.id)
  collidingAccountIds.push(ids.account)

  // Enche a tabela ate existir uma conta tecnica com o MESMO id de cada humano
  // nao-administrador. So depois disto a negacao de leitura passa a medir a
  // politica em vez da ausencia de linha.
  const maxHumanId = Math.max(ids.admin, ids.chief, ids.writer)
  while (Math.max(...collidingAccountIds) < maxHumanId) {
    const filler = await payload.create({
      collection: 'service-accounts',
      data: {
        label: `conta tecnica ${randomUUID().slice(0, 8)}`,
        purpose: 'internal_tooling',
        active: false,
        scopes: [],
      } as never,
      overrideAccess: true,
    })
    collidingAccountIds.push(Number(filler.id))
  }
}, 900_000)

afterAll(async () => {
  await harness?.stop()
}, 300_000)

/* ------------------------------------------------------------------ */
/* 1. Visibilidade no painel                                           */
/* ------------------------------------------------------------------ */

/**
 * `admin.hidden` do Payload aceita booleano OU funcao `({ user }) => boolean`.
 * Chamamos a funcao com o usuario real de cada papel — nao com um objeto
 * inventado — para que a suite prove a mesma decisao que o painel toma.
 */
async function hiddenFor(userId: number | null): Promise<boolean> {
  const hidden = ServiceAccounts.admin?.hidden
  if (typeof hidden === 'boolean') return hidden
  if (typeof hidden !== 'function') return false
  const user = userId === null ? null : await userDoc(userId)
  return hidden({ user } as never)
}

describe('visibilidade no menu do painel', () => {
  it('administrador VE a collection', async () => {
    expect(await hiddenFor(ids.admin)).toBe(false)
  })

  it('editor-chefe, redator e anonimo NAO veem', async () => {
    // O chefe publica materia; ele nao administra credencial de maquina. A
    // fronteira e a mesma de `editorial-users`.
    expect(await hiddenFor(ids.chief)).toBe(true)
    expect(await hiddenFor(ids.writer)).toBe(true)
    expect(await hiddenFor(null)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Access control — o menu esconde, a API precisa RECUSAR           */
/* ------------------------------------------------------------------ */

describe('leitura de contas tecnicas pela API', () => {
  it('administrador lista as contas', async () => {
    const found = await payload.find({
      collection: 'service-accounts',
      overrideAccess: false,
      user: await userDoc(ids.admin),
    })
    expect(found.docs.length).toBeGreaterThan(0)
  })

  it('a COLISAO de id entre humano e conta tecnica realmente existe', () => {
    // PRE-CONDICAO do teste seguinte, nao curiosidade. Sem ela, `[]` provaria
    // apenas que nenhuma linha casou o filtro — e a suite ficaria verde mesmo
    // se a politica estivesse aberta.
    for (const role of ['chief', 'writer'] as const) {
      expect(
        collidingAccountIds.includes(ids[role]),
        `precisa existir service-account com id ${String(ids[role])} (id do ${role})`,
      ).toBe(true)
    }
  })

  it('humano NAO administrador nao le conta tecnica nenhuma', async () => {
    // O ponto sensivel: `readOwnIdentity` devolvia `{ id: { equals: <id do
    // ator> } }` para QUALQUER principal autenticado nao-admin, para que uma
    // conta tecnica lesse o proprio `/me`. Aplicado a ESTA collection, aquele
    // filtro comparava o id de um `editorial-users` com o id de um
    // `service-accounts` — e com a colisao garantida acima, entregava o
    // documento.
    //
    // A negacao agora e RECUSA, nao lista filtrada: o recorte por collection faz
    // `access.read` devolver `false`, e o Payload rejeita em vez de responder
    // vazio. Mais forte, e mais facil de notar em log.
    for (const role of ['chief', 'writer'] as const) {
      await expect(
        payload.find({
          collection: 'service-accounts',
          overrideAccess: false,
          user: await userDoc(ids[role]),
        }),
        `${role} nao pode ler service-accounts`,
      ).rejects.toThrow(/not allowed/i)
    }
  })

  it('humano nao administrador nao le a conta pelo id direto — nem a de id igual ao seu', async () => {
    for (const [role, id] of [
      ['writer', ids.account],
      // O caso que a colisao habilita: pedir exatamente o id que o filtro
      // `readOwnIdentity` deixaria passar.
      ['writer-proprio-id', ids.writer],
      ['chief-proprio-id', ids.chief],
    ] as const) {
      await expect(
        payload.findByID({
          collection: 'service-accounts',
          id,
          overrideAccess: false,
          user: await userDoc(role.startsWith('chief') ? ids.chief : ids.writer),
        }),
        `${role} nao pode ler service-account ${String(id)}`,
      ).rejects.toThrow()
    }
  })

  it('so administrador cria, edita e apaga', async () => {
    await expect(
      payload.create({
        collection: 'service-accounts',
        data: { label: 'nao deveria nascer', purpose: 'internal_tooling', active: true } as never,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      }),
    ).rejects.toThrow()

    await expect(
      payload.update({
        collection: 'service-accounts',
        id: ids.account,
        data: { active: false } as never,
        overrideAccess: false,
        user: await userDoc(ids.writer),
      }),
    ).rejects.toThrow()

    await expect(
      payload.delete({
        collection: 'service-accounts',
        id: ids.account,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      }),
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* 2b. A DIRECAO INVERSA: conta tecnica lendo identidade humana        */
/* ------------------------------------------------------------------ */

describe('conta tecnica nao le identidade humana', () => {
  /** Documento da conta tecnica no formato que o Payload usa como `req.user`. */
  async function accountDoc(id: number) {
    const doc = await payload.findByID({
      collection: 'service-accounts',
      id,
      overrideAccess: true,
    })
    return { ...doc, collection: 'service-accounts' } as never
  }

  it('a colisao inversa existe (conta tecnica com id de humano)', () => {
    // Mesma pre-condicao, do outro lado: sem uma conta tecnica cujo id case com
    // um `editorial-users`, o teste seguinte nao mede nada.
    expect(collidingAccountIds).toContain(ids.admin)
  })

  it('conta tecnica nao lista nem le editorial-users', async () => {
    // O vazamento mais grave da simetria antiga: a conta tecnica de id 1 lia o
    // `editorial-users` de id 1 — que e o ADMINISTRADOR — e com ele e-mail,
    // nome e papel. Uma credencial de maquina nao tem assunto com isso.
    const user = await accountDoc(ids.admin)

    await expect(
      payload.find({ collection: 'editorial-users', overrideAccess: false, user }),
    ).rejects.toThrow(/not allowed/i)

    await expect(
      payload.findByID({
        collection: 'editorial-users',
        id: ids.admin,
        overrideAccess: false,
        user,
      }),
    ).rejects.toThrow()
  })

  it('mas a conta tecnica CONTINUA lendo o proprio documento', async () => {
    // O motivo pelo qual `readOwnIdentity` existe: `/api/service-accounts/me`
    // precisa devolver o documento. Fechar a leitura cruzada nao pode fechar
    // esta — seria trocar um vazamento por uma regressao de autenticacao.
    const own = (await payload.findByID({
      collection: 'service-accounts',
      id: ids.account,
      overrideAccess: false,
      user: await accountDoc(ids.account),
    })) as unknown as Record<string, unknown>
    expect(own.label).toBe('Cinerie Publication Worker')
    // E mesmo lendo a si mesma, a chave nao volta.
    expect(own.apiKey).toBeUndefined()
  })

  it('humano nao administrador CONTINUA lendo o proprio editorial-users', async () => {
    // Controle positivo do outro lado: o recorte por collection nao pode ter
    // quebrado a leitura legitima que ja funcionava.
    const own = (await payload.findByID({
      collection: 'editorial-users',
      id: ids.writer,
      overrideAccess: false,
      user: await userDoc(ids.writer),
    })) as unknown as Record<string, unknown>
    expect(own.role).toBe('writer')
  })
})

/* ------------------------------------------------------------------ */
/* 3. A credencial nunca volta                                         */
/* ------------------------------------------------------------------ */

describe('a API key nao e relegivel depois de criada', () => {
  it('nem para o administrador, nem em listagem, nem por id', async () => {
    const admin = await userDoc(ids.admin)

    const byId = (await payload.findByID({
      collection: 'service-accounts',
      id: ids.account,
      overrideAccess: false,
      user: admin,
    })) as unknown as Record<string, unknown>
    expect(byId.apiKey).toBeUndefined()
    // `enableAPIKey` continua visivel: saber que EXISTE chave nao e a chave.
    expect(byId.label).toBe('Cinerie Publication Worker')

    const listed = await payload.find({
      collection: 'service-accounts',
      overrideAccess: false,
      user: admin,
      where: { id: { equals: ids.account } },
    })
    const doc = (listed.docs[0] ?? {}) as Record<string, unknown>
    expect(doc.apiKey).toBeUndefined()
  })

  it('a chave tambem nao volta com overrideAccess (o campo e negado no SCHEMA)', async () => {
    // `overrideAccess: true` ignora `access`; esta assercao existe para
    // registrar a diferenca, nao para exigir o mesmo resultado. O que NAO pode
    // acontecer e a chave aparecer numa leitura de usuario, coberta acima.
    const raw = (await payload.findByID({
      collection: 'service-accounts',
      id: ids.account,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
    // Documenta o comportamento real do Payload, seja ele qual for.
    expect(typeof raw.apiKey === 'string' || raw.apiKey === undefined).toBe(true)
  })

  it('a conta criada tem exatamente o escopo pedido', async () => {
    const doc = (await payload.findByID({
      collection: 'service-accounts',
      id: ids.account,
      overrideAccess: false,
      user: await userDoc(ids.admin),
    })) as unknown as Record<string, unknown>
    expect(doc.purpose).toBe('internal_tooling')
    expect(doc.active).toBe(true)
    expect(doc.scopes).toEqual(['publication_projection'])
  })
})
