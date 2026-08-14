import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

/**
 * browser-default-styles.spec.ts — O estilo padrao do navegador nao vaza para a
 * camada publica.
 *
 * ============ POR QUE ESTE ARQUIVO EXISTE ============
 *
 * Em 14/08/2026 as abas de "Popular essa semana" estavam no ar, nas tres
 * verticais, com o retangulo `buttonface` do navegador atras do rotulo. Havia
 * DOIS guards cobrindo justamente essa secao — `popular-section-styling.test.ts`
 * e `public-shell-reset.test.ts` — e os dois passavam. Passavam porque leem o
 * TEXTO do `globals.css` com `indexOf`/`toContain`: um teste de string so acha o
 * que alguem lembrou de procurar, e ninguem procura por uma declaracao que nao
 * existe. A folha de UA do navegador esta fora do alcance deles por construcao.
 *
 * ============ COMO ESTE MEDE ============
 *
 * Estilo COMPUTADO, em Chromium de verdade, sobre componentes reais.
 *
 * E a referencia do que e "padrao do navegador" nao esta escrita aqui: ela e
 * SONDADA em `about:blank`, num documento sem a nossa folha, no mesmo browser
 * que roda o teste (`probeUserAgentDefaults`). Cravar `rgb(239,239,239)` no
 * arquivo envelheceria na primeira mudanca de versao do Chromium e viraria mais
 * um teste verde pelo motivo errado.
 */

const HARNESS = pathToFileURL(
  path.join(process.cwd(), 'apps/web/.qa-default-styles/index.html'),
).href

interface UaDefaults {
  readonly buttonBackground: string
  readonly buttonBorderStyle: string
  readonly buttonColor: string
  readonly linkColor: string
}

/** O que ESTE navegador pinta sem nenhuma folha nossa. */
async function probeUserAgentDefaults(page: Page): Promise<UaDefaults> {
  await page.goto('about:blank')
  return page.evaluate(() => {
    const button = document.createElement('button')
    button.textContent = 'x'
    const link = document.createElement('a')
    link.setAttribute('href', '#x')
    link.textContent = 'x'
    document.body.append(button, link)
    const b = getComputedStyle(button)
    const a = getComputedStyle(link)
    return {
      buttonBackground: b.backgroundColor,
      buttonBorderStyle: b.borderTopStyle,
      buttonColor: b.color,
      linkColor: a.color,
    }
  })
}

/** alpha do `rgb()`/`rgba()` computado (o computado sempre vem nessa forma). */
function alphaOf(color: string): number {
  const match = /rgba?\(([^)]+)\)/.exec(color)
  if (match === null) return 1
  const parts = match[1]!.split(',').map((p) => Number(p.trim()))
  return parts.length < 4 ? 1 : parts[3]!
}

