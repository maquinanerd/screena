/**
 * css-parity-chrome.ts — PARIDADE DE ESTILO COMPUTADO entre dois builds, e o CSS
 * que cada rota baixa antes de pintar.
 *
 * Existe para a divisao do CSS por rota (`docs/frontend/CSS-SPLIT-PLAN-2026-09-15.md`).
 * Aqui CSS vence por ORDEM DE DOCUMENTO: mover uma regra de folha pode trocar quem
 * vence sem erro, aviso ou teste vermelho. A prova e o navegador — o estilo
 * computado de cada elemento de cada rota, antes e depois, tem de ser o mesmo.
 *
 * ============================================================================
 * O QUE UMA CAPTURA GUARDA
 * ============================================================================
 *  1. O estilo computado de todo elemento do <body> (e de `::before`/`::after`
 *     com conteudo), em quatro larguras que cobrem os pontos de quebra da folha
 *     (599, 767 e 1023 px).
 *  2. ACUMULO. No App Router as folhas de rota ficam no documento depois da
 *     navegacao pelo cliente e nunca saem. Cada rota e medida de novo com TODAS as
 *     folhas vistas nas outras rotas acrescentadas — em ordem direta e inversa — e
 *     comparada com ela mesma. Diferenca ali e folha de uma rota vazando para outra.
 *  3. O CSS BLOQUEANTE da rota: bytes e gzip de cada `<link rel="stylesheet">`.
 *
 * O que ela NAO mede: `:hover`/`:focus`/`:active` e elemento que so aparece depois
 * de interacao. Isso fica com a checagem estatica (`css-move-check.ts`).
 *
 * Determinismo: toda requisicao fora da base e bloqueada (imagem do TMDB
 * inclusive), animacao e transicao sao congeladas, e a comparacao desconta o RUIDO
 * medido entre duas capturas do MESMO build (carrossel, relogio).
 *
 * ============================================================================
 * USO
 * ============================================================================
 *   Laboratorio de pe (validate:route-cache com CINERIE_LAB_HOLD_SECONDS) e dados
 *   de paridade semeados (css:parity:seed). Depois:
 *
 *   PARITY_MODE=capture PARITY_BASE=http://127.0.0.1:PORTA PARITY_OUT=antes.json \
 *     pnpm --filter @screena/web css:parity
 *   PARITY_MODE=compare PARITY_BASELINE=antes.json PARITY_NOISE=antes-2.json \
 *     PARITY_CURRENT=depois.json pnpm --filter @screena/web css:parity
 *
 * Captura: PARITY_WIDTHS (padrao 412,700,900,1350), PARITY_PATHS (virgula; no Git
 * Bash use MSYS2_ENV_CONV_EXCL=PARITY_PATHS), PARITY_ACCUMULATE (padrao 1),
 * PARITY_CHROME, e PARITY_INJECT_CSS — CSS injetado depois da carga, o CONTROLE
 * NEGATIVO: com ele, a comparacao TEM de acusar diferenca.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { type Cdp, closeChrome, DEFAULT_CHROME, launchChrome, openTab, sleep } from "./lab/cdp-chrome";

const DEFAULT_PATHS = [
  "/pt/",
  "/pt/filmes/",
  "/pt/series/",
  "/pt/filmes/filme-1/",
  "/pt/filmes/filme-1/imagens/",
  "/pt/series/serie-1/",
  "/pt/series/serie-1/temporadas/1/",
  "/pt/series/serie-1/temporadas/1/episodios/1/",
  "/pt/pessoas/",
  "/pt/pessoas/pessoa-1/",
  "/pt/pessoas/pessoa-1/fotos/",
  "/pt/noticias/",
  "/pt/noticias/paridade-materia-com-capa/",
  "/pt/noticias/paridade-materia-sem-capa/",
  "/pt/autores/",
  "/pt/explorar/",
  "/pt/em-breve/",
  "/pt/onde-assistir/",
  "/pt/entrar/",
  "/pt/criar-conta/",
  "/pt/recuperar-senha/",
  "/pt/redefinir-senha/",
  "/pt/verificar-email/",
  "/pt/conta/",
  "/pt/importar/",
  "/pt/listas/",
  "/pt/minha-lista/",
  "/pt/historico/",
  "/pt/tracker/",
  "/pt/termos/",
  "/pt/privacidade/",
  "/pt/creditos-de-dados/",
  "/pt/sobre/",
  "/pt/politica-editorial/",
  "/pt/contato/",
  "/pt/cinerie-score/",
  "/dev/ad-preview/",
  "/pt/pagina-que-nao-existe-paridade/",
];

/** Propriedades comparadas de cada elemento. A ORDEM e o formato do arquivo. */
const PROPS = [
  "display", "position", "float", "clear", "box-sizing", "z-index",
  "top", "right", "bottom", "left",
  "width", "height", "min-width", "max-width", "min-height", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "overflow-x", "overflow-y",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "order",
  "justify-content", "align-items", "align-content", "align-self", "justify-items", "justify-self",
  "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-auto-flow",
  "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
  "text-transform", "text-align", "text-decoration-line", "text-overflow", "white-space",
  "word-break", "overflow-wrap",
  "color", "background-color", "background-image", "background-size", "background-position",
  "opacity", "visibility", "transform", "box-shadow", "filter",
  "object-fit", "object-position", "aspect-ratio",
  "list-style-type", "vertical-align", "cursor", "pointer-events", "isolation",
  "-webkit-line-clamp", "-webkit-box-orient", "scroll-margin-top",
  "outline-style", "outline-width", "outline-color",
];

