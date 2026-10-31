/**
 * qa-detail-responsive.tsx — AUDITORIA RESPONSIVA das telas de detalhe (06/07).
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nao faz parte do produto: nunca
 * roda no render, no build de app nem em producao.
 *
 * O QUE ESTE HARNESS PROVA — E O QUE ELE NAO PROVA
 * ------------------------------------------------
 * PROVA: o comportamento do CSS REAL (as folhas que a ficha carrega, na ordem:
 * `app/globals.css`, `app/_components/detail-hero.css` e
 * `app/_components/detail.css`, lidas do disco, sem copia) sobre a marcacao
 * REAL da fileira de notas (o componente `RatingsPanel` renderizado de verdade,
 * a partir do presenter de verdade), nas quatro larguras da auditoria. Mede
 * overflow horizontal, alvo de toque e tamanho de fonte com o motor de layout
 * do Chromium — coisas que nenhum teste de string consegue medir.
 *
 * NAO PROVA: a cadeia de dados (banco -> loader -> presenter -> pagina). Isso e
 * coberto pelos `validate:*-real-postgres` e pelos testes de wiring. Um harness
 * estatico NUNCA e evidencia final de que a pagina funciona; ele e evidencia de
 * como o CSS se comporta.
 *
 * CONTROLE POSITIVO CONTRA DERIVA. O esqueleto abaixo repete as classes da
 * pagina. Se a pagina mudar e o harness nao, ele passaria a auditar um layout
 * que nao existe mais — verde sobre nada. `assertSkeletonMatchesPages()` exige
 * que TODA classe usada aqui apareca no fonte das duas paginas de detalhe, e
 * aborta nomeando a divergencia.
 *
 * Uso: pnpm --filter @screena/web qa:detail-responsive
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
// `createElement` em vez de JSX: o `tsx` do CLI herda `jsx: "preserve"` do
// tsconfig do app (que existe para o SWC do Next) e emitiria o transform
// classico, quebrando com "React is not defined". Um unico ponto de JSX nao
// justifica um tsconfig proprio so para o harness.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { RatingsLine } from '../app/_components/ratings-panel'
import { buildRatingsView } from '../src/lib/ratings-presenter'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const webDir = path.resolve(scriptDir, '..')
/**
 * As folhas que uma ficha carrega, na ORDEM de carga: a global (do layout) e as
 * do detalhe (da pagina). Desde a divisao do CSS por rota o hero e o corpo das
 * fichas vivem nas folhas do detalhe; auditar so a global mediria a fileira de
 * notas sem o estilo dela.
 */
const CSS = [
  path.join(webDir, 'app', 'globals.css'),
  path.join(webDir, 'app', '_components', 'detail-hero.css'),
  path.join(webDir, 'app', '_components', 'detail.css'),
] as const
const OUT = path.join(webDir, '.qa-detail-responsive')

const PAGES = [
  path.join(webDir, 'app', 'pt', 'filmes', '[slug]', 'page.tsx'),
  path.join(webDir, 'app', 'pt', 'series', '[slug]', 'page.tsx'),
  // Componentes que as paginas COMPOEM e que passaram a emitir classes do
  // esqueleto (topo canonico, 20/08/2026): a sinopse (detail-hero__synopsis)
  // vive em entity-synopsis e o titulo de secao (detail-section-title) em
  // section-head. A checagem de "harness desatualizado" precisa enxergar o
  // markup COMPOSTO, nao so o arquivo da rota.
  path.join(webDir, 'app', '_components', 'entity-synopsis.tsx'),
  path.join(webDir, 'app', '_components', 'section-head.tsx'),
  // Barra superior do canonico de 2026-10-30: a coluna "Elenco e Equipe".
  path.join(webDir, 'app', '_components', 'title-top-cast.tsx'),
  // Os episodios sairam da pagina de serie para `EpisodeList` (client).
  path.join(webDir, 'app', '_components', 'episode-list.tsx'),
] as const

/** As quatro larguras pedidas na auditoria + o piso de 320px do contrato. */
const VIEWPORTS = [
  ['1440', 1440, 1100],
  ['1024', 1024, 1200],
  ['768', 768, 1200],
  ['375', 375, 1200],
  ['320', 320, 1200],
] as const

