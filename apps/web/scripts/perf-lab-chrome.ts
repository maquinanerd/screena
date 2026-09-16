/**
 * perf-lab-chrome.ts — laboratorio de desempenho LOCAL: Chrome headless via
 * DevTools Protocol, sem Playwright (o Node 24 desta maquina o recusa), sem
 * Lighthouse e sem PageSpeed (sem chave, a API responde cota ZERO).
 *
 * ============================================================================
 * O QUE MEDE, E O QUE OS NUMEROS SIGNIFICAM
 * ============================================================================
 * A auditoria de SEO de 11/09/2026 (secao 7) mediu em PRODUCAO as CAUSAS do LCP
 * e do CLS ruins no mobile. Este script mede as mesmas causas contra um build
 * local, para que elas nao voltem em silencio:
 *  - transbordo horizontal em 412 px (`documentElement.scrollWidth`) — a causa do
 *    LCP de 5,1 s da ficha (secao 7.2);
 *  - o elemento de LCP e os atributos dele (`loading`, `fetchpriority`) — o
 *    backdrop saia `lazy` (secao 7.5);
 *  - `preload` da fonte no documento (secao 7.6) e o CLS ate o fim da carga;
 *  - FCP e LCP em milissegundos.
 *
 * Os milissegundos sao de LABORATORIO LOCAL: sem CDN, com o banco semeado do
 * validador e com TODA requisicao que nao seja da base local BLOQUEADA (imagem do
 * TMDB inclusive — nada sai para a rede). Servem para comparar um build com outro,
 * nunca para citar como numero de producao.
 *
 * Perfis: mobile com os parametros do modo `devtools` do Lighthouse para "slow 4G"
 * (562,5 ms de latencia, 1.474,56 kbps de descida, 675 kbps de subida, CPU 4x) em
 * 412x915 @2,625; desktop sem limitacao, em 1350x940.
 *
 * ============================================================================
 * USO
 * ============================================================================
 *   CINERIE_LAB_HOLD_SECONDS=900 pnpm --filter @screena/web validate:route-cache
 *   PERF_LAB_BASE=http://127.0.0.1:PORTA pnpm --filter @screena/web perf:lab
 *
 * Variaveis: PERF_LAB_BASE (obrigatoria), PERF_LAB_CHROME (caminho do Chrome),
 * PERF_LAB_RUNS (padrao 3, mediana), PERF_LAB_PATHS (caminhos separados por
 * virgula). Sai com codigo 1 quando uma CAUSA estrutural volta.
 */

import { answerPausedRequest, type Cdp, closeChrome, DEFAULT_CHROME, launchChrome, openTab, sleep } from "./lab/cdp-chrome";

const BASE = (process.env.PERF_LAB_BASE ?? "").replace(/\/$/, "");
const CHROME = process.env.PERF_LAB_CHROME ?? DEFAULT_CHROME;
const RUNS = Math.max(1, Number(process.env.PERF_LAB_RUNS ?? "3"));
const PATHS = (process.env.PERF_LAB_PATHS ?? "/pt/,/pt/filmes/filme-1/,/pt/series/serie-1/")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value !== "");

interface Profile {
  readonly name: "mobile" | "desktop";
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly mobile: boolean;
  readonly cpuSlowdown: number;
  /** `null` = sem limitacao de rede. Vazao em BYTES por segundo, como o CDP pede. */
  readonly network: { readonly latency: number; readonly download: number; readonly upload: number } | null;
}

const PROFILES: readonly Profile[] = [
  {
    name: "mobile",
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    cpuSlowdown: 4,
    network: { latency: 562.5, download: (1474.56 * 1024) / 8, upload: (675 * 1024) / 8 },
  },
  {
    name: "desktop",
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    mobile: false,
    cpuSlowdown: 1,
    network: null,
  },
];

// ---------------------------------------------------------------------------
// Medicao (o cliente do DevTools Protocol mora em `lab/cdp-chrome.ts`)
// ---------------------------------------------------------------------------

/** Instalado em todo documento novo, ANTES do primeiro script da pagina. */
const OBSERVER_SCRIPT = `(() => {
  const lab = { lcp: null, cls: 0 };
  window.__cinerieLab = lab;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const el = entry.element;
      lab.lcp = {
        time: entry.startTime,
        tag: el ? el.tagName.toLowerCase() : null,
        className: el && typeof el.className === "string" ? el.className.slice(0, 80) : null,
        loading: el ? el.getAttribute("loading") : null,
        fetchPriority: el ? el.getAttribute("fetchpriority") : null,
      };
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) lab.cls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
})();`;

const READ_SCRIPT = `JSON.stringify({
  lcp: window.__cinerieLab ? window.__cinerieLab.lcp : null,
  cls: window.__cinerieLab ? window.__cinerieLab.cls : null,
  fcp: (performance.getEntriesByName("first-contentful-paint")[0] || { startTime: null }).startTime,
  scrollWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  fontPreload: document.querySelector('link[rel="preload"][as="font"]') !== null,
  imagesWithSrcset: document.querySelectorAll("img[srcset]").length,
})`;

interface RunResult {
  readonly fcp: number | null;
  readonly lcp: number | null;
  readonly lcpElement: string;
  readonly lcpLoading: string | null;
  readonly cls: number;
  readonly scrollWidth: number;
  readonly viewportWidth: number;
  readonly fontPreload: boolean;
  readonly imagesWithSrcset: number;
  readonly bytes: number;
  readonly blockedExternal: number;
}

