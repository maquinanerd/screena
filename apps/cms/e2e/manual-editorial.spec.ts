/**
 * manual-editorial.spec.ts — FASE 2G. O painel `/admin` de verdade, num
 * navegador de verdade.
 *
 * A pergunta: uma pessoa consegue, SO pelo painel, criar autor, escrever
 * materia, subir imagem, preencher SEO, salvar rascunho, reabrir, revisar e
 * publicar — sem MNScr, sem chave de API e sem tocar em nada de automacao?
 *
 * Sobre os seletores: nada aqui depende de ORDEM VISUAL. O painel do Payload
 * expoe cada campo com `id="field-<nome>"`, que e o nome do campo no schema —
 * um seletor estavel e legivel. Abas e botoes vao por `getByRole` com o texto
 * que a redacao ve. Um `nth(3)` quebraria na primeira reordenacao de layout, e
 * reordenar layout foi exatamente o que a FASE 2G fez.
 *
 * As transicoes de workflow e as relacoes (autor, capa, blocos do corpo) vao
 * pela REST API do Payload usando A SESSAO DO NAVEGADOR (`page.request` herda o
 * cookie do login real). E o mesmo servidor, o mesmo access control e o mesmo
 * hook de governanca que o formulario usa; o que muda e o widget que dispara a
 * chamada. Onde o widget e o proprio objeto do teste — login, abas, campos de
 * texto, upload de arquivo, salvar, reabrir — a interacao e no formulario.
 */

import { expect, test, type Page } from '@playwright/test'

import { readState } from './state.js'

const state = readState()
const BASE = state.baseUrl

/** Sufixo unico: a suite roda contra um banco que sobrevive a todos os testes. */
const RUN = Date.now().toString(36)

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('#field-email').fill(state.admin.email)
  await page.locator('#field-password').fill(state.admin.password)
  await page.getByRole('button', { name: /login|entrar/i }).click()
  // O painel so esta pronto quando o dashboard aparece — nao basta a URL mudar.
  await page.waitForURL(/\/admin\/?(\?.*)?$/, { timeout: 30_000 })
  await expect(page.locator('.dashboard')).toBeVisible({ timeout: 30_000 })
}

/** Salva o documento aberto e espera a confirmacao do servidor. */
async function save(page: Page): Promise<void> {
  const response = page.waitForResponse(
    (res) =>
      /\/api\/(articles|authors|media)/.test(res.url()) &&
      ['POST', 'PATCH', 'PUT'].includes(res.request().method()),
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: /^(save|salvar|create|criar)/i }).first().click()
  const settled = await response
  expect(settled.status(), await settled.text()).toBeLessThan(400)
}

/**
 * Token da SESSAO DO NAVEGADOR.
 *
 * O painel guarda o JWT no cookie `payload-token`. Mandar o cookie sozinho nao
 * basta na REST API do Payload — ela le a credencial do header `Authorization`
 * —, e sem ele a resposta e 403 "not allowed", indistinguivel de uma negacao de
 * permissao legitima. Lendo o cookie e reenviando como header, a chamada
 * continua sendo a MESMA sessao aberta pelo login na tela.
 */
async function sessionToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies(BASE)
  const token = cookies.find((cookie) => cookie.name === 'payload-token')?.value ?? ''
  if (token === '') throw new Error('sessao do painel sem cookie payload-token')
  return token
}

/** Chamada REST com a SESSAO DO NAVEGADOR (credencial do login real). */
async function api(
  page: Page,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  data?: unknown,
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
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
    json = { raw: text }
  }
  return { status: response.status(), json, text }
}

/**
 * Espera o AUTOSAVE levar o valor digitado ate o banco.
 *
 * Dois detalhes do Payload que o teste precisa respeitar:
 *
 *  - `articles` grava por autosave (2s), entao "salvou" nao e um clique — e um
 *    efeito que chega depois. Um `waitForTimeout` fixo passaria numa maquina
 *    rapida e piscaria em outra; sondar ate o campo bater e a leitura honesta.
 *  - autosave escreve na tabela de VERSOES, nao na linha principal. Ler sem
 *    `draft=true` devolve a versao publicada — que aqui ainda nem existe — e o
 *    campo aparece `null` mesmo tendo sido salvo.
 */
async function expectPersisted(
  page: Page,
  articleId: string,
  field: string,
  value: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: unknown = null
  while (Date.now() < deadline) {
    const doc = await api(page, 'GET', `/api/articles/${articleId}?depth=0&draft=true`)
    last = (doc.json as Record<string, unknown>)[field]
    if (last === value) return
    await page.waitForTimeout(1_000)
  }
  expect(last, `campo ${field} nao persistiu pelo autosave`).toBe(value)
}