/** Propriedades de `::before`/`::after` (so quando o pseudo-elemento tem conteudo). */
const PSEUDO_PROPS = [
  "content", "display", "position", "top", "right", "bottom", "left", "width", "height",
  "margin-top", "margin-left", "background-color", "background-image", "color",
  "border-top-width", "border-top-style", "border-top-color", "transform", "opacity",
  "font-size", "-webkit-mask-image",
];

/** Instalado em todo documento novo: congela animacao e transicao. */
const FREEZE_SCRIPT = `document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.setAttribute("data-parity-freeze", "");
  style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  document.head.appendChild(style);
});`;

/** Roda na pagina: espera fontes e pintura e devolve o estilo computado de tudo. */
const SNAPSHOT_SCRIPT = `(async () => {
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const PROPS = ${JSON.stringify(PROPS)};
  const PSEUDO = ${JSON.stringify(PSEUDO_PROPS)};
  const table = [];
  const seen = new Map();
  const intern = (text) => {
    let index = seen.get(text);
    if (index === undefined) { index = table.length; table.push(text); seen.set(text, index); }
    return index;
  };
  const keyOf = (el) => {
    const parts = [];
    for (let node = el; node && node.parentElement; node = node.parentElement) {
      let n = 1;
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName === node.tagName) n += 1;
      }
      parts.push(node.tagName.toLowerCase() + ":" + n);
    }
    return parts.reverse().join(">");
  };
  const pseudo = (el, which) => {
    const style = getComputedStyle(el, which);
    const content = style.getPropertyValue("content");
    if (content === "none" || content === "normal" || content === "") return -1;
    return intern(PSEUDO.map((p) => style.getPropertyValue(p)).join("|"));
  };
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "TITLE"]);
  const elements = [];
  for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll("*")]) {
    if (SKIP.has(el.tagName)) continue;
    const style = getComputedStyle(el);
    elements.push([
      keyOf(el),
      el.getAttribute("class") || "",
      intern(PROPS.map((p) => style.getPropertyValue(p)).join("|")),
      pseudo(el, "::before"),
      pseudo(el, "::after"),
    ]);
  }
  const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href);
  return JSON.stringify({ table, elements, sheets, url: location.href });
})()`;

/** Roda na pagina: tamanho de cada folha, bruto e gzip. */
const SIZES_SCRIPT = (hrefs: readonly string[]): string => `(async () => {
  const out = {};
  for (const href of ${JSON.stringify(hrefs)}) {
    const text = await (await fetch(href)).text();
    const bytes = new TextEncoder().encode(text).length;
    const gzip = (await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()).byteLength;
    out[href] = { bytes, gzip };
  }
  return JSON.stringify(out);
})()`;