/** Notas reais das 3 fontes servidas pela OMDb, ja creditadas. */
const RATINGS = [
  {
    sourceKey: 'imdb',
    sourceLabel: 'IMDb',
    scoreType: 'audience',
    label: 'IMDb Rating',
    value: 8.5,
    best: 10,
    count: 1_654_321,
    updatedAt: '2026-08-12T00:00:00.000Z',
    attribution: {
      text: 'Nota fornecida por IMDb',
      url: 'https://www.imdb.com/title/tt0172495/',
    },
  },
  {
    sourceKey: 'rotten_tomatoes',
    sourceLabel: 'Rotten Tomatoes',
    scoreType: 'critics',
    label: 'Tomatometer',
    value: 80,
    best: 100,
    count: null,
    updatedAt: '2026-08-12T00:00:00.000Z',
    attribution: { text: 'Nota fornecida por Rotten Tomatoes', url: null },
  },
  {
    sourceKey: 'metacritic',
    sourceLabel: 'Metacritic',
    scoreType: 'critics',
    label: 'Metascore',
    value: 67,
    best: 100,
    count: null,
    updatedAt: '2026-08-12T00:00:00.000Z',
    attribution: { text: 'Nota fornecida por Metacritic', url: null },
  },
]

/** Classes do esqueleto que PRECISAM existir nas paginas reais. */
const SKELETON_CLASSES = [
  'detail-hero',
  'detail-container',
  'detail-hero__crumbs',
  'title-top',
  'title-top__main',
  'title-top__score',
  'title-top__cast',
  'title-top__title',
  'title-top__kicker',
  'title-top__genres',
  'title-top__synopsis',
  'title-top__people',
  'title-top__person',
  'title-top__avatar',
  'title-top__person-name',
  'title-top__person-role',
  'title-top__see-all',
  'detail-badge-row',
  'detail-badge',
  'title-actions',
  'title-actions__bar',
  'title-actions__watch',
  'title-actions__label',
  'detail-actions',
  'media-strip',
  'media-strip__grid',
  'media-strip__cell',
  'media-strip__caption',
  'media-strip__stack',
  'eyebrow-bar',
  'synopsis-lead',
  'synopsis-body',
  'detail-section-title',
  'cast-strip',
  'cast-tile',
  'cast-tile__photo',
  'cast-tile__name',
  'cast-tile__role',
  'mnews-grid',
  'mnews-card',
  'mnews-card__cover',
  'mnews-card__cat',
  'mnews-card__title',
  'ficha-grid',
  'ficha-rows',
  'ficha-row',
  'episode-list',
  'episode-row',
  'episode-row__media',
  'episode-row__num',
  'episode-row__synopsis',
  'season-tabs',
] as const

function assertSkeletonMatchesPages(): void {
  const sources = PAGES.map((p) => readFileSync(p, 'utf8')).join('\n')
  const missing = SKELETON_CLASSES.filter((c) => !sources.includes(c))
  if (missing.length > 0) {
    throw new Error(
      'HARNESS DESATUALIZADO: as classes a seguir estao no esqueleto de QA mas nao ' +
        `existem mais nas paginas de detalhe: ${missing.join(', ')}. ` +
        'A auditoria estaria medindo um layout que a pagina nao produz mais.',
    )
  }
}

function person(initials: string, name: string, role: string): string {
  return `<li><a class="title-top__person" href="#"><span class="title-top__avatar"><span aria-hidden="true">${initials}</span></span><span class="title-top__person-name">${name}</span><span class="title-top__person-role">${role}</span></a></li>`
}

function tile(initials: string, name: string, role: string): string {
  return `<li><a class="cast-tile" href="#"><span class="cast-tile__photo"><span aria-hidden="true">${initials}</span></span><p class="cast-tile__name">${name}</p><p class="cast-tile__role">${role}</p></a></li>`
}