/** Extrai o id do documento da URL do painel (`.../collections/<slug>/<id>`). */
function idFromUrl(url: string): string {
  const id = url.split('?')[0]?.split('/').filter(Boolean).pop() ?? ''
  if (id === '' || id === 'create') throw new Error(`id nao encontrado na URL: ${url}`)
  return id
}

/**
 * Abre uma secao recolhida (`collapsible`) pelo rotulo que a redacao le.
 *
 * A reforma do painel agrupou os campos raros em `collapsible` com
 * `initCollapsed: true`: dez sinais de SEO sob "Sinais avancados", vinte e dois
 * campos de auditoria sob "Rastro da automacao". O Payload NAO desmonta esses
 * campos — `AnimateHeight` mantem tudo no DOM com altura zero. Logo o
 * `#field-<nome>` existe e `toHaveCount` continua enxergando, mas o campo esta
 * invisivel; `fill()` espera visibilidade e trava ate estourar o teste.
 *
 * Por que nao `getByRole('button', { name: rotulo })`, como nas abas: o botao de
 * toggle do Payload nao carrega o rotulo da secao. Seu nome acessivel e a string
 * generica de i18n `fields:toggleBlock` — identica em toda secao da tela. O
 * rotulo vive ao lado, em `.collapsible__header-wrap`. Ancoramos pelo texto que
 * a redacao ve e clicamos o toggle daquela secao; `toHaveCount(1)` recusa rotulo
 * ambiguo em vez de abrir a secao errada em silencio.
 *
 * Idempotente de proposito: o Payload guarda o estado recolhido nas PREFERENCIAS
 * do usuario, nao no componente. Depois de expandir uma vez, uma proxima
 * abertura pode ja vir aberta — e um clique cego fecharia a secao.
 */
async function expandSection(page: Page, label: string): Promise<void> {
  const section = page.locator('.collapsible', {
    has: page.locator('.collapsible__header-wrap', { hasText: label }),
  })
  await expect(section, `secao "${label}" nao encontrada, ou o rotulo e ambiguo`).toHaveCount(1)

  const toggle = section.locator('.collapsible__toggle').first()
  await expect(toggle).toBeVisible()
  if (((await toggle.getAttribute('class')) ?? '').includes('collapsible__toggle--collapsed')) {
    await toggle.click()
  }
  await expect(toggle).toHaveClass(/collapsible__toggle--open/)
}

/* ------------------------------------------------------------------ */
/* O caminho completo, num unico teste                                 */
/* ------------------------------------------------------------------ */
//
// Um teste so, e nao oito: as etapas sao ENCADEADAS (nao ha o que publicar sem
// ter criado). Fatiar em testes independentes exigiria recriar o estado a cada
// um — ou compartilha-lo por variavel de modulo, que e a mesma coisa com mais
// cerimonia e um relatorio que mente sobre independencia.