/** Roda na pagina: acrescenta folhas na ordem dada e espera todas carregarem. */
const APPEND_SCRIPT = (hrefs: readonly string[]): string => `(async () => {
  const present = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href));
  for (const href of ${JSON.stringify(hrefs)}) {
    if (present.has(href)) continue;
    await new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
    });
  }
  return true;
})()`;

const INJECT_SCRIPT = (css: string): string => `(() => {
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
  return true;
})()`;

type ElementRow = [key: string, classes: string, style: number, before: number, after: number];

interface Snapshot {
  readonly table: string[];
  readonly elements: ElementRow[];
  readonly sheets: string[];
  readonly url: string;
}

interface CapturedPage extends Snapshot {
  readonly path: string;
  readonly width: number;
  readonly status: number | null;
}

interface AccumulationResult {
  readonly path: string;
  readonly width: number;
  readonly order: "forward" | "reverse";
  readonly changed: number;
  readonly samples: string[];
}

/** Rota que nao pode ser medida. Fica no arquivo, e o `compare` reprova por ela. */
interface CaptureFailure {
  readonly path: string;
  readonly width: number;
  readonly phase: "direct" | "accumulation";
  readonly error: string;
}

interface Capture {
  readonly base: string;
  readonly capturedAt: string;
  readonly widths: number[];
  readonly props: string[];
  readonly pseudoProps: string[];
  readonly injectedCss: string | null;
  readonly pages: CapturedPage[];
  readonly sheetSizes: Record<string, { bytes: number; gzip: number }>;
  readonly accumulation: AccumulationResult[];
  readonly failures: CaptureFailure[];
}

/**
 * Avalia um script de pagina. Contrato dos scripts deste arquivo: devolvem TEXTO
 * JSON (`JSON.stringify(...)`) ou um valor que nao seja string (`true`). Um texto
 * cru como `document.readyState` nao e JSON e derruba a leitura.
 */
async function evaluate<T>(cdp: Cdp, expression: string): Promise<T> {
  const result = await Promise.race([
    cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
    sleep(60_000).then((): never => {
      throw new Error("Runtime.evaluate sem resposta em 60 s");
    }),
  ]);
  const exception = result.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
  if (exception !== undefined) {
    throw new Error(`na pagina: ${exception.exception?.description ?? exception.text ?? "erro"}`);
  }
  const value = (result.result as { value?: unknown } | undefined)?.value;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

async function load(cdp: Cdp, url: string, width: number): Promise<number | null> {
  await cdp.send("Page.navigate", { url: "about:blank" });
  await sleep(150);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  let status: number | null = null;
  cdp.on("Network.responseReceived", (params) => {
    const response = params.response as { url: string; status: number };
    if (params.type === "Document" && status === null) status = response.status;
  });
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`load nao disparou em 90 s: ${url}`)), 90_000);
    cdp.on("Page.loadEventFired", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await cdp.send("Page.navigate", { url });
  await loaded;
  cdp.clear("Page.loadEventFired");
  cdp.clear("Network.responseReceived");
  return status;
}

/** Erros de avaliacao que significam "o documento trocou no meio". */
const NAVIGATING = /context was destroyed|Cannot find context|Inspected target navigated|Execution context/i;

/** Espera um tempo curto dentro da pagina: da a chance de um redirecionamento no cliente comecar. */
const SETTLE_SCRIPT = `(async () => { await new Promise((r) => setTimeout(r, 400)); return JSON.stringify(document.readyState); })()`;

/** Espera o proximo `load`, ou desiste em `ms`. */
function nextLoad(cdp: Cdp, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cdp.clear("Page.loadEventFired");
      resolve();
    }, ms);
    cdp.on("Page.loadEventFired", () => {
      clearTimeout(timer);
      cdp.clear("Page.loadEventFired");
      resolve();
    });
  });
}

/**
 * Avalia na pagina tolerando UMA coisa: o documento trocar no meio — rota que
 * redireciona pelo cliente depois do `load`. Espera o documento novo e tenta de
 * novo; qualquer outro erro sobe.
 */
async function evaluateSettled<T>(cdp: Cdp, expression: string): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await evaluate<T>(cdp, expression);
    } catch (error) {
      if (!NAVIGATING.test((error as Error).message) || attempt >= 4) throw error;
      await nextLoad(cdp, 30_000);
    }
  }
}

