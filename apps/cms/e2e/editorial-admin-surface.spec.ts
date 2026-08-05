/**
 * editorial-admin-surface.spec.ts — os componentes do painel, num navegador.
 *
 * O `manual-editorial.spec.ts` prova que o FLUXO funciona; ele faz as transicoes
 * pela REST API, entao passaria igual se a barra de transicao nao existisse.
 * Este arquivo prova o contrario: que a INTERFACE nova faz o que promete.
 *
 * Por que isso ganhou teste proprio: os seis componentes foram escritos, o
 * typecheck passou, o lint passou, os testes puros passaram — e nenhum deles
 * renderizava. Uma chave de import map sem o sufixo `#default` faz o Payload
 * devolver `undefined` e desenhar NADA, sem erro no navegador. Tipo nao basta;
 * so o DOM responde.
 *
 * DIVISAO DE TRABALHO: o estado que o gate de publicacao exige (autor, capa,
 * corpo, QA, fontes) e montado pela REST API com a sessao do navegador — e
 * cenario, nao objeto de teste. O que se opera pela TELA e exatamente aquilo que
 * este arquivo mede.
 */

import { expect, test, type Page } from '@playwright/test'

import { readState } from './state.js'

const state = readState()
const BASE = state.baseUrl
const RUN = Date.now().toString(36)

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  // Trocar de usuario limpando o COOKIE, nao visitando `/admin/logout`: aquela
  // rota nao devolve o formulario de login, e a espera por `#field-email`
  // ficava pendurada ate o timeout — uma falha que parece do produto e e do
  // teste.
  await page.context().clearCookies()
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('#field-email').fill(email)
  await page.locator('#field-password').fill(password)
  await page.getByRole('button', { name: /login|entrar/i }).click()
  await page.waitForURL(/\/admin\/?(\?.*)?$/, { timeout: 30_000 })
  await expect(page.locator('.dashboard')).toBeVisible({ timeout: 30_000 })
}

async function login(page: Page): Promise<void> {
  await loginAs(page, state.admin.email, state.admin.password)
}

interface ApiResult {
  status: number
  text: string
  json: Record<string, unknown>
}

/**
 * O JWT da sessao aberta na tela.
 *
 * O cookie `payload-token` SOZINHO nao autentica a REST API do Payload — ela le
 * a credencial do header `Authorization`. Sem ele a resposta e 403 "not
 * allowed", indistinguivel de uma negacao de permissao de verdade; foi
 * exatamente esse 403 que me fez procurar bug de access control onde havia
 * header faltando.
 */
async function sessionToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies(BASE)
  const token = cookies.find((cookie) => cookie.name === 'payload-token')?.value ?? ''
  if (token === '') throw new Error('sessao do painel sem cookie payload-token')
  return token
}

async function api(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: unknown,
): Promise<ApiResult> {
  const response = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      Authorization: `JWT ${await sessionToken(page)}`,
    },
    ...(data === undefined ? {} : { data }),
  })
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* resposta nao-JSON: `text` preserva o motivo */
  }
  return { status: response.status(), text, json }
}

/** Autor publico aprovado para assinar. */
async function createAuthor(page: Page, suffix: string): Promise<string> {
  const created = await api(page, 'POST', '/api/authors', {
    name: `Redacao ${suffix}`,
    slug: `redacao-${suffix}`,
  })
  expect(created.status, created.text.slice(0, 400)).toBeLessThan(400)
  return String((created.json.doc as { id: unknown }).id)
}

/**
 * Materia pronta para publicar, montada por API.
 *
 * `licenseStatus` da capa e parametro porque o cenario 4.4 depende justamente de
 * uma capa NAO liberada.
 */