function episode(n: number): string {
  return `<li><article class="episode-row">
    <div class="episode-row__media"><span class="episode-row__num">T1 · E${n}</span></div>
    <div>
      <h4 class="episode-row__title">Episódio ${n} com um título razoavelmente longo</h4>
      <p class="episode-row__synopsis">Uma sinopse de episódio com comprimento realista, para que a coluna de texto seja medida com a densidade que ela terá em produção e não com três palavras.</p>
      <p class="episode-row__meta">2024 · 52 min</p>
    </div>
    <span class="episode-row__chevron" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="m10 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
  </article></li>`
}

/**
 * O esqueleto usa os rotulos REAIS de acao (`ROTULOS.planned` / `ROTULOS.watched`
 * de `entity-actions.tsx`), nao os aspiracionais do canonico. Dois motivos: a
 * largura do texto e o que dita a caixa que estamos medindo, e um dos rotulos do
 * canonico e uma affordance que nao existe no produto — o auditor de invariantes
 * a barra em `apps/web/**` justamente para ela nao voltar de carona por um
 * harness.
 */
function skeleton(vertical: 'movie' | 'series', chips: string): string {
  const isMovie = vertical === 'movie'
  const genres = isMovie ? 'Ação · Drama · Aventura' : 'Drama · Mistério · Suspense'
  return `<main data-vertical="${vertical}">
  <div class="detail-hero detail-hero--title"><div class="detail-container">
    <nav class="detail-hero__crumbs" aria-label="Trilha de navegação"><ol>
      <li><a href="#">${isMovie ? 'Filmes' : 'Séries'}</a></li>
      <li aria-current="page">${isMovie ? 'Gladiador' : 'Vale dos Corvos'}</li>
    </ol></nav>
    <div class="title-top">
      <div class="title-top__main">
        <h1 class="title-top__title">${isMovie ? 'Gladiador (2000)' : 'Vale dos Corvos (2024)'}</h1>
        <div class="detail-badge-row title-top__kicker"><span class="detail-badge" data-entity-badge="${isMovie ? 'movie' : 'series'}">${isMovie ? 'Filme' : 'Série'}</span><span class="title-top__genres">${genres}</span></div>
        <p class="title-top__synopsis">Um general romano é traído e sua família assassinada por um imperador corrupto, e ele volta a Roma como gladiador em busca de vingança, enfrentando… <a class="title-top__read-more" href="#">Ler mais</a></p>
      </div>
      <div class="title-top__score">${chips}</div>
      <div class="title-top__cast">
        <p class="title-top__cast-label">Elenco e Equipe</p>
        <ul class="title-top__people">
          ${person('RC', 'Russell Crowe', 'como Maximus Decimus Meridius')}
          ${person('JP', 'Joaquin Phoenix', 'como Commodus')}
          ${person('RS', 'Ridley Scott', 'Direção')}
        </ul>
        <a class="title-top__see-all" href="#">Ver elenco e equipe completos</a>
      </div>
    </div>
  </div></div>

  <div class="media-strip"><div class="media-strip__grid">
    <div class="media-strip__cell"></div>
    <div class="media-strip__cell"><span class="media-strip__caption">Mídia do título</span></div>
    <div class="media-strip__stack">
      <a class="media-strip__cell" href="#"><span class="media-strip__caption">Notícias e Eventos</span></a>
      <a class="media-strip__cell" href="#"><span class="media-strip__caption">Onde assistir</span></a>
      <a class="media-strip__cell" href="#"><span class="media-strip__caption">Em breve</span></a>
    </div>
  </div></div>

  <div class="detail-container title-actions"><div class="title-actions__bar">
    <div class="detail-actions"><div class="hero-actions" role="group"><div class="hero-actions__row"><button type="button" class="hero-action">Minha lista</button><button type="button" class="hero-action">Avaliar</button></div></div></div>
    <div class="title-actions__watch"><p class="title-actions__label">Onde assistir</p>
      <ul class="watch-brands"><li class="watch-brands__item"><a class="watch-brands__link" href="#"><span class="watch-brands__mark"><span class="watch-brands__name">Netflix</span></span><span class="watch-brands__modalities">Assinatura</span></a></li><li class="watch-brands__item"><a class="watch-brands__link" href="#"><span class="watch-brands__mark"><span class="watch-brands__name">Prime Video</span></span><span class="watch-brands__modalities">Assinatura · Aluguel</span></a></li></ul>
    </div>
  </div></div>

  <section class="detail-container" style="padding-top:60px">
    <div class="eyebrow-bar"><span>A obra</span></div>
    <p class="synopsis-lead">Uma herança, dois irmãos e uma casa que o inverno se recusa a devolver.</p>
    <p class="synopsis-body">Daniel volta à aldeia onde cresceu para enterrar o pai e vender a casa, mas encontra a irmã decidida a ficar. Entre silêncios de anos e um segredo preso na neve, os dois são obrigados a reencontrar quem foram.</p>
  </section>

  ${
    isMovie
      ? ''
      : `<section class="detail-container" id="episodios" style="padding-top:60px">
    <div class="eyebrow-bar"><span>Catálogo</span></div>
    <h2 class="detail-section-title">Episódios</h2>
    <nav class="season-tabs" aria-label="Temporadas"><a href="#" aria-current="true">Temporada 1</a><a href="#">Temporada 2</a></nav>
    <ol class="episode-list">${[1, 2, 3].map(episode).join('')}</ol>
  </section>`
  }

  <section class="detail-container" style="padding-top:60px">
    <div class="eyebrow-bar"><span>Elenco</span></div>
    <h2 class="detail-section-title">Elenco <span class="thin">principal</span></h2>
    <ul class="cast-strip">
      ${tile('RC', 'Russell Crowe', 'Maximus Decimus Meridius')}
      ${tile('JP', 'Joaquin Phoenix', 'Commodus')}
      ${tile('CN', 'Connie Nielsen', 'Lucilla')}
      ${tile('OR', 'Oliver Reed', 'Proximo')}
      ${tile('RH', 'Richard Harris', 'Marcus Aurelius')}
      ${tile('DH', 'Derek Jacobi', 'Gracchus')}
    </ul>
  </section>

  <section class="detail-container" style="padding-top:64px">
    <div class="eyebrow-bar"><span>Editorial</span></div>
    <h2 class="detail-section-title">Notícias <span class="thin">e bastidores</span></h2>
    <ul class="mnews-grid">
      ${[1, 2, 3]
        .map(
          (i) =>
            `<li><a class="mnews-card" href="#"><span class="mnews-card__cover"></span><span class="mnews-card__cat">Bastidores</span><span class="mnews-card__title">Matéria número ${i} com um título de comprimento realista para medir a caixa</span><span class="mnews-card__meta">Redação · 4 min</span></a></li>`,
        )
        .join('')}
    </ul>
  </section>

  <section class="detail-container" style="padding-top:64px;padding-bottom:72px">
    <div class="ficha-grid">
      <div>
        <div class="eyebrow-bar"><span>Ficha técnica</span></div>
        <dl class="ficha-rows">
          <div class="ficha-row"><dt>Ano</dt><dd>2000</dd></div>
          <div class="ficha-row"><dt>Duração</dt><dd>2h 35min</dd></div>
          <div class="ficha-row"><dt>Idioma original</dt><dd>Inglês</dd></div>
        </dl>
      </div><div></div>
    </div>
  </section>
</main>`
}