function firstLine(error: unknown): string {
  return ((error as Error).message ?? String(error)).split("\n")[0] ?? "erro";
}

function styleOf(snapshot: Snapshot, index: number): string | null {
  return index < 0 ? null : (snapshot.table[index] ?? null);
}

/** Diferencas de estilo entre duas medicoes do MESMO documento (acumulo). */
function sameDocumentDiff(a: Snapshot, b: Snapshot): { changed: number; samples: string[] } {
  const byKey = new Map(b.elements.map((row) => [row[0], row]));
  let changed = 0;
  const samples: string[] = [];
  for (const row of a.elements) {
    const other = byKey.get(row[0]);
    if (other === undefined) continue;
    for (const [slot, props] of [[2, PROPS], [3, PSEUDO_PROPS], [4, PSEUDO_PROPS]] as const) {
      const left = styleOf(a, row[slot]);
      const right = styleOf(b, other[slot]);
      if (left === right) continue;
      const l = (left ?? "").split("|");
      const r = (right ?? "").split("|");
      for (let i = 0; i < props.length; i += 1) {
        if (l[i] === r[i]) continue;
        changed += 1;
        if (samples.length < 12) {
          samples.push(`${row[0]} .${row[1].split(" ").join(".")} ${slot === 2 ? "" : slot === 3 ? "::before " : "::after "}${props[i]}: ${l[i] ?? "-"} -> ${r[i] ?? "-"}`);
        }
      }
    }
  }
  return { changed, samples };
}