async function readyArticle(
  page: Page,
  suffix: string,
  options: { mediaLicense: 'approved' | 'unknown' } = { mediaLicense: 'approved' },
): Promise<{ articleId: string; authorId: string; mediaId: string }> {
  const authorId = await createAuthor(page, suffix)

  // MIDIA E COLECAO DE UPLOAD: `POST` com JSON puro leva "No files were
  // uploaded". O arquivo entra pelo formulario, como uma pessoa faria.
  await page.goto(`${BASE}/admin/collections/media/create`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="file"]').setInputFiles(state.mediaFixturePath)
  await page.locator('#field-alt').fill(`Cena ${suffix}`)
  await page.locator('#field-credit').fill('Divulgacao')
  const saved = page.waitForResponse(
    (res) => /\/api\/media/.test(res.url()) && res.request().method() === 'POST',
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: /^(save|salvar|create|criar)/i }).first().click()
  expect((await saved).status()).toBeLessThan(400)
  await page.waitForURL(/\/collections\/media\/\d+$/, { timeout: 60_000 })
  const mediaId = page.url().split('/').pop() as string

  // Licenca e ato editorial EXPLICITO, e o default e fechado. O cenario 4.4
  // depende justamente de deixar como nasceu.
  if (options.mediaLicense === 'approved') {
    const licensed = await api(page, 'PATCH', `/api/media/${mediaId}`, {
      licenseStatus: 'approved',
      allowedForEditorial: true,
      allowedForHero: true,
      requiresAttribution: false,
      provenanceType: 'cinerie_editorial',
    })
    expect(licensed.status, licensed.text.slice(0, 400)).toBe(200)
  }

  const article = await api(page, 'POST', '/api/articles', {
    title: `Materia ${suffix}`,
    slug: `materia-${suffix}`,
    summary: 'Resumo editorial proprio, escrito na redacao para este cenario.',
    contentType: 'news',
    language: 'pt-BR',
    metaTitle: `Titulo de busca da materia ${suffix}`,
    metaDescription: 'Descricao propria da materia, escrita sem copiar sinopse de terceiro.',
    focusKeyphrase: 'estreia da temporada',
    articleSection: 'Series',
    body: [
      { blockType: 'paragraph', blockId: 'p-1', text: 'Abertura escrita por uma pessoa.' },
      { blockType: 'paragraph', blockId: 'p-2', text: 'Fechamento com o proximo passo.' },
    ],
    heroMedia: Number(mediaId),
    authors: [Number(authorId)],
    primaryAuthor: Number(authorId),
    qaPassedAt: new Date().toISOString(),
    externalSources: [
      { sourceId: 's-1', name: 'Variety', url: 'https://variety.com/exemplo', role: 'primary' },
    ],
  })
  expect(article.status, article.text.slice(0, 600)).toBeLessThan(400)
  return { articleId: String((article.json.doc as { id: unknown }).id), authorId, mediaId }
}

/**
 * Rotulos EXATOS dos botoes, na ordem em que a redacao os aperta.
 *
 * Vem de `TRANSITION_LABELS`. Casar por regex solta (`/revis/i`) pegava dois
 * botoes ao mesmo tempo ("Enviar para revisão" e "Assumir a revisão") — o
 * seletor precisa ser tao especifico quanto o clique real.
 */
const PUBLISH_PATH = [
  'Enviar para revisão',
  'Assumir a revisão',
  'Aprovar revisão',
  'Liberar para publicação',
  'Publicar',
] as const

/** Clica um botao da barra de transicao e espera o servidor responder. */
async function clickTransition(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label, exact: true })
  await expect(button).toBeEnabled({ timeout: 20_000 })
  const settled = page.waitForResponse(
    (res) => /\/api\/articles\//.test(res.url()) && res.request().method() === 'PATCH',
    { timeout: 60_000 },
  )
  await button.click()
  await settled
}

/* ------------------------------------------------------------------ */
/* 4.0 — O botao "Publicar" sobe a escada inteira num clique          */
/* ------------------------------------------------------------------ */

/*
 * O teste de integracao ja prova o SERVIDOR: cinco degraus, rastro completo,
 * um evento na outbox. O que so o navegador prova e que o botao existe na
 * tela, esta habilitado e dispara o endpoint certo — foi exatamente aqui que
 * a primeira versao quebrou, com dois botoes chamados "Publicar" na mesma
 * barra e um seletor ambiguo.
 */