function page(vertical: 'movie' | 'series', chipCount: number, css: string): string {
  const view = buildRatingsView({ ratings: RATINGS.slice(0, chipCount) } as never)
  const chips = renderToStaticMarkup(createElement(RatingsLine, { view }))
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA detalhe</title><style>${css}</style></head><body>${skeleton(vertical, chips)}</body></html>`
}

interface Finding {
  readonly viewport: string
  readonly scenario: string
  readonly problem: string
}

async function main(): Promise<void> {
  assertSkeletonMatchesPages()

  // O CSS e lido do disco, nunca copiado: auditar uma copia auditaria a copia.
  const css = CSS.map((file) => readFileSync(file, 'utf8')).join('\n')
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const scenarios = [
    ['filme-3-notas', 'movie', 3],
    ['filme-1-nota', 'movie', 1],
    ['serie-3-notas', 'series', 3],
  ] as const

  const browser = await chromium.launch()
  const findings: Finding[] = []

  try {
    for (const [name, vertical, chipCount] of scenarios) {
      const html = page(vertical, chipCount, css)
      const file = path.join(OUT, `${name}.html`)
      writeFileSync(file, html, 'utf8')

      for (const [label, width, height] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width, height } })
        const p = await context.newPage()
        await p.goto(`file://${file.replace(/\\/g, '/')}`)
        await p.waitForLoadState('load')

        await p.screenshot({
          path: path.join(OUT, `${name}-${label}.png`),
          fullPage: true,
        })

        const audit = await p.evaluate(() => {
          const docWidth = document.documentElement.scrollWidth
          const inner = window.innerWidth

          // NOTA DE FERRAMENTA: nada de funcao auxiliar nomeada dentro deste
          // `evaluate`. O esbuild (via tsx) injeta o helper `__name` em funcoes
          // com nome, e o corpo e serializado para o browser SEM ele — o
          // resultado e "ReferenceError: __name is not defined", que parece bug
          // da pagina e e do transpilador. Por isso tudo aqui e laco puro.

          // Quem ultrapassa a borda direita da viewport.
          //
          // Filho de scroller horizontal NAO conta: um rail (`overflow-x: auto`)
          // existe justamente para que seus itens passem da borda. Sinaliza-los
          // marcaria o comportamento correto como defeito e afogaria o defeito
          // de verdade — a PAGINA rolar de lado — no ruido.
          const overflowing: string[] = []
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue
            if (r.right <= inner + 1) continue

            let scrolled = false
            let node: HTMLElement | null = el.parentElement
            while (node !== null && node !== document.body) {
              const ox = getComputedStyle(node).overflowX
              if (ox === 'auto' || ox === 'scroll') {
                scrolled = true
                break
              }
              node = node.parentElement
            }
            if (scrolled) continue

            const cls = el.className?.toString().split(' ')[0] ?? el.tagName
            overflowing.push(`${cls} (right=${Math.round(r.right)})`)
          }

          /**
           * Alvo de toque minimo 44x44.
           *
           * Mede a AREA CLICAVEL, nao a caixa do elemento: um link com hitbox
           * expandida por `::after` (padrao para nao inflar o layout) tem caixa
           * de 13px e area de toque de 44. Comparar so o `getBoundingClientRect`
           * do proprio elemento reprovaria a solucao correta.
           */
          const smallTargets: string[] = []
          for (const el of Array.from(
            document.querySelectorAll<HTMLElement>('a, button'),
          )) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue

            // Area de toque, nao caixa do elemento: um link com hitbox
            // expandida por `::after` (padrao para nao inflar o layout) tem
            // caixa de 13px e alvo de 44. Medir so o rect reprovaria a solucao
            // correta.
            let hit = r.height
            for (const pseudo of ['::after', '::before']) {
              const s = getComputedStyle(el, pseudo)
              if (s.content === 'none' || s.position !== 'absolute') continue
              const h = Number.parseFloat(s.height)
              if (Number.isFinite(h) && h > hit) hit = h
            }

            if (hit < 44) {
              const cls = el.className?.toString().split(' ')[0] || el.tagName
              smallTargets.push(`${cls} (h=${Math.round(hit)})`)
            }
          }

          /**
           * Piso de tamanho de texto.
           *
           * O contrato: "Texto nunca abaixo de 12px; meta/kickers podem manter
           * 11px APENAS >=1024". O canonico e pixel-fiel em 1280-1440 e usa
           * 10-11px em selo, kicker e meta — divergencia registrada em
           * DESIGN-DELTA.md. Abaixo de 1024 nao ha divergencia possivel: o piso
           * de 12px vale, e e o que esta faixa audita.
           */
          const floor = inner >= 1024 ? 10 : 12
          const tinyText: string[] = []
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            if (el.children.length > 0) continue
            const text = (el.textContent ?? '').trim()
            if (text === '') continue
            const size = Number.parseFloat(getComputedStyle(el).fontSize)
            if (size < floor) {
              const cls = el.className?.toString().split(' ')[0] || el.tagName
              tinyText.push(`${cls} (${size}px, piso ${floor}px)`)
            }
          }

          /**
           * A DOBRA: onde comeca a primeira imagem da ficha.
           *
           * A auditoria de 2026-09-01 mediu `/pt/filmes/a-odisseia/` em 375x812
           * e achou a primeira imagem em **y = 840 px** — zero pixel de imagem
           * na primeira tela de uma pagina de filme. A serie ja abria com
           * midia; o filme nao, porque a reordenacao mobile (`order`) so tinha
           * sido aplicada a um dos dois verticais.
           *
           * Medimos POSICAO RENDERIZADA (`getBoundingClientRect().top`) e nao a
           * folha de estilo: `order` so tem efeito com o container em `flex`, e
           * uma regra escrita sem o container ligado passaria numa leitura de
           * CSS e nao moveria um pixel na tela.
           */
          const strip = document.querySelector<HTMLElement>('.media-strip')
          const heroBlock = document.querySelector<HTMLElement>('.detail-hero')
          const mediaTop = strip === null ? null : Math.round(strip.getBoundingClientRect().top)
          const heroTop =
            heroBlock === null ? null : Math.round(heroBlock.getBoundingClientRect().top)

          return {
            docWidth,
            inner,
            mediaTop,
            heroTop,
            overflowing: Array.from(new Set(overflowing)).slice(0, 6),
            smallTargets: Array.from(new Set(smallTargets)).slice(0, 6),
            tinyText: Array.from(new Set(tinyText)).slice(0, 6),
          }
        })

        // ======================================================================
        // A BANDA DE MIDIA PRECISA CABER NA PRIMEIRA TELA DO CELULAR
        // ======================================================================
        // Abaixo de 768px a composicao empilha, e o heroi de texto sozinho
        // passa de uma tela — entao "midia depois do heroi" e o mesmo que
        // "nenhuma imagem na dobra". Acima de 768px a ordem canonica (heroi e
        // DEPOIS a banda full-bleed) e a correta e NAO e auditada aqui.
        const isMobileWidth = width < 768
        if (isMobileWidth && audit.mediaTop !== null && audit.heroTop !== null) {
          if (audit.mediaTop >= audit.heroTop) {
            findings.push({
              viewport: label,
              scenario: name,
              problem:
                `a banda de midia comeca em y=${audit.mediaTop} e o heroi em ` +
                `y=${audit.heroTop}: em celular a imagem tem de vir ANTES do texto ` +
                '(a pagina abre sem nenhuma imagem na primeira tela).',
            })
          }
        }

        if (audit.docWidth > audit.inner + 1) {
          findings.push({
            viewport: label,
            scenario: name,
            problem: `OVERFLOW horizontal: scrollWidth=${audit.docWidth} > ${audit.inner}. Culpados: ${audit.overflowing.join('; ') || '(nenhum elemento isolado)'}`,
          })
        }
        if (audit.smallTargets.length > 0) {
          findings.push({
            viewport: label,
            scenario: name,
            problem: `alvo de toque < 44px: ${audit.smallTargets.join('; ')}`,
          })
        }
        if (audit.tinyText.length > 0) {
          findings.push({
            viewport: label,
            scenario: name,
            problem: `texto < 12px: ${audit.tinyText.join('; ')}`,
          })
        }

        console.log(
          `${name} @ ${label}: scrollWidth=${audit.docWidth} inner=${audit.inner} ` +
            `overflow=${audit.overflowing.length} alvos<44=${audit.smallTargets.length} texto<12=${audit.tinyText.length}`,
        )
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }

  console.log(`\nCapturas em ${OUT}`)
  if (findings.length === 0) {
    console.log('AUDITORIA LIMPA: sem overflow, sem alvo pequeno, sem texto < 12px.')
    return
  }
  console.log(`\n${findings.length} ACHADO(S):`)
  for (const f of findings) console.log(` - [${f.scenario} @ ${f.viewport}] ${f.problem}`)
  process.exitCode = 1
}

await main()