test('redacao humana publica pelo painel, do login ao evento na outbox', async ({ page }) => {
  test.setTimeout(300_000)

  /* --- 1. Login real ------------------------------------------------ */
  await login(page)

  /* --- 2. Criar AUTOR publico --------------------------------------- */
  //
  // Autor publico e usuario do CMS sao coisas diferentes: quem operou o painel
  // e a administradora; quem assina a materia e a Redacao.
  await page.goto(`${BASE}/admin/collections/authors/create`, { waitUntil: 'domcontentloaded' })
  await page.locator('#field-name').fill('Redacao Cinerie')
  await page.locator('#field-slug').fill(`redacao-cinerie-${RUN}`)
  await save(page)
  await page.waitForURL(/\/collections\/authors\/\d+$/, { timeout: 30_000 })
  const authorId = idFromUrl(page.url())

  /* --- 3. Subir MIDIA pelo formulario ------------------------------- */
  await page.goto(`${BASE}/admin/collections/media/create`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="file"]').setInputFiles(state.mediaFixturePath)
  await page.locator('#field-alt').fill('Cena de divulgacao da temporada')
  await page.locator('#field-credit').fill('Divulgacao')
  await save(page)
  await page.waitForURL(/\/collections\/media\/\d+$/, { timeout: 60_000 })
  const mediaId = idFromUrl(page.url())

  // A licenca e decisao editorial, e o default e fechado: midia nasce sem
  // permissao de uso. Liberar e um ato explicito — feito aqui pela sessao real.
  const licensed = await api(page, 'PATCH', `/api/media/${mediaId}`, {
    licenseStatus: 'approved',
    allowedForEditorial: true,
    allowedForHero: true,
    requiresAttribution: false,
    provenanceType: 'cinerie_editorial',
  })
  expect(licensed.status, licensed.text.slice(0, 400)).toBe(200)

  /* --- 4. Criar a MATERIA pelo formulario, aba por aba --------------- */
  await page.goto(`${BASE}/admin/collections/articles/create`, { waitUntil: 'domcontentloaded' })

  // As OITO abas da FASE 2G estao la, e na ordem de trabalho da redacao.
  for (const label of [
    'Conteudo',
    'Midia',
    'Autoria',
    'SEO',
    'Entidades',
    'Fontes e QA',
    'Publicacao',
    'Automacao (auditoria)',
  ]) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  }

  // Aba CONTEUDO — e o titulo e o primeiro campo, nao o oitavo.
  const slug = `materia-e2e-${RUN}`
  await page.locator('#field-title').fill('Materia escrita pelo painel')
  await page.locator('#field-subtitle').fill('Linha de apoio digitada por uma pessoa')
  await page.locator('#field-slug').fill(slug)
  await page.locator('#field-summary').fill('Resumo editorial proprio, escrito na redacao.')

  // A materia NASCE pelo autosave, nao por um botao: a collection declara
  // `versions.drafts.autosave`, e o painel grava o rascunho sozinho. Esperar um
  // "Save" que nao existe travaria aqui — o botao visivel e "Publish changes",
  // e ele nao serve para salvar rascunho.
  await page.waitForURL(/\/collections\/articles\/\d+$/, { timeout: 90_000 })
  const articleId = idFromUrl(page.url())

  // Aba SEO — SINAIS editoriais. Canonical, robots e JSON-LD nao sao pedidos
  // aqui: sao derivados no site.
  await page.getByRole('button', { name: 'SEO', exact: true }).click()
  // Os DOIS que a redacao sempre escreve ficam na superficie da aba.
  await page.locator('#field-metaTitle').fill('Titulo de busca escrito pela redacao')
  await page.locator('#field-metaDescription').fill('Descricao propria, sem copiar sinopse.')
  // Os outros dez foram recolhidos sob "Sinais avancados" — continuam
  // acessiveis, a um clique. E o clique faz parte do caminho da redacao.
  await expandSection(page, 'Sinais avançados')
  await page.locator('#field-focusKeyphrase').fill('estreia da temporada')
  await page.locator('#field-articleSection').fill('Series')
  // O painel NAO pede estrutura. A ausencia e a asercao — e ela vale com a
  // secao ABERTA: nao ha campo escondido atras do recolhimento.
  for (const absent of ['#field-robots', '#field-canonical', '#field-jsonLd', '#field-publisher']) {
    await expect(page.locator(absent)).toHaveCount(0)
  }

  // Aba AUTOMACAO — existe, e nao e editavel por humano. Os 22 campos de
  // auditoria tambem nascem recolhidos.
  await page.getByRole('button', { name: 'Automacao (auditoria)', exact: true }).click()
  await expandSection(page, 'Rastro da automação')
  const autoPublished = page.locator('#field-autoPublished')
  await expect(autoPublished).toBeVisible()
  await expect(autoPublished).toBeDisabled()

  await page.getByRole('button', { name: 'Conteudo', exact: true }).click()
  // O que o formulario digitou chegou ao banco pelo autosave.
  await expectPersisted(page, articleId, 'metaTitle', 'Titulo de busca escrito pela redacao')
  await expectPersisted(page, articleId, 'focusKeyphrase', 'estreia da temporada')

  /* --- 4b. O botao de publicar do painel NAO burla o fluxo ---------- */
  //
  // "Publish changes" e o botao generico do Payload: ele manda
  // `_status: published`. Num CMS editorial isso e uma porta lateral para o ar
  // — a decisao de publicar mora em `workflowStatus`, e ela vem de
  // `ready_to_publish`. O hook recusa, e a recusa aparece na tela.
  const refusedResult = await api(page, 'PATCH', `/api/articles/${articleId}`, {
    _status: 'published',
  })
  expect(refusedResult.status).toBe(403)
  expect(refusedResult.text).toContain('workflowStatus')
  expect((await api(page, 'GET', `/api/articles/${articleId}?depth=0`)).json._status).toBe('draft')

  /* --- 5. Corpo, capa, autor e QA ----------------------------------- */
  //
  // Blocos e relacoes pela REST API COM A SESSAO DO NAVEGADOR: mesmo servidor,
  // mesmo access control, mesmo hook de governanca. O que muda e quem dispara.
  //
  // Os campos de SEO voltam junto porque sao lidos do RASCUNHO que o formulario
  // produziu — nao sao reinventados aqui. E o mesmo que o botao do painel faz ao
  // promover: ele envia os valores que a pessoa digitou, e o autosave os guardou
  // na tabela de versoes.
  const draftDoc = (await api(page, 'GET', `/api/articles/${articleId}?depth=0&draft=true`))
    .json as Record<string, unknown>

  const filled = await api(page, 'PATCH', `/api/articles/${articleId}`, {
    metaTitle: draftDoc.metaTitle,
    metaDescription: draftDoc.metaDescription,
    focusKeyphrase: draftDoc.focusKeyphrase,
    articleSection: draftDoc.articleSection,
    body: [
      { blockType: 'paragraph', blockId: 'p-1', text: 'Abertura escrita por uma pessoa da redacao.' },
      { blockType: 'heading', blockId: 'h-1', level: '2', text: 'O que se sabe ate agora' },
      { blockType: 'image', blockId: 'i-1', media: Number(mediaId), alt: 'Cena de divulgacao', credit: 'Divulgacao' },
      { blockType: 'divider', blockId: 'd-1' },
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
  expect(filled.status, filled.text.slice(0, 600)).toBe(200)

  /* --- 6. Sair e REABRIR: o rascunho persistiu ---------------------- */
  await page.goto(`${BASE}/admin/collections/articles`, { waitUntil: 'domcontentloaded' })
  await page.goto(`${BASE}/admin/collections/articles/${articleId}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('#field-title')).toHaveValue('Materia escrita pelo painel')
  await expect(page.locator('#field-slug')).toHaveValue(slug)
  await page.getByRole('button', { name: 'SEO', exact: true }).click()
  await expect(page.locator('#field-focusKeyphrase')).toHaveValue('estreia da temporada')

  /* --- 7. Editar depois de reabrir ---------------------------------- */
  await page.getByRole('button', { name: 'Conteudo', exact: true }).click()
  await page.locator('#field-summary').fill('Resumo revisto depois de reabrir o rascunho.')
  await expectPersisted(page, articleId, 'summary', 'Resumo revisto depois de reabrir o rascunho.')

  /* --- 8. Workflow humano, transicao por transicao ------------------ */
  for (const workflowStatus of [
    'needs_review',
    'in_review',
    'human_reviewed',
    'ready_to_publish',
    'published',
  ]) {
    const step = await api(page, 'PATCH', `/api/articles/${articleId}`, { workflowStatus })
    expect(step.status, `${workflowStatus}: ${step.text.slice(0, 500)}`).toBe(200)
  }

  /* --- 9. O que ficou registrado ------------------------------------ */
  const published = await api(page, 'GET', `/api/articles/${articleId}?depth=0`)
  expect(published.status).toBe(200)
  const doc = published.json as Record<string, unknown>

  expect(doc.workflowStatus).toBe('published')
  expect(doc._status).toBe('published')
  expect(typeof doc.publishedAt).toBe('string')

  // Rastro HUMANO: a mesma pessoa criou, alterou e publicou — publicacao solo,
  // auditada em tres perguntas distintas.
  expect(String(doc.createdBy)).toBe(String(state.admin.id))
  expect(String(doc.updatedBy)).toBe(String(state.admin.id))
  expect(String(doc.publishedBy)).toBe(String(state.admin.id))

  // E NAO foi automacao. `autoPublished` e o indicador explicito: `false`, nao
  // nulo. A ausencia de `automationActorId` confirma pelo outro lado.
  expect(doc.autoPublished).toBe(false)
  expect(doc.automationActorId ?? null).toBeNull()
  expect(doc.automationIdempotencyKey ?? null).toBeNull()
  expect(doc.idempotencyKey ?? null).toBeNull()
  expect(doc.sourceClusterId ?? null).toBeNull()
  expect(doc.pipelineVersion ?? null).toBeNull()

  // Assinatura PUBLICA e operador do CMS sao identidades diferentes.
  expect(String(doc.primaryAuthor)).toBe(String(authorId))

  // Os SINAIS de SEO digitados na aba chegaram a materia publicada.
  expect(doc.metaTitle).toBe('Titulo de busca escrito pela redacao')
  expect(doc.focusKeyphrase).toBe('estreia da temporada')
  expect(doc.articleSection).toBe('Series')
  // E a ESTRUTURA continua sendo do lado publico: o CMS nao guarda robots,
  // canonical derivado, JSON-LD nem sitemap.
  for (const absent of ['robots', 'jsonLd', 'publisher', 'sitemap', 'newsSitemap']) {
    expect(doc[absent]).toBeUndefined()
  }

  /* --- 10. O evento nasceu: o lado publico sera avisado ------------- */
  const outbox = await api(
    page,
    'GET',
    `/api/publication-outbox?where[aggregateId][equals]=${articleId}&limit=10&depth=0`,
  )
  expect(outbox.status).toBe(200)
  const rows = ((outbox.json as { docs?: Record<string, unknown>[] }).docs ?? [])
  expect(rows.map((row) => row.eventType)).toEqual(['article.published'])
  expect(rows[0]?.status).toBe('pending')
})