test('o botao "Publicar" leva a materia de draft a published num clique', async ({ page }) => {
  test.setTimeout(240_000)
  await login(page)

  const { articleId } = await readyArticle(page, `um-clique-${RUN}`)
  await page.goto(`${BASE}/admin/collections/articles/${articleId}`, {
    waitUntil: 'domcontentloaded',
  })

  await expect(page.locator('.cinerie-workflow')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.cinerie-workflow__badge')).toHaveAttribute('data-status', 'draft')

  // Selecao por CLASSE, nao por nome: a barra tem outros botoes, e o rotulo
  // "Publicar" volta a existir sozinho quando so falta um degrau.
  const oneClick = page.locator('.cinerie-workflow__action.is-publish-now')
  await expect(oneClick).toHaveCount(1)
  await expect(oneClick).toBeEnabled({ timeout: 20_000 })

  const settled = page.waitForResponse(
    (res) => res.url().includes('/api/internal/publish-now') && res.request().method() === 'POST',
    { timeout: 120_000 },
  )
  await oneClick.click()
  const response = await settled
  // SO o status. O componente recarrega a pagina no sucesso, e a navegacao
  // descarta o corpo da resposta antes que o Playwright consiga le-lo
  // (`Network.getResponseBody: No resource with given identifier found`).
  // O `status()` sobrevive porque ja veio nos headers; quem prova o desfecho
  // e o badge logo abaixo, que le o documento recarregado.
  expect(response.status()).toBe(200)

  // A tela recarrega sozinha; o badge tem de acompanhar o documento.
  await expect(page.locator('.cinerie-workflow__badge')).toHaveAttribute(
    'data-status',
    'published',
    { timeout: 60_000 },
  )

  // Leitura SEM `draft=true`: o que importa e o documento principal.
  const doc = (await api(page, 'GET', `/api/articles/${articleId}?depth=0`)).json
  expect(doc.workflowStatus, 'documento PRINCIPAL, nao a versao').toBe('published')
  expect(doc._status).toBe('published')
})

/* ------------------------------------------------------------------ */
/* 4.1 — A barra de transicao muda o DOCUMENTO, nao so a versao       */
/* ------------------------------------------------------------------ */

test('a barra leva a materia ate published, e o documento principal muda', async ({ page }) => {
  test.setTimeout(240_000)
  await login(page)

  const { articleId } = await readyArticle(page, `bar-${RUN}`)
  await page.goto(`${BASE}/admin/collections/articles/${articleId}`, {
    waitUntil: 'domcontentloaded',
  })

  // A barra EXISTE. Esta assercao sozinha teria pego o defeito do import map.
  const bar = page.locator('.cinerie-workflow')
  await expect(bar).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.cinerie-workflow__badge')).toHaveAttribute('data-status', 'draft')

  // Sobe estado por estado, PELOS BOTOES.
  for (const label of PUBLISH_PATH) {
    const status = await page.locator('.cinerie-workflow__badge').getAttribute('data-status')
    if (status === 'published') break
    await clickTransition(page, label)
    await page.waitForTimeout(500)
  }

  await expect(page.locator('.cinerie-workflow__badge')).toHaveAttribute(
    'data-status',
    'published',
    { timeout: 30_000 },
  )

  /* --- A PERGUNTA QUE IMPORTA -------------------------------------- */
  //
  // O autosave desta collection grava na tabela de VERSOES. Uma barra que
  // submetesse pela action padrao mostraria "published" na tela com o documento
  // principal ainda em `draft` — verde na interface, nada no ar. Por isso a
  // leitura e SEM `draft=true`.
  const doc = (await api(page, 'GET', `/api/articles/${articleId}?depth=0`)).json
  expect(doc.workflowStatus, 'documento PRINCIPAL, nao a versao').toBe('published')
  expect(doc._status).toBe('published')
  expect(typeof doc.publishedAt).toBe('string')

  // E o evento saiu para a projecao.
  const outbox = await api(
    page,
    'GET',
    `/api/publication-outbox?where[aggregateId][equals]=${articleId}&depth=0`,
  )
  expect(outbox.status).toBe(200)
  expect(
    (outbox.json.docs as unknown[]).length,
    'publicou mas nao gerou evento na outbox',
  ).toBeGreaterThan(0)
})

/* ------------------------------------------------------------------ */
/* 4.3 — Slug                                                          */
/* ------------------------------------------------------------------ */

test('a slug segue o titulo, para quando editada a mao, e nao volta ao reabrir', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page)

  await page.goto(`${BASE}/admin/collections/articles/create`, { waitUntil: 'domcontentloaded' })

  // 1. Gera a partir do titulo, ja normalizada (acento e maiuscula somem).
  await page.locator('#field-title').fill('Estreia de Ação já Confirmada')
  await expect(page.locator('#field-slug')).toHaveValue('estreia-de-acao-ja-confirmada', {
    timeout: 20_000,
  })

  // 2. Editada a mao: o acompanhamento para de vez.
  const manual = `slug-a-mao-${RUN}`
  await page.locator('#field-slug').fill(manual)
  await page.locator('#field-title').fill('Titulo Completamente Diferente Agora')
  await page.waitForTimeout(1500)
  await expect(page.locator('#field-slug')).toHaveValue(manual)

  // 3. Reabrir NAO religa o automatico: mexer no titulo de uma materia que ja
  //    tem endereco mudaria a URL de algo possivelmente publicado.
  await page.waitForURL(/\/collections\/articles\/\d+$/, { timeout: 90_000 })
  const articleId = page.url().split('/').pop() as string

  // ESPERAR O AUTOSAVE CHEGAR AO BANCO antes de navegar. O autosave tem atraso
  // (2s); recarregar antes dele fecharia o teste em cima de um valor que ainda
  // nao saiu do formulario — e o `''` que voltaria seria culpa da pressa, nao
  // do componente. A leitura e com `draft=true`: autosave grava na tabela de
  // VERSOES, e sem a flag o campo volta nulo mesmo tendo sido salvo.
  const deadline = Date.now() + 60_000
  let persisted: unknown = null
  while (Date.now() < deadline) {
    persisted = (await api(page, 'GET', `/api/articles/${articleId}?depth=0&draft=true`)).json.slug
    if (persisted === manual) break
    await page.waitForTimeout(1_000)
  }
  expect(persisted, 'a slug digitada a mao nao chegou ao banco pelo autosave').toBe(manual)

  await page.goto(`${BASE}/admin/collections/articles/${articleId}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('#field-slug')).toHaveValue(manual, { timeout: 20_000 })
  await page.locator('#field-title').fill('Terceiro Titulo Depois De Reabrir')
  await page.waitForTimeout(1500)
  await expect(page.locator('#field-slug')).toHaveValue(manual)

  // 4. Colisao AVISA, sem bloquear e sem reescrever.
  //
  // O alvo da colisao e criado pela API de proposito: um rascunho digitado no
  // formulario vive na tabela de VERSOES ate ser promovido, e a consulta de
  // colisao le a colecao — ela nao enxergaria o vizinho, e o teste acusaria
  // ausencia de aviso onde nao ha nada com que colidir.
  const taken = `materia-ja-existente-${RUN}`
  const neighbour = await api(page, 'POST', '/api/articles', {
    title: 'Materia que ja ocupa o endereco',
    slug: taken,
    summary: 'Resumo da materia vizinha, que ja tem endereco.',
    contentType: 'news',
    language: 'pt-BR',
  })
  expect(neighbour.status, neighbour.text.slice(0, 400)).toBeLessThan(400)

  await page.goto(`${BASE}/admin/collections/articles/create`, { waitUntil: 'domcontentloaded' })
  await page.locator('#field-title').fill('Outra materia qualquer')
  await page.locator('#field-slug').fill(taken)
  await expect(page.locator('.cinerie-slug__problem')).toContainText(/já existe/i, {
    timeout: 20_000,
  })
  // AVISO, nao bloqueio: o valor digitado continua exatamente como estava.
  await expect(page.locator('#field-slug')).toHaveValue(taken)
})

/* ------------------------------------------------------------------ */
/* 4.4 — Midia sem licenca se anuncia ANTES do clique                 */
/* ------------------------------------------------------------------ */

test('capa sem licenca aparece como frase antes de tentar publicar', async ({ page }) => {
  test.setTimeout(240_000)
  await login(page)

  const { articleId } = await readyArticle(page, `midia-${RUN}`, { mediaLicense: 'unknown' })
  await page.goto(`${BASE}/admin/collections/articles/${articleId}`, {
    waitUntil: 'domcontentloaded',
  })

  // A frase existe SEM ninguem ter clicado em publicar. Descobrir isso pelo
  // `unauthorized_media` do servidor seria descobrir com o texto ja pronto.
  const notice = page.locator('.cinerie-media-notice, .cinerie-workflow__block')
  await expect(notice.first()).toBeVisible({ timeout: 30_000 })
  await expect(notice.first()).toContainText(/licen/i)

  // E aponta para onde resolver, em vez de so recusar.
  await expect(notice.first().locator('a, button')).toHaveCount(1, { timeout: 10_000 })
})

/* ------------------------------------------------------------------ */
/* 4.5 — Painel de automacao: por papel                                */
/* ------------------------------------------------------------------ */

test('o painel de automacao aparece para administrator e some para editor', async ({ page }) => {
  test.setTimeout(240_000)
  await login(page)

  // Administrator: o painel aparece.
  const panel = page.locator('.cinerie-automation')
  await expect(panel).toBeVisible({ timeout: 30_000 })

  // DOIS ESTADOS LEGITIMOS, e o teste aceita os dois pelo que cada um promete.
  //
  // Este harness sobe em `NODE_ENV=production` SEM as variaveis de
  // autopublicacao — de proposito: o `globalSetup` recusa subir com qualquer
  // variavel de automacao presente, para que um E2E nunca tropece em
  // configuracao que publique de verdade. Nesse ambiente o painel nao TEM
  // quota para ler.
  //
  // O que importa aqui e que ele nao minta: ou mostra os numeros, ou diz por
  // que nao pode mostra-los. Um painel que sumisse, ou que exibisse zero como
  // se fosse leitura boa, seria pior que qualquer um dos dois.
  const misconfigured = (await panel.getAttribute('class'))?.includes('is-misconfigured') === true
  if (misconfigured) {
    await expect(panel).toContainText(/inválida|invalida/i)
    await expect(panel).toContainText(/EDITORIAL_AUTO_PUBLISH/)
  } else {
    await expect(panel).toContainText(/quota|teto/i)
    await expect(panel).toContainText(/outbox|projec/i)
  }

  // Cria um `editor` e entra com ele.
  const editorEmail = `editor-${RUN}@exemplo.test`
  const editorPassword = `Editor!${RUN}aA1`
  const created = await api(page, 'POST', '/api/editorial-users', {
    email: editorEmail,
    password: editorPassword,
    role: 'editor',
    displayName: 'Editor de Teste',
  })
  expect(created.status, created.text.slice(0, 400)).toBeLessThan(400)

  await loginAs(page, editorEmail, editorPassword)
  // SOME POR INTEIRO — nao "aparece vazio", nao "aparece desabilitado".
  await expect(page.locator('.cinerie-automation')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* 4.2 — Papel sem permissao ve FRASE, nao botao morto                */
/* ------------------------------------------------------------------ */

test('writer ve frase de espera no lugar do botao que nao pode apertar', async ({ page }) => {
  test.setTimeout(240_000)
  await login(page)

  const { articleId } = await readyArticle(page, `writer-${RUN}`)
  // Leva ate `ready_to_publish` como admin: e dali que a diferenca de papel
  // aparece, porque `editor` e `writer` nao publicam.
  for (const workflowStatus of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish']) {
    const step = await api(page, 'PATCH', `/api/articles/${articleId}`, { workflowStatus })
    expect(step.status, `${workflowStatus}: ${step.text.slice(0, 400)}`).toBe(200)
  }

  const writerEmail = `writer-${RUN}@exemplo.test`
  const writerPassword = `Writer!${RUN}aA1`
  const created = await api(page, 'POST', '/api/editorial-users', {
    email: writerEmail,
    password: writerPassword,
    role: 'writer',
    displayName: 'Redator de Teste',
  })
  expect(created.status, created.text.slice(0, 400)).toBeLessThan(400)

  await loginAs(page, writerEmail, writerPassword)
  await page.goto(`${BASE}/admin/collections/articles/${articleId}`, {
    waitUntil: 'domcontentloaded',
  })

  await expect(page.locator('.cinerie-workflow')).toBeVisible({ timeout: 30_000 })
  // A transicao para `published` chega como FRASE dizendo de quem se espera —
  // nao como botao cinza que o writer clicaria para levar 403.
  const waiting = page.locator('.cinerie-workflow__waiting')
  await expect(waiting.first()).toBeVisible({ timeout: 20_000 })
  await expect(waiting.first()).toContainText(/aguard|chefe|edito/i)

  // E nao ha botao de publicar disponivel para ele.
  await expect(
    page.locator('.cinerie-workflow__action', { hasText: /public/i }),
  ).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* 4.7 — Nenhuma superficie escura sobrou                              */
/* ------------------------------------------------------------------ */

test('o painel e claro em todas as superficies estruturais', async ({ page }) => {
  test.setTimeout(180_000)
  await login(page)

  /** Luminancia relativa (0 = preto, 1 = branco) do fundo computado. */
  const luminanceOf = async (selector: string): Promise<number | null> =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (el === null) return null
      const parsed = getComputedStyle(el).backgroundColor.match(/\d+/g)
      if (parsed === null || parsed.length < 3) return null
      const [r, g, b] = parsed.map(Number) as [number, number, number]
      // Transparente nao e superficie propria: nao acusa nem inocenta.
      if (parsed.length > 3 && Number(parsed[3]) === 0) return null
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    }, selector)

  const surfaces = ['body', '.nav', '.template-default__wrap', '.dashboard']
  const dark: string[] = []
  for (const selector of surfaces) {
    const luminance = await luminanceOf(selector)
    if (luminance !== null && luminance < 0.5) {
      dark.push(`${selector} (luminancia ${luminance.toFixed(2)})`)
    }
  }
  expect(dark, `superficies escuras: ${dark.join(', ')}`).toEqual([])

  // O tema declarado tambem: `data-theme` escuro reintroduziria a escala inteira
  // do Payload por baixo, mesmo com os fundos acima claros.
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')).not.toBe(
    'dark',
  )
})