async function capture(): Promise<void> {
  const base = (process.env.PARITY_BASE ?? "").replace(/\/$/, "");
  const out = process.env.PARITY_OUT ?? "";
  if (base === "" || out === "") throw new Error("PARITY_BASE e PARITY_OUT sao obrigatorias no modo capture");
  const widths = (process.env.PARITY_WIDTHS ?? "412,700,900,1350").split(",").map(Number).filter((w) => w > 0);
  const paths = (process.env.PARITY_PATHS ?? DEFAULT_PATHS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const accumulate = (process.env.PARITY_ACCUMULATE ?? "1") !== "0";
  const injectedCss = process.env.PARITY_INJECT_CSS ?? null;

  const chrome = await launchChrome(process.env.PARITY_CHROME ?? DEFAULT_CHROME, "cinerie-css-parity-");
  const pages: CapturedPage[] = [];
  const sheetSizes: Record<string, { bytes: number; gzip: number }> = {};
  const accumulation: AccumulationResult[] = [];
  const failures: CaptureFailure[] = [];
  try {
    const cdp = await openTab(chrome.port);
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    // UM ouvinte, a sessao inteira: a pagina segue pedindo chunk e imagem depois
    // do `load`, e um ouvinte por navegacao responderia a mesma requisicao N vezes.
    cdp.on("Fetch.requestPaused", (params) => {
      const request = params.request as { url: string };
      const requestId = String(params.requestId);
      if (request.url.startsWith(base)) void cdp.send("Fetch.continueRequest", { requestId });
      else void cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FREEZE_SCRIPT });

    process.stdout.write(`\nPARIDADE DE CSS — captura de ${base} — ${paths.length} rota(s) x ${widths.length} largura(s)\n`);
    for (const pagePath of paths) {
      for (const width of widths) {
        try {
          const status = await load(cdp, `${base}${pagePath}`, width);
          await evaluateSettled(cdp, SETTLE_SCRIPT);
          if (injectedCss !== null) await evaluateSettled(cdp, INJECT_SCRIPT(injectedCss));
          const snapshot = await evaluateSettled<Snapshot>(cdp, SNAPSHOT_SCRIPT);
          pages.push({ ...snapshot, path: pagePath, width, status });
          const unmeasured = snapshot.sheets.filter((href) => sheetSizes[href] === undefined);
          if (unmeasured.length > 0) {
            Object.assign(
              sheetSizes,
              await evaluateSettled<Record<string, { bytes: number; gzip: number }>>(cdp, SIZES_SCRIPT(unmeasured)),
            );
          }
        } catch (error) {
          failures.push({ path: pagePath, width, phase: "direct", error: firstLine(error) });
          process.stdout.write(`  [ERRO] ${pagePath} @${width}: ${firstLine(error)}\n`);
        }
      }
      const first = pages.find((page) => page.path === pagePath);
      const cssBytes = (first?.sheets ?? []).reduce((sum, href) => sum + (sheetSizes[href]?.bytes ?? 0), 0);
      process.stdout.write(
        `  ${pagePath} -> HTTP ${first?.status ?? "?"} · ${first?.elements.length ?? 0} elementos · ` +
          `${first?.sheets.length ?? 0} folha(s), ${cssBytes} B de CSS` +
          `${first !== undefined && !first.url.includes(pagePath) ? ` · terminou em ${new URL(first.url).pathname}` : ""}\n`,
      );
    }

    if (accumulate) {
      const allSheets = [...new Set(pages.flatMap((page) => page.sheets))];
      const edgeWidths = [...new Set([widths[0], widths[widths.length - 1]])].filter(
        (w): w is number => w !== undefined,
      );
      process.stdout.write(`\nACUMULO: ${allSheets.length} folha(s) distinta(s) acrescentada(s) a cada rota\n`);
      for (const pagePath of paths) {
        for (const width of edgeWidths) {
          for (const order of ["forward", "reverse"] as const) {
            try {
              await load(cdp, `${base}${pagePath}`, width);
              await evaluateSettled(cdp, SETTLE_SCRIPT);
              if (injectedCss !== null) await evaluateSettled(cdp, INJECT_SCRIPT(injectedCss));
              const direct = await evaluateSettled<Snapshot>(cdp, SNAPSHOT_SCRIPT);
              const hrefs = order === "forward" ? allSheets : [...allSheets].reverse();
              await evaluateSettled(cdp, APPEND_SCRIPT(hrefs));
              const piled = await evaluateSettled<Snapshot>(cdp, SNAPSHOT_SCRIPT);
              const { changed, samples } = sameDocumentDiff(direct, piled);
              accumulation.push({ path: pagePath, width, order, changed, samples });
              if (changed > 0) process.stdout.write(`  [VAZAMENTO] ${pagePath} @${width} (${order}): ${changed}\n`);
            } catch (error) {
              failures.push({ path: pagePath, width, phase: "accumulation", error: firstLine(error) });
              process.stdout.write(`  [ERRO] acumulo ${pagePath} @${width} (${order}): ${firstLine(error)}\n`);
            }
          }
        }
      }
    }

    // Gravado ANTES de fechar o Chrome: uma falha na limpeza nao pode levar a medicao junto.
    const result: Capture = {
      base,
      capturedAt: new Date().toISOString(),
      widths,
      props: PROPS,
      pseudoProps: PSEUDO_PROPS,
      injectedCss,
      pages,
      sheetSizes,
      accumulation,
      failures,
    };
    writeFileSync(out, JSON.stringify(result));
    const leaks = accumulation.filter((entry) => entry.changed > 0).length;
    process.stdout.write(
      `\nCaptura gravada em ${out}. Acumulo: ${leaks} caso(s) com vazamento. Falhas de captura: ${failures.length}.\n`,
    );
    // A captura com falha fica gravada para inspecao, mas nao sai verde: encadeada
    // num `&&`, ela nao pode deixar o passo seguinte comparar uma medicao vazia.
    if (failures.length > 0) process.exitCode = 1;
    cdp.close();
  } finally {
    await closeChrome(chrome);
  }
}

function readCapture(file: string): Capture {
  return JSON.parse(readFileSync(file, "utf8")) as Capture;
}

type Styles = { classes: string; style: string; before: string | null; after: string | null };

function indexPage(page: CapturedPage): Map<string, Styles> {
  const map = new Map<string, Styles>();
  for (const row of page.elements) {
    map.set(row[0], {
      classes: row[1],
      style: styleOf(page, row[2]) ?? "",
      before: styleOf(page, row[3]),
      after: styleOf(page, row[4]),
    });
  }
  return map;
}

/** `chave|slot|propriedade` que diferem entre duas capturas do mesmo build. */
function noiseOf(a: Map<string, Styles>, b: Map<string, Styles>): { props: Set<string>; keys: Set<string> } {
  const props = new Set<string>();
  const keys = new Set<string>();
  for (const [key, left] of a) {
    const right = b.get(key);
    if (right === undefined) {
      keys.add(key);
      continue;
    }
    for (const slot of ["style", "before", "after"] as const) {
      if (left[slot] === right[slot]) continue;
      const l = (left[slot] ?? "").split("|");
      const r = (right[slot] ?? "").split("|");
      const count = Math.max(l.length, r.length);
      for (let i = 0; i < count; i += 1) if (l[i] !== r[i]) props.add(`${key}|${slot}|${i}`);
    }
  }
  for (const key of b.keys()) if (!a.has(key)) keys.add(key);
  return { props, keys };
}

/**
 * O ruido so vale se for uma segunda captura do MESMO estado da linha de base.
 * Medido: com a linha de base tirada com CSS injetado e o ruido tirado sem, a
 * diferenca injetada virou "ruido" e foi descontada — o controle negativo
 * reprovou por outro motivo, e reprovaria por nenhum numa rodada cheia.
 * Mesmo estado = mesmo CSS injetado e as mesmas folhas em cada pagina.
 */
function assertSameStateAsBaseline(
  baseline: Capture,
  noise: Capture,
  pageKey: (page: CapturedPage) => string,
): void {
  if ((noise.injectedCss ?? null) !== (baseline.injectedCss ?? null)) {
    throw new Error(
      "PARITY_NOISE tem de ser uma segunda captura do MESMO estado da linha de base: " +
        `o CSS injetado difere (base: ${JSON.stringify(baseline.injectedCss)}, ruido: ${JSON.stringify(noise.injectedCss)})`,
    );
  }
  const baselineSheets = new Map(baseline.pages.map((page) => [pageKey(page), page.sheets.join(" ")]));
  for (const page of noise.pages) {
    const sheets = baselineSheets.get(pageKey(page));
    if (sheets !== undefined && sheets !== page.sheets.join(" ")) {
      throw new Error(
        `PARITY_NOISE tem de ser do MESMO build da linha de base: as folhas de ${pageKey(page)} diferem ` +
          `(base: ${sheets}; ruido: ${page.sheets.join(" ")})`,
      );
    }
  }
}

function compare(): void {
  const baselineFile = process.env.PARITY_BASELINE ?? "";
  const currentFile = process.env.PARITY_CURRENT ?? "";
  if (baselineFile === "" || currentFile === "") {
    throw new Error("PARITY_BASELINE e PARITY_CURRENT sao obrigatorias no modo compare");
  }
  const baseline = readCapture(baselineFile);
  const current = readCapture(currentFile);
  const noise = process.env.PARITY_NOISE ? readCapture(process.env.PARITY_NOISE) : null;

  const pageKey = (page: CapturedPage): string => `${page.path}@${page.width}`;
  const currentPages = new Map(current.pages.map((page) => [pageKey(page), page]));
  const noisePages = new Map((noise?.pages ?? []).map((page) => [pageKey(page), page]));
  if (noise !== null) assertSameStateAsBaseline(baseline, noise, pageKey);

  let compared = 0;
  let diffs = 0;
  let ignoredByNoise = 0;
  let unmatched = 0;
  const missing: string[] = [];
  const samples: string[] = [];
  const noiseSamples: string[] = [];
  const cssRows: string[] = [];
  const sheetTotal = (capture: Capture, page: CapturedPage): { bytes: number; gzip: number } =>
    page.sheets.reduce(
      (sum, href) => ({
        bytes: sum.bytes + (capture.sheetSizes[href]?.bytes ?? 0),
        gzip: sum.gzip + (capture.sheetSizes[href]?.gzip ?? 0),
      }),
      { bytes: 0, gzip: 0 },
    );

  for (const page of baseline.pages) {
    const other = currentPages.get(pageKey(page));
    if (other === undefined) {
      missing.push(pageKey(page));
      continue;
    }
    const left = indexPage(page);
    const right = indexPage(other);
    const noiseSet = noisePages.has(pageKey(page))
      ? noiseOf(left, indexPage(noisePages.get(pageKey(page)) as CapturedPage))
      : { props: new Set<string>(), keys: new Set<string>() };

    for (const [key, a] of left) {
      if (noiseSet.keys.has(key)) continue;
      const b = right.get(key);
      if (b === undefined) {
        unmatched += 1;
        continue;
      }
      compared += 1;
      for (const slot of ["style", "before", "after"] as const) {
        if (a[slot] === b[slot]) continue;
        const names = slot === "style" ? baseline.props : baseline.pseudoProps;
        const l = (a[slot] ?? "").split("|");
        const r = (b[slot] ?? "").split("|");
        const count = Math.max(l.length, r.length);
        for (let i = 0; i < count; i += 1) {
          if (l[i] === r[i]) continue;
          const sample =
            `${pageKey(page)} ${key} [${a.classes}] ${slot === "style" ? "" : `::${slot} `}` +
            `${names[i] ?? `#${i}`}: ${l[i] ?? "(sem)"} -> ${r[i] ?? "(sem)"}`;
          if (noiseSet.props.has(`${key}|${slot}|${i}`)) {
            ignoredByNoise += 1;
            // O desconto aparece no relatorio: ruido que ninguem ve e diferenca escondida.
            if (noiseSamples.length < 10) noiseSamples.push(sample);
            continue;
          }
          diffs += 1;
          if (samples.length < 40) samples.push(sample);
        }
      }
    }
    for (const key of right.keys()) if (!left.has(key) && !noiseSet.keys.has(key)) unmatched += 1;

    if (page.width === baseline.widths[0]) {
      const before = sheetTotal(baseline, page);
      const after = sheetTotal(current, other);
      cssRows.push(
        `  ${page.path.padEnd(52)} ${String(before.bytes).padStart(7)} -> ${String(after.bytes).padStart(7)} B` +
          `  (gzip ${String(before.gzip).padStart(6)} -> ${String(after.gzip).padStart(6)})` +
          `  folhas ${page.sheets.length} -> ${other.sheets.length}`,
      );
    }
  }

  const leaks = current.accumulation.filter((entry) => entry.changed > 0);
  const captureFailures = [
    ...(baseline.failures ?? []).map((failure) => `base ${failure.path} @${failure.width} (${failure.phase}): ${failure.error}`),
    ...(current.failures ?? []).map((failure) => `atual ${failure.path} @${failure.width} (${failure.phase}): ${failure.error}`),
  ];
  process.stdout.write(`\nPARIDADE DE CSS — ${baselineFile}  x  ${currentFile}\n`);
  process.stdout.write(`\nCSS bloqueante por rota (largura ${baseline.widths[0]}):\n${cssRows.join("\n")}\n`);
  process.stdout.write(
    `\nelementos comparados: ${compared} · diferencas de estilo: ${diffs}` +
      ` · descontadas como ruido: ${ignoredByNoise} · sem par: ${unmatched}` +
      ` · paginas ausentes: ${missing.length} · rotas com vazamento no acumulo: ${leaks.length}\n`,
  );
  for (const sample of samples) process.stdout.write(`  [DIFERENCA] ${sample}\n`);
  for (const sample of noiseSamples) process.stdout.write(`  [RUIDO DESCONTADO] ${sample}\n`);
  for (const entry of leaks) {
    process.stdout.write(`  [VAZAMENTO] ${entry.path} @${entry.width} (${entry.order}): ${entry.changed}\n`);
    for (const sample of entry.samples) process.stdout.write(`      ${sample}\n`);
  }
  for (const page of missing) process.stdout.write(`  [AUSENTE] ${page}\n`);
  for (const failure of captureFailures) process.stdout.write(`  [FALHA DE CAPTURA] ${failure}\n`);

  // CONTROLE: comparar quase nada nao prova paridade — prova um laboratorio vazio.
  const tooFew = compared < 5_000;
  if (tooFew) process.stdout.write(`  [CONTROLE] so ${compared} elementos comparados: o laboratorio nao renderizou as rotas\n`);
  const failed = diffs > 0 || leaks.length > 0 || missing.length > 0 || captureFailures.length > 0 || tooFew;
  process.stdout.write(failed ? "\nRESULTADO: REPROVADO\n" : "\nRESULTADO: PARIDADE — nenhum estilo computado mudou\n");
  if (failed) process.exitCode = 1;
}

const mode = process.env.PARITY_MODE ?? "capture";
const run = mode === "compare" ? Promise.resolve().then(compare) : capture();
run
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[FALHA] a paridade abortou:", error);
    process.exit(1);
  });