async function measure(cdp: Cdp, url: string, profile: Profile): Promise<RunResult> {
  await cdp.send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.deviceScaleFactor,
    mobile: profile.mobile,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuSlowdown });
  await cdp.send(
    "Network.emulateNetworkConditions",
    profile.network === null
      ? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
      : {
          offline: false,
          latency: profile.network.latency,
          downloadThroughput: profile.network.download,
          uploadThroughput: profile.network.upload,
        },
  );

  let bytes = 0;
  let blockedExternal = 0;
  cdp.on("Network.loadingFinished", (params) => {
    bytes += Number(params.encodedDataLength ?? 0);
  });
  // NADA sai para a rede: o que nao for da base local e recusado aqui.
  cdp.on("Fetch.requestPaused", (params) => {
    if (!answerPausedRequest(cdp, params, (url) => url.startsWith(BASE))) blockedExternal += 1;
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
  // O LCP so fecha depois da carga; o mobile limitado precisa de mais folga.
  await sleep(profile.mobile ? 5000 : 2500);

  const evaluated = await cdp.send("Runtime.evaluate", { expression: READ_SCRIPT, returnByValue: true });
  cdp.clear("Network.loadingFinished");
  cdp.clear("Fetch.requestPaused");
  cdp.clear("Page.loadEventFired");

  const value = (evaluated.result as { value?: string } | undefined)?.value ?? "{}";
  const read = JSON.parse(value) as {
    lcp: { time: number; tag: string | null; className: string | null; loading: string | null } | null;
    cls: number | null;
    fcp: number | null;
    scrollWidth: number;
    viewportWidth: number;
    fontPreload: boolean;
    imagesWithSrcset: number;
  };
  return {
    fcp: read.fcp,
    lcp: read.lcp?.time ?? null,
    lcpElement:
      read.lcp === null ? "(nenhum)" : `${read.lcp.tag ?? "?"}${read.lcp.className ? `.${read.lcp.className.split(" ")[0]}` : ""}`,
    lcpLoading: read.lcp?.loading ?? null,
    cls: read.cls ?? 0,
    scrollWidth: read.scrollWidth,
    viewportWidth: read.viewportWidth,
    fontPreload: read.fontPreload,
    imagesWithSrcset: read.imagesWithSrcset,
    bytes,
    blockedExternal,
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function ms(value: number | null): string {
  return value === null ? "—" : `${Math.round(value).toLocaleString("pt-BR")} ms`;
}

async function main(): Promise<void> {
  if (BASE === "") throw new Error("PERF_LAB_BASE e obrigatoria (ex.: http://127.0.0.1:3000)");

  const chrome = await launchChrome(CHROME, "cinerie-perf-lab-");
  const failures: string[] = [];
  const warnings: string[] = [];
  try {
    const cdp = await openTab(chrome.port);
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVER_SCRIPT });

    process.stdout.write(`\nLABORATORIO DE DESEMPENHO LOCAL — ${BASE} — ${RUNS} execucao(oes) por caso, mediana\n`);
    process.stdout.write("(milissegundos de laboratorio local: comparam builds, nao valem como numero de producao)\n\n");

    for (const pagePath of PATHS) {
      for (const profile of PROFILES) {
        const runs: RunResult[] = [];
        for (let run = 0; run < RUNS; run += 1) runs.push(await measure(cdp, `${BASE}${pagePath}`, profile));
        const last = runs[runs.length - 1] as RunResult;
        const cls = median(runs.map((r) => r.cls)) ?? 0;
        const scrollWidth = Math.max(...runs.map((r) => r.scrollWidth));

        process.stdout.write(
          `${pagePath} [${profile.name}] FCP ${ms(median(runs.flatMap((r) => (r.fcp === null ? [] : [r.fcp]))))}` +
            ` · LCP ${ms(median(runs.flatMap((r) => (r.lcp === null ? [] : [r.lcp]))))} (${last.lcpElement}` +
            `${last.lcpLoading === null ? "" : `, loading=${last.lcpLoading}`})` +
            ` · CLS ${cls.toFixed(3)} · scrollWidth ${scrollWidth}/${last.viewportWidth}` +
            ` · ${Math.round((median(runs.map((r) => r.bytes)) ?? 0) / 1024)} KB locais` +
            ` · ${last.blockedExternal} externa(s) bloqueada(s)` +
            ` · preload de fonte: ${last.fontPreload ? "sim" : "NAO"} · img com srcset: ${last.imagesWithSrcset}\n`,
        );

        if (scrollWidth > last.viewportWidth + 1) {
          failures.push(`${pagePath} [${profile.name}]: transbordo horizontal — scrollWidth ${scrollWidth} > ${last.viewportWidth}`);
        }
        if (!last.fontPreload) failures.push(`${pagePath} [${profile.name}]: sem preload da fonte`);
        if (last.lcpLoading === "lazy") {
          failures.push(`${pagePath} [${profile.name}]: o elemento de LCP (${last.lcpElement}) carrega com loading=lazy`);
        }
        if (cls > 0.1) warnings.push(`${pagePath} [${profile.name}]: CLS ${cls.toFixed(3)} acima de 0,1`);
      }
    }
    cdp.close();
  } finally {
    await closeChrome(chrome);
  }

  process.stdout.write("\n");
  for (const warning of warnings) process.stdout.write(`[AVISO] ${warning}\n`);
  for (const failure of failures) process.stdout.write(`[FALHA] ${failure}\n`);
  process.stdout.write(
    failures.length === 0
      ? "\nRESULTADO: nenhuma causa estrutural da secao 7 voltou.\n"
      : `\nRESULTADO: ${failures.length} causa(s) estrutural(is) de volta.\n`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

// `process.exit` explicito: com o Chrome como processo filho, `exitCode` sozinho
// pode nao ser o codigo com que o processo termina (ver o validador de cache).
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[FALHA] o laboratorio abortou:", error);
    process.exit(1);
  });