test.describe('o padrao do navegador nao chega na tela', () => {
  let ua: UaDefaults

  test.beforeEach(async ({ page }) => {
    ua = await probeUserAgentDefaults(page)
    await page.goto(HARNESS)
  })

  test('sonda: o defeito procurado E visivel neste navegador', () => {
    // Controle de sanidade do proprio metodo. Se o Chromium algum dia parar de
    // pintar `buttonface`, as asercoes abaixo passariam a ser vacuas — e este
    // teste avisa antes que isso vire silencio.
    expect(alphaOf(ua.buttonBackground), 'UA sem fundo de botao').toBeGreaterThan(0)
    expect(ua.buttonBorderStyle, 'UA sem borda de botao').not.toBe('none')
    expect(alphaOf(ua.linkColor)).toBeGreaterThan(0)
  })

  test('(1) nenhum <button> da pagina renderiza com a cromagem do UA', async ({ page }) => {
    const leaking = await page.evaluate((defaults: UaDefaults) => {
      const out: { label: string; background: string; borderStyle: string }[] = []
      for (const el of document.querySelectorAll('button')) {
        const s = getComputedStyle(el)
        const wearsUaChrome =
          s.backgroundColor === defaults.buttonBackground ||
          s.borderTopStyle === defaults.buttonBorderStyle
        if (wearsUaChrome) {
          out.push({
            label: `${el.className || '(sem classe)'} :: ${(el.textContent ?? '').trim().slice(0, 24)}`,
            background: s.backgroundColor,
            borderStyle: s.borderTopStyle,
          })
        }
      }
      return out
    }, ua)
    expect(leaking, 'botoes com fundo/borda padrao do navegador').toEqual([])
  })

  test('(2) botao sobre faixa escura nunca fica com fundo claro', async ({ page }) => {
    // Regra independente da sonda: sobre `#0E0E10` um fundo claro grita mesmo
    // que o navegador mude o seu proprio default. Um botao PODE ter fundo na
    // faixa escura (o submit da newsletter e branco por desenho) — o que nao
    // pode e o fundo aparecer sem ninguem ter pedido, entao a checagem e por
    // luminancia declarada, nao por presenca.
    const offenders = await page.evaluate(() => {
      const out: { label: string; background: string }[] = []
      for (const el of document.querySelectorAll('.band--dark button, [role="tab"]')) {
        const s = getComputedStyle(el)
        const m = /rgba?\(([^)]+)\)/.exec(s.backgroundColor)
        if (m === null) continue
        const [r, g, b] = m[1]!.split(',').map((p) => Number(p.trim())) as [number, number, number]
        const a = alphaOfInline(s.backgroundColor)
        const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        // opaco E claro = o retangulo que foi para producao
        if (a > 0.5 && luma > 0.5) {
          out.push({ label: el.className, background: s.backgroundColor })
        }
      }
      return out

      function alphaOfInline(color: string): number {
        const match = /rgba?\(([^)]+)\)/.exec(color)
        if (match === null) return 1
        const parts = match[1]!.split(',').map((p) => Number(p.trim()))
        return parts.length < 4 ? 1 : parts[3]!
      }
    })
    expect(offenders, 'botao claro e opaco sobre faixa escura').toEqual([])
  })

  test('(3) texto NAO-interativo nao herda a cor de link do navegador', async ({ page }) => {
    const wrong = await page.evaluate((defaults: UaDefaults) => {
      const out: { label: string; color: string }[] = []
      const interactive =
        'a, button, input, select, textarea, summary, [role="tab"], [role="button"]'
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        if (el.closest(interactive) !== null) continue
        // so elementos que realmente pintam texto proprio
        const ownText = Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
        )
        if (!ownText) continue
        const s = getComputedStyle(el)
        if (s.color === defaults.linkColor) {
          out.push({
            label: `${el.tagName.toLowerCase()}.${el.className || '(sem classe)'}`,
            color: s.color,
          })
        }
      }
      return out
    }, ua)
    expect(wrong, 'texto nao-interativo com a cor de link do UA').toEqual([])
  })

  test('(3b) o texto de aba vazia esta no DOM e e branco esmaecido, nao cor de link', async ({
    page,
  }) => {
    const empty = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.pop-empty')
      if (el === null) return null
      const s = getComputedStyle(el)
      return { text: (el.textContent ?? '').trim(), color: s.color }
    })
    // Guard contra passar por ausencia: se o harness parar de renderizar o
    // estado vazio, este teste acusa em vez de ficar verde sem medir nada.
    expect(empty, '.pop-empty ausente do harness').not.toBeNull()
    expect(empty!.text).not.toBe('')
    expect(empty!.color).toMatch(/^rgba\(255, 255, 255, 0\.\d+\)$/)
  })

  test('(4) as abas seguem a spec: sem fundo, sem borda lateral, so o sublinhado', async ({
    page,
  }) => {
    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).map((el) => {
        const s = getComputedStyle(el)
        return {
          label: (el.textContent ?? '').trim(),
          selected: el.getAttribute('aria-selected') === 'true',
          background: s.backgroundColor,
          color: s.color,
          fontWeight: s.fontWeight,
          borderTopWidth: s.borderTopWidth,
          borderLeftWidth: s.borderLeftWidth,
          borderRightWidth: s.borderRightWidth,
          borderBottomWidth: s.borderBottomWidth,
          borderBottomColor: s.borderBottomColor,
          padding: s.padding,
          marginBottom: s.marginBottom,
        }
      }),
    )

    expect(tabs.length, 'harness sem abas — o teste seria vacuo').toBeGreaterThan(2)

    for (const tab of tabs) {
      expect(alphaOf(tab.background), `aba "${tab.label}" com fundo`).toBe(0)
      // Sem borda de botao: so a de baixo existe, e so ela.
      expect(tab.borderTopWidth, `aba "${tab.label}"`).toBe('0px')
      expect(tab.borderLeftWidth, `aba "${tab.label}"`).toBe('0px')
      expect(tab.borderRightWidth, `aba "${tab.label}"`).toBe('0px')
      expect(tab.borderBottomWidth, `aba "${tab.label}"`).toBe('2px')
      expect(tab.padding, `aba "${tab.label}"`).toBe('0px 2px 12px')
      expect(tab.marginBottom, `aba "${tab.label}"`).toBe('-1px')

      if (tab.selected) {
        expect(tab.fontWeight).toBe('700')
        expect(tab.color).toBe('rgb(255, 255, 255)')
        // o sublinhado carrega o acento da vertical — nunca transparente
        expect(alphaOf(tab.borderBottomColor)).toBeGreaterThan(0)
        expect(tab.borderBottomColor).not.toBe('rgb(255, 255, 255)')
      } else {
        expect(tab.fontWeight).toBe('600')
        // Valor EXATO da spec, nao "algum branco translucido": era 0.6 e o
        // teste antigo passaria com qualquer alpha.
        expect(tab.color).toBe('rgba(255, 255, 255, 0.5)')
        expect(alphaOf(tab.borderBottomColor)).toBe(0)
      }
    }
  })

  test('(4b) a escala de branco da barra de abas e 0.5 → 0.8 → 1.0', async ({ page }) => {
    const idle = page.locator('[role="tab"][aria-selected="false"]').first()
    const before = await idle.evaluate((el) => getComputedStyle(el).color)
    expect(before).toBe('rgba(255, 255, 255, 0.5)')

    await idle.hover()
    const hovered = await idle.evaluate((el) => getComputedStyle(el).color)
    expect(hovered, 'hover na aba inativa').toBe('rgba(255, 255, 255, 0.8)')

    const active = await page
      .locator('[role="tab"][aria-selected="true"]')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    expect(active).toBe('rgb(255, 255, 255)')
  })

  test('(5) a pill "Ver tudo" na faixa escura e vazada, nao solida', async ({ page }) => {
    const pill = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.band--dark .see-all')
      if (el === null) return null
      const s = getComputedStyle(el)
      return {
        background: s.backgroundColor,
        color: s.color,
        borderTopWidth: s.borderTopWidth,
        borderTopColor: s.borderTopColor,
        borderRadius: s.borderTopLeftRadius,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        padding: s.padding,
      }
    })
    expect(pill, 'pill ausente do harness').not.toBeNull()
    expect(alphaOf(pill!.background), 'pill solida sobre faixa escura').toBe(0)
    expect(pill!.color).toBe('rgb(255, 255, 255)')
    // Tipografia e caixa da spec: 12px/600 e padding 9px 18px.
    expect(pill!.fontSize).toBe('12px')
    expect(pill!.fontWeight).toBe('600')
    expect(pill!.padding).toBe('9px 18px')
    expect(pill!.borderTopWidth).toBe('1px')
    expect(pill!.borderTopColor).toBe('rgba(255, 255, 255, 0.28)')
    // O raio da pill e do sistema (999px) e NAO se normaliza.
    expect(pill!.borderRadius).toBe('999px')
  })

  /**
   * Listas que EXIBEM marcador de proposito. Nao e "exceção para o teste
   * passar": e a lista de leitura de verdade da pagina, com o recuo declarado
   * para caber a bolinha. Entrar aqui exige o motivo escrito.
   */
  const LISTAS_COM_MARCADOR_INTENCIONAL = new Set([
    // Ofertas de "onde assistir": lista de leitura, `padding-left: 1.25rem`
    // declarado justamente para abrir espaco ao marcador.
    'watch-availability__list',
  ])

  test('(6) nenhuma lista COM CLASSE exibe marcador do navegador sem querer', async ({ page }) => {
    const probes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-list-probe]')).map((el) => ({
        cls: el.dataset.listProbe ?? '',
        listStyleType: getComputedStyle(el).listStyleType,
      })),
    )

    // A cobertura vem do fonte: se a varredura do harness quebrar, o teste
    // passaria com zero sondas — exatamente o "verde por 0 testes" que ja
    // aconteceu neste repositorio.
    expect(probes.length, 'harness sem sondas de lista').toBeGreaterThan(10)

    const marked = probes
      .filter((p) => p.listStyleType !== 'none')
      .filter((p) => !LISTAS_COM_MARCADOR_INTENCIONAL.has(p.cls))
      .map((p) => `${p.cls} -> ${p.listStyleType}`)
    expect(marked, 'lista com bolinha/numero do navegador').toEqual([])
  })
})
