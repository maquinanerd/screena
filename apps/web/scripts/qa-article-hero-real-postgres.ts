/**
 * qa-article-hero-real-postgres.ts — QA VISUAL do hero da MATERIA contra a
 * APLICACAO NEXT.JS REAL e PostgreSQL 16 REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * O que este script prova (e um teste de fonte NAO prova):
 *  - a capa full-bleed sob o header transparente, no DOM que o Next emite;
 *  - a materia SEM capa: header solido, titulo escuro na coluna de leitura;
 *  - a virada transparente -> solido quando o hero passa por baixo da barra;
 *  - CONTRASTE MEDIDO em pixel real, sobre a capa mais hostil possivel (branca
 *    chapada) — nao sobre a foto escura de exemplo;
 *  - o credito da capa em imagem clara e em imagem escura;
 *  - os quatro casos de legenda/credito de imagem de corpo;
 *  - que nenhuma outra rota mudou de estado.
 *
 * A medicao de contraste e feita nos BYTES da captura: as camadas de texto sao
 * escondidas, a regiao e fotografada, os pixels sao decodificados pelo proprio
 * browser (canvas) e o resultado e composto com a cor computada do texto. E o
 * fundo que o usuario realmente ve — imagem + scrim + header —, nao a soma
 * teorica dos gradientes do CSS.
 *
 * Motor de banco: `embedded-postgres` (PostgreSQL 16 real, binario portatil,
 * EFEMERO), o mesmo padrao dos demais `validate:*-real-postgres`.
 *
 * Seguranca:
 *  - ZERO producao: DATABASE_URL aponta SEMPRE para 127.0.0.1 num banco
 *    descartavel, e o script ABORTA se receber host remoto.
 *  - ZERO rede: nenhuma chamada a TMDB/RapidAPI/Gemini. A rota de midia
 *    editorial e INTERCEPTADA e servida por PNG local gerado aqui.
 *  - Nenhum `.env` de producao e lido ou copiado.
 *  - Postgres derrubado e diretorio removido no `finally`.
 *
 * Pre-requisito: `pnpm build` (o script sobe `next start` sobre o build atual).
 * Uso: pnpm --filter @screena/web qa:article-hero
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import EmbeddedPostgres from "embedded-postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));
const webRequire = createRequire(path.join(webDir, "package.json"));

const LANGUAGE = "pt-BR";
const OUT_DIR = path.join(webDir, ".qa-article-hero");

/** Caminho publico de capa (casa com `/media/editorial/[...key]`). */
const HERO_PATH_BRIGHT = "/media/editorial/aa/aabbccddeeff0011.jpg";
const HERO_PATH_DARK = "/media/editorial/bb/bbccddeeff002233.jpg";

/** Viewports pedidos na revisao (celular pequeno, celular comum, tablet, desktop). */
const VIEWPORTS: ReadonlyArray<readonly [string, number, number]> = [
  ["360x640", 360, 640],
  ["390x844", 390, 844],
  ["768x1024", 768, 1024],
  ["1440x900", 1440, 900],
];

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
let counter = 0;
function record(name: string, ok: boolean, detail: string): void {
  counter += 1;
  results.push({ n: counter, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${counter}. ${name} — ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function prismaBin(): string {
  const pkgPath = dbRequire.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

/** Escapa string para literal SQL simples. */
function lit(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

// ------------------------------------------------------------------- imagens
/**
 * PNG solido. Capa BRANCA e o pior caso real para texto branco: nenhuma foto
 * do TMDB e mais clara que #FFFFFF, entao o que passar aqui passa em qualquer
 * capa. A capa quase-preta serve para o oposto: provar que o credito continua
 * visivel quando a imagem nao ajuda a separa-lo do fundo.
 */
function buildSolidPng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = 1 + x * 3;
      row[at] = rgb[0];
      row[at + 1] = rgb[1];
      row[at + 2] = rgb[2];
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- contraste
/** Luminancia relativa (WCAG 2.1) de um sRGB 0-255. */
function relativeLuminance(rgb: readonly [number, number, number]): number {
  const chan = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
}

function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Compoe `fg` (com alpha) sobre `bg` opaco. */
function composite(
  fg: readonly [number, number, number],
  alpha: number,
  bg: readonly [number, number, number],
): [number, number, number] {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ];
}

/** `rgb(...)`/`rgba(...)` -> canal + alpha. */
function parseCssColor(value: string): { rgb: [number, number, number]; alpha: number } {
  const nums = value.match(/[\d.]+/g) ?? [];
  return {
    rgb: [Number(nums[0] ?? 0), Number(nums[1] ?? 0), Number(nums[2] ?? 0)],
    alpha: nums.length > 3 ? Number(nums[3]) : 1,
  };
}

// ------------------------------------------------------------------ fixtures
type Sql = {
  q: <T>(sql: string) => Promise<T[]>;
  x: (sql: string) => Promise<number>;
};

interface Fixtures {
  withHero: string;
  withoutHero: string;
  heroNoCredit: string;
  darkHero: string;
}

const PAST = "now() - interval '2 days'";

/** Blocos de corpo cobrindo os QUATRO casos de legenda/credito. */
const BODY_BLOCKS = JSON.stringify([
  {
    type: "paragraph",
    text: "O titulo do filme britanico levanta questoes sobre possessao, um tema ja explorado diversas vezes pela versao americana, especialmente em episodios tematicos de feriados.",
  },
  {
    type: "image",
    publicPath: HERO_PATH_BRIGHT,
    alt: "Dois personagens em cena numa sala de reunioes",
    caption:
      "Danielle Pinnock como Alberta e Richie Moriarty como Pete em cena da serie, que estreia dia 23.",
    credit: "Bertrand Calmeau/CBS (c)2026 CBS Broadcasting, Inc.",
  },
  { type: "paragraph", text: "CASO 2 — so legenda, sem credito. O rotulo nao pode aparecer." },
  {
    type: "image",
    publicPath: HERO_PATH_BRIGHT,
    alt: "Cena externa de arquivo",
    caption: "Somente legenda: este bloco nao declara credito.",
    credit: null,
  },
  { type: "paragraph", text: "CASO 3 — so credito, sem legenda. Nada de separador pendurado." },
  {
    type: "image",
    publicPath: HERO_PATH_BRIGHT,
    alt: "Retrato do diretor",
    caption: null,
    credit: "Divulgacao/Estudio",
  },
  { type: "paragraph", text: "CASO 4 — nem legenda nem credito. O bloco de texto nao existe." },
  {
    type: "image",
    publicPath: HERO_PATH_BRIGHT,
    alt: "Imagem sem descricao nem credito",
    caption: null,
    credit: null,
  },
  {
    type: "paragraph",
    text: "A essencia da serie reside em conflitos cotidianos, como discussoes sobre tarefas domesticas e personalidades de seculos diferentes que se recusam a ceder.",
  },
]);

async function seedFixtures({ q, x }: Sql): Promise<Fixtures> {
  // `content_hash` tem CHECK de forma (`sha256:<64 hex>`) — o QA respeita o
  // contrato do banco em vez de relaxa-lo. Hash deterministico e ficticio: os
  // BYTES sao servidos pela interceptacao do browser, nao pelo storage.
  let hashSeed = 0;
  const fakeSha = (): string => {
    hashSeed += 1;
    return `sha256:${hashSeed.toString(16).padStart(64, "0")}`;
  };

  const mediaId = async (
    payloadId: string,
    publicPath: string,
    credit: string | null,
  ): Promise<string> =>
    (
      await q<{ id: bigint }>(
        `INSERT INTO editorial_media_assets
           (payload_media_id, content_hash, storage_key, public_path, mime_type, width, height,
            byte_size, alt, caption, credit, license_status, requires_attribution,
            allowed_for_editorial, allowed_for_hero, allowed_for_social, updated_at)
         VALUES (${lit(payloadId)}, ${lit(fakeSha())}, ${lit(`editorial/qa/${payloadId}.jpg`)},
                 ${lit(publicPath)}, 'image/jpeg', 1600, 900, 120000,
                 'Cena de abertura da materia', NULL, ${lit(credit)}, 'approved', true,
                 true, true, true, now())
         RETURNING id`,
      )
    )[0]!.id.toString();

  const article = async (
    opts: {
      heroPath: string | null;
      heroMedia: string | null;
      slug: string;
      title: string;
      deck: string | null;
      author: string | null;
      withBlocks: boolean;
    },
  ): Promise<string> => {
    const id = (
      await q<{ id: bigint }>(
        `INSERT INTO articles
           (category, author_name, hero_image_path, published_at, read_time_minutes, ai_assisted,
            source_name, source_url, license_status, display_allowed, requires_attribution,
            requires_linkback, hero_media_asset_id, updated_at)
         VALUES ('Cinema', ${lit(opts.author)}, ${lit(opts.heroPath)}, ${PAST}, 6, false,
                 'Redacao Cinerie', 'https://cinerie.com/', 'official', true, false, false,
                 ${opts.heroMedia ?? "NULL"}, now())
         RETURNING id`,
      )
    )[0]!.id.toString();
    await x(
      // `body_blocks` e `body_blocks_version` sao PAREADOS por CHECK: bloco sem
      // versao (ou o inverso) e recusado pelo banco.
      `INSERT INTO article_translations
         (article_id, language_code, slug, title, deck, body, review_status, index_status,
          published_at, body_blocks, body_blocks_version, updated_at)
       VALUES (${id}, ${lit(LANGUAGE)}, ${lit(opts.slug)}, ${lit(opts.title)}, ${lit(opts.deck)},
               ${lit("Paragrafo legado do corpo textual, usado quando nao ha blocos projetados. Serve para a pagina nunca ficar vazia enquanto o CMS nao projeta a estrutura.")},
               'published', 'index', ${PAST},
               ${opts.withBlocks ? `${lit(BODY_BLOCKS)}::jsonb` : "NULL"},
               ${opts.withBlocks ? lit(`qa-${opts.slug.slice(0, 16)}`) : "NULL"}, now())`,
    );
    return id;
  };

  const brightMedia = await mediaId(
    "qa-hero-bright",
    HERO_PATH_BRIGHT,
    "Bertrand Calmeau/CBS (c)2026 CBS Broadcasting, Inc.",
  );
  const darkMedia = await mediaId("qa-hero-dark", HERO_PATH_DARK, "Divulgacao/Estudio Cinerie");
  const noCreditMedia = await mediaId("qa-hero-nocredit", "/media/editorial/cc/ccdd001122334455.jpg", null);

  return {
    // Titulo LONGO de proposito: exercita a quebra em varias linhas no celular.
    withHero: await article({
      heroPath: HERO_PATH_BRIGHT,
      heroMedia: brightMedia,
      slug: "qa-materia-com-capa-e-titulo-bem-longo-para-quebrar-em-varias-linhas",
      title:
        "Por que o formato de filme pode ser um risco para a adaptacao da serie mais querida da temporada",
      deck: "O autor expande sua atuacao no cinema com dois novos projetos originais, consolidando sua independencia criativa apos mudancas contratuais.",
      author: "Redacao Cinerie",
      withBlocks: true,
    }),
    withoutHero: await article({
      heroPath: null,
      heroMedia: null,
      slug: "qa-materia-sem-capa",
      title: "Materia sem imagem de destaque, como chega da fonte RSS",
      deck: "Sem capa o cabecalho da materia volta para a coluna de leitura, em texto escuro sobre a base clara.",
      author: "Redacao Cinerie",
      withBlocks: false,
    }),
    heroNoCredit: await article({
      heroPath: "/media/editorial/cc/ccdd001122334455.jpg",
      heroMedia: noCreditMedia,
      slug: "qa-materia-com-capa-sem-credito",
      title: "Capa sem credito declarado",
      deck: "Nenhum residuo visual pode sobrar no canto do hero.",
      author: null,
      withBlocks: false,
    }),
    darkHero: await article({
      heroPath: HERO_PATH_DARK,
      heroMedia: darkMedia,
      slug: "qa-materia-com-capa-escura",
      title: "Capa escura",
      deck: "O credito precisa continuar legivel quando a imagem nao ajuda.",
      author: "Redacao Cinerie",
      withBlocks: false,
    }),
  };
}

// ------------------------------------------------------------------ leitura
/** Executado NO BROWSER: estado do header + geometria do hero. */
const READ_STATE = `() => {
  const header = document.querySelector('.site-header');
  const hero = document.querySelector('.art-hero');
  const cs = header ? getComputedStyle(header) : null;
  const heroBox = hero ? hero.getBoundingClientRect() : null;
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, color: getComputedStyle(el).color, text: (el.textContent || '').trim().slice(0, 80) };
  };
  const logoVisible = [...document.querySelectorAll('.site-header__logo')]
    .filter((i) => getComputedStyle(i).display !== 'none')
    .map((i) => i.getAttribute('src'));
  return {
    headerBg: cs ? cs.backgroundColor : null,
    headerBorder: cs ? cs.borderBottomWidth : null,
    pastHero: header ? header.getAttribute('data-past-hero') : null,
    heroMedia: hero ? hero.getAttribute('data-hero-media') : null,
    heroTop: heroBox ? heroBox.top : null,
    heroHeight: heroBox ? heroBox.height : null,
    viewportHeight: window.innerHeight,
    spacerDisplay: document.querySelector('.site-header__spacer')
      ? getComputedStyle(document.querySelector('.site-header__spacer')).display
      : 'absent',
    logoVisible,
    crumb: pick('.art-crumb'),
    date: pick('.art-hero__date'),
    title: pick('.art-title'),
    deck: pick('.art-deck'),
    byline: pick('.art-byline'),
    credit: pick('.art-hero__credit'),
    navLink: pick('.site-header__link'),
    bodyTop: document.querySelector('.art-body')
      ? document.querySelector('.art-body').getBoundingClientRect().top
      : null,
    figcaptions: [...document.querySelectorAll('.art-figure__caption')].map((f) => ({
      text: (f.textContent || '').trim(),
      hasCreditSpan: !!f.querySelector('.art-figure__credit'),
    })),
    figureCount: document.querySelectorAll('.art-figure').length,
  };
}`;

/** Esconde o texto do hero para fotografar SO o fundo composto. */
const HIDE_TEXT = `() => {
  const style = document.createElement('style');
  style.id = 'qa-hide-text';
  style.textContent = '.art-hero__inner *, .site-header__inner * { visibility: hidden !important; }';
  document.head.appendChild(style);
}`;

const SHOW_TEXT = `() => { document.getElementById('qa-hide-text')?.remove(); }`;

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  color: string;
  text: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const brightPng = buildSolidPng(1600, 900, [255, 255, 255]);
  const darkPng = buildSolidPng(1600, 900, [12, 12, 14]);

  const pgPort = await freePort();
  const appPort = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-article-hero-pg-"));
  const newPg = (utf8: boolean): EmbeddedPostgres =>
    new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "postgres",
      port: pgPort,
      persistent: true,
      initdbFlags: utf8 ? ["--encoding=UTF8", "--locale=C"] : [],
    });
  let pg = newPg(true);
  let clusterEncoding = "UTF8";
  const dbName = "cinerie_article_hero_qa";
  const url = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/${dbName}?schema=public`;

  // Trava dura: este script NUNCA fala com banco que nao seja local descartavel.
  if (!/@127\.0\.0\.1:/.test(url) || !url.includes(dbName)) {
    throw new Error("abort: DATABASE_URL de QA nao e local/descartavel");
  }
  console.log(
    `\n=== Postgres efemero :${pgPort} | app Next real :${appPort} | banco ${dbName} ===\n`,
  );

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  let server: ChildProcess | undefined;
  let browser: { close: () => Promise<void> } | undefined;

  try {
    try {
      await pg.initialise();
    } catch (e) {
      const reason = (e as Error).message.split("\n")[0] ?? "";
      if (!/invalid byte sequence|encoding/i.test(reason)) throw e;
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
      mkdirSync(dataDir, { recursive: true });
      pg = newPg(false);
      clusterEncoding = "padrao do SO (UTF8 indisponivel: caminho com caractere nao-ASCII)";
      await pg.initialise();
    }
    await pg.start();
    started = true;
    await pg.createDatabase(dbName);

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    console.log("--- prisma db seed ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record("migrate deploy + db:seed no PostgreSQL 16 efemero", true, `encoding: ${clusterEncoding}`);

    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => {
        $executeRawUnsafe: (sql: string) => Promise<number>;
        $queryRawUnsafe: <T>(sql: string) => Promise<T[]>;
      };
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const prisma = dbServer.getPrismaClient();
    const sql: Sql = {
      q: (s) => prisma.$queryRawUnsafe(s),
      x: (s) => prisma.$executeRawUnsafe(s),
    };
    const fixtures = await seedFixtures(sql);
    record(
      "fixtures QA criadas (capa clara, sem capa, capa sem credito, capa escura)",
      true,
      `ids=${Object.values(fixtures).join(",")}`,
    );

    // ------------------------------------------------------ app Next.js real
    const nextBin = webRequire.resolve("next/dist/bin/next");
    server = spawn("node", [nextBin, "start", "-p", String(appPort), "-H", "127.0.0.1"], {
      cwd: webDir,
      env: { ...env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (d: Buffer) => process.stdout.write(`[next] ${d}`));
    server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[next] ${d}`));

    const base = `http://127.0.0.1:${appPort}`;
    const deadline = Date.now() + 90000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/pt/`);
        if (res.status < 500) {
          up = true;
          break;
        }
      } catch {
        /* ainda subindo */
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    record("aplicacao Next.js real respondendo", up, up ? base : "timeout 90s");
    if (!up) throw new Error("next start nao respondeu");

    const { chromium } = (await import("@playwright/test")) as typeof import("@playwright/test");
    const b = await chromium.launch();
    browser = b;
    /** Pagina em branco usada so para DECODIFICAR PNG via canvas. */
    const decoder = await b.newPage();
    await decoder.goto("about:blank");

    const openPage = async (width: number, height: number) => {
      const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      // Midia editorial servida por PNG LOCAL: QA deterministico e offline.
      await page.route("**/media/editorial/**", async (route) => {
        const isDark = route.request().url().includes("/bb/");
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: isDark ? darkPng : brightPng,
        });
      });
      return page;
    };

    /** Cor media REAL de uma regiao da tela (texto escondido). */
    const sampleBackground = async (
      page: import("@playwright/test").Page,
      rect: { left: number; top: number; width: number; height: number },
    ): Promise<[number, number, number]> => {
      const clip = {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
      const shot = await page.screenshot({ clip });
      const dataUrl = `data:image/png;base64,${shot.toString("base64")}`;
      return (await decoder.evaluate(async (src: string) => {
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = src;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("sem canvas 2d");
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, img.width, img.height);
        let r = 0;
        let g = 0;
        let bl = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]!;
          g += data[i + 1]!;
          bl += data[i + 2]!;
        }
        return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
      }, dataUrl)) as [number, number, number];
    };

    /** Contraste REAL de um elemento contra o fundo composto atras dele. */
    const measure = async (
      page: import("@playwright/test").Page,
      label: string,
      rect: Rect,
    ): Promise<{ label: string; ratio: number; bg: string; fg: string }> => {
      await page.evaluate(`(${HIDE_TEXT})()`);
      const bg = await sampleBackground(page, rect);
      await page.evaluate(`(${SHOW_TEXT})()`);
      const { rgb, alpha } = parseCssColor(rect.color);
      const fg = composite(rgb, alpha, bg);
      return {
        label,
        ratio: contrastRatio(fg, bg),
        bg: `rgb(${bg.join(",")})`,
        fg: `rgb(${fg.join(",")})`,
      };
    };

    const heroUrl = `${base}/pt/noticias/qa-materia-com-capa-e-titulo-bem-longo-para-quebrar-em-varias-linhas/`;
    const noHeroUrl = `${base}/pt/noticias/qa-materia-sem-capa/`;
    const noCreditUrl = `${base}/pt/noticias/qa-materia-com-capa-sem-credito/`;
    const darkUrl = `${base}/pt/noticias/qa-materia-com-capa-escura/`;

    // ---------------------------------------- 1. capa: altura e primeira dobra
    for (const [name, w, h] of VIEWPORTS) {
      const page = await openPage(w, h);
      await page.goto(heroUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT_DIR, `01-com-capa-${name}.png`) });
      const s = (await page.evaluate(`(${READ_STATE})()`)) as {
        heroTop: number;
        heroHeight: number;
        viewportHeight: number;
        bodyTop: number;
        heroMedia: string | null;
        headerBg: string;
        spacerDisplay: string;
        logoVisible: string[];
        crumb: Rect;
        title: Rect;
      };
      const pct = Math.round((s.heroHeight / s.viewportHeight) * 100);
      record(
        `capa @${name}: hero encosta no topo e nao ocupa a dobra inteira`,
        s.heroTop === 0 && s.heroHeight < s.viewportHeight * 0.92,
        `top=${s.heroTop}px altura=${Math.round(s.heroHeight)}px (${pct}% da dobra), corpo comeca em y=${Math.round(s.bodyTop)}px`,
      );
      record(
        `capa @${name}: sobra texto visivel na primeira dobra`,
        s.bodyTop < s.viewportHeight - 40,
        `${Math.round(s.viewportHeight - s.bodyTop)}px de corpo visiveis abaixo do hero`,
      );
      record(
        `capa @${name}: header transparente, sem faixa, com wordmark BRANCA`,
        /rgba\(0, 0, 0, 0\)|transparent/.test(s.headerBg) &&
          s.spacerDisplay === "none" &&
          s.logoVisible.length === 1 &&
          s.logoVisible[0]!.includes("white"),
        `bg=${s.headerBg} spacer=${s.spacerDisplay} logo=${s.logoVisible.join("|")}`,
      );
      await page.close();
    }

    // ------------------------------------- 2. CONTRASTE sobre capa BRANCA
    {
      const page = await openPage(1440, 900);
      await page.goto(heroUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const s = (await page.evaluate(`(${READ_STATE})()`)) as Record<string, Rect | null>;
      const targets: ReadonlyArray<readonly [string, Rect | null, number]> = [
        ["breadcrumb (11px)", s.crumb, 4.5],
        ["data (13px)", s.date, 4.5],
        ["titulo (52px, texto grande)", s.title, 3],
        ["resumo (18px)", s.deck, 4.5],
        ["assinatura (12px)", s.byline, 4.5],
        ["credito da capa (11px)", s.credit, 4.5],
        ["link do menu (13px)", s.navLink, 4.5],
      ];
      const lines: string[] = [];
      for (const [label, rect, floor] of targets) {
        if (rect === null) {
          record(`contraste: ${label}`, false, "elemento ausente");
          continue;
        }
        const m = await measure(page, label, rect);
        lines.push(`${label}: ${m.ratio.toFixed(2)}:1 (texto ${m.fg} sobre ${m.bg}, minimo ${floor})`);
        record(
          `contraste AA sobre capa BRANCA — ${label}`,
          m.ratio >= floor,
          `${m.ratio.toFixed(2)}:1 (minimo ${floor}) — fundo real ${m.bg}`,
        );
      }
      writeFileSync(path.join(OUT_DIR, "contraste-capa-branca.txt"), lines.join("\n"), "utf8");
      await page.screenshot({ path: path.join(OUT_DIR, "02-contraste-capa-branca-1440x900.png") });
      await page.close();
    }

    // ------------------------------------------ 3. virada transparente/solido
    {
      const page = await openPage(1440, 900);
      await page.goto(heroUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const before = (await page.evaluate(`(${READ_STATE})()`)) as {
        headerBg: string;
        pastHero: string | null;
        heroHeight: number;
        crumb: Rect;
      };
      /*
       * Varredura de COLISAO. Contraste sozinho nao pega este defeito: com a
       * barra transparente ate o fim do hero, a manchete de 52px sobe POR CIMA
       * do menu — os dois lados legiveis, e ilegiveis juntos. Aqui o scroll
       * avanca em passos e, a cada passo em que a barra ainda esta
       * transparente, nenhum texto do hero pode ocupar a faixa dela.
       */
      const steps = 14;
      let overlapAt: string | null = null;
      let lastTransparent = 0;
      for (let i = 1; i <= steps; i += 1) {
        const y = Math.round((before.heroHeight * i) / steps);
        await page.evaluate(`window.scrollTo(0, ${y})`);
        await page.waitForTimeout(120);
        const s = (await page.evaluate(`(${READ_STATE})()`)) as {
          headerBg: string;
          crumb: Rect | null;
          date: Rect | null;
          title: Rect | null;
          deck: Rect | null;
          byline: Rect | null;
          credit: Rect | null;
        };
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(s.headerBg)) break;
        lastTransparent = y;
        for (const [label, r] of [
          ["breadcrumb", s.crumb],
          ["data", s.date],
          ["titulo", s.title],
          ["resumo", s.deck],
          ["assinatura", s.byline],
          ["credito", s.credit],
        ] as ReadonlyArray<readonly [string, Rect | null]>) {
          if (r === null) continue;
          if (r.top < 72 && r.bottom > 0) {
            overlapAt ??= `${label} invadiu a faixa do header em scrollY=${y} (top=${Math.round(r.top)})`;
          }
        }
      }
      await page.evaluate(`window.scrollTo(0, ${lastTransparent})`);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT_DIR, "03-ultimo-quadro-transparente-1440x900.png") });
      record(
        "enquanto transparente, o header flutua so sobre IMAGEM (nenhum texto do hero na faixa)",
        overlapAt === null,
        overlapAt ?? `varredura de ${steps} passos ate o fim do hero, sem sobreposicao`,
      );
      const midContrast = await measure(page, "menu no ultimo quadro transparente", {
        ...before.crumb,
        top: 0,
        bottom: 72,
        height: 72,
      });
      record(
        "no ultimo quadro transparente o menu segue legivel sobre capa branca",
        midContrast.ratio >= 4.5,
        `scrollY=${lastTransparent} contraste=${midContrast.ratio.toFixed(2)}:1 sobre ${midContrast.bg}`,
      );
      // Alem do hero: volta ao solido.
      await page.evaluate(`window.scrollTo(0, ${Math.round(before.heroHeight + 200)})`);
      await page.waitForTimeout(500);
      const after = (await page.evaluate(`(${READ_STATE})()`)) as {
        headerBg: string;
        pastHero: string | null;
        logoVisible: string[];
      };
      await page.screenshot({ path: path.join(OUT_DIR, "04-scroll-alem-do-hero-1440x900.png") });
      record(
        "passando do hero o header volta ao SOLIDO com wordmark preta",
        after.pastHero === "true" &&
          !/rgba\(0, 0, 0, 0\)|transparent/.test(after.headerBg) &&
          after.logoVisible.length === 1 &&
          after.logoVisible[0]!.includes("black"),
        `pastHero=${after.pastHero ?? "-"} bg=${after.headerBg} logo=${after.logoVisible.join("|")}`,
      );
      record(
        "no topo o header comeca transparente (estado inicial correto)",
        /rgba\(0, 0, 0, 0\)|transparent/.test(before.headerBg) && before.pastHero === null,
        `bg=${before.headerBg} pastHero=${before.pastHero ?? "ausente"}`,
      );
      await page.close();
    }

    // --------------------------------------------- 4. materia SEM capa
    for (const [name, w, h] of VIEWPORTS) {
      const page = await openPage(w, h);
      await page.goto(noHeroUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT_DIR, `05-sem-capa-${name}.png`) });
      const s = (await page.evaluate(`(${READ_STATE})()`)) as {
        heroMedia: string | null;
        headerBg: string;
        spacerDisplay: string;
        logoVisible: string[];
        title: Rect;
        heroTop: number;
      };
      const titleRgb = parseCssColor(s.title.color).rgb;
      record(
        `sem capa @${name}: header SOLIDO, wordmark preta, spacer preservado`,
        !/rgba\(0, 0, 0, 0\)|transparent/.test(s.headerBg) &&
          s.spacerDisplay === "block" &&
          s.logoVisible.length === 1 &&
          s.logoVisible[0]!.includes("black"),
        `bg=${s.headerBg} spacer=${s.spacerDisplay} logo=${s.logoVisible.join("|")}`,
      );
      record(
        `sem capa @${name}: titulo ESCURO, na coluna, abaixo da barra`,
        s.heroMedia === null &&
          relativeLuminance(titleRgb) < 0.1 &&
          s.heroTop >= 60 &&
          s.title.left >= 16,
        `data-hero-media=${s.heroMedia ?? "ausente"} cor=${s.title.color} heroTop=${Math.round(s.heroTop)}px titleLeft=${Math.round(s.title.left)}px`,
      );
      if (name === "1440x900") {
        const contrast = contrastRatio(titleRgb, [253, 253, 253]);
        record(
          "sem capa: titulo escuro sobre a base clara passa AA com folga",
          contrast >= 7,
          `${contrast.toFixed(2)}:1`,
        );
      }
      await page.close();
    }

    // ------------------------------- 5. credito: claro, escuro e AUSENTE
    {
      const page = await openPage(1440, 900);
      await page.goto(darkUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const s = (await page.evaluate(`(${READ_STATE})()`)) as { credit: Rect | null };
      await page.screenshot({ path: path.join(OUT_DIR, "06-credito-capa-escura-1440x900.png") });
      if (s.credit === null) {
        record("credito sobre capa ESCURA", false, "credito ausente");
      } else {
        const m = await measure(page, "credito", s.credit);
        record(
          "credito legivel sobre capa ESCURA",
          m.ratio >= 4.5,
          `${m.ratio.toFixed(2)}:1 sobre ${m.bg} — texto "${s.credit.text}"`,
        );
      }
      await page.close();
    }
    {
      const page = await openPage(1440, 900);
      await page.goto(noCreditUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT_DIR, "07-capa-sem-credito-1440x900.png") });
      const s = (await page.evaluate(`(${READ_STATE})()`)) as { credit: Rect | null };
      const html = await page.content();
      record(
        "capa SEM credito nao deixa residuo: nenhum no, nenhum rotulo solto",
        s.credit === null && !html.includes("art-hero__credit") && !/Crédito:\s*<\//.test(html),
        s.credit === null ? "nenhum elemento .art-hero__credit no DOM" : "elemento presente",
      );
      await page.close();
    }
    // Credito no celular: nao encavala titulo nem resumo.
    for (const [name, w, h] of [VIEWPORTS[0]!, VIEWPORTS[1]!]) {
      const page = await openPage(w, h);
      await page.goto(heroUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT_DIR, `08-credito-mobile-${name}.png`) });
      const s = (await page.evaluate(`(${READ_STATE})()`)) as {
        credit: Rect;
        title: Rect;
        deck: Rect;
        byline: Rect;
      };
      const clears = s.credit.top >= s.byline.bottom - 1 && s.credit.top >= s.deck.bottom;
      record(
        `credito @${name}: abaixo de titulo/resumo/assinatura, sem encavalar`,
        clears,
        `credito.top=${Math.round(s.credit.top)} byline.bottom=${Math.round(s.byline.bottom)} deck.bottom=${Math.round(s.deck.bottom)}`,
      );
      await page.close();
    }

    // ------------------------------ 6. legenda/credito de imagem de CORPO
    {
      const page = await openPage(1440, 900);
      await page.goto(heroUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const s = (await page.evaluate(`(${READ_STATE})()`)) as {
        figcaptions: { text: string; hasCreditSpan: boolean }[];
        figureCount: number;
      };
      const caps = s.figcaptions;
      record(
        "corpo: 4 imagens, 3 legendas — o caso sem legenda e sem credito NAO renderiza bloco",
        s.figureCount === 4 && caps.length === 3,
        `figuras=${s.figureCount} figcaptions=${caps.length}`,
      );
      record(
        "caso 1 (legenda + credito): os dois, nessa ordem, no mesmo bloco",
        caps[0] !== undefined &&
          caps[0].hasCreditSpan &&
          caps[0].text.startsWith("Danielle Pinnock") &&
          caps[0].text.includes("Crédito: Bertrand Calmeau"),
        caps[0]?.text ?? "ausente",
      );
      record(
        "caso 2 (so legenda): sem rotulo Credito orfao",
        caps[1] !== undefined && !caps[1].hasCreditSpan && !caps[1].text.includes("Crédito"),
        caps[1]?.text ?? "ausente",
      );
      record(
        "caso 3 (so credito): so o credito, sem separador pendurado",
        caps[2] !== undefined &&
          caps[2].hasCreditSpan &&
          caps[2].text === "Crédito: Divulgacao/Estudio",
        caps[2]?.text ?? "ausente",
      );
      await page.screenshot({
        path: path.join(OUT_DIR, "09-legendas-corpo-1440x900.png"),
        fullPage: true,
      });
      await page.close();
    }

    // ------------------------------------- 7. nenhuma outra rota mudou
    {
      const routes: ReadonlyArray<readonly [string, string, boolean]> = [
        ["/pt/", "home", true],
        ["/pt/filmes/", "filmes", true],
        ["/pt/series/", "series", true],
        ["/pt/pessoas/", "pessoas", false],
        ["/pt/noticias/", "listagem de noticias", false],
        ["/pt/explorar/", "explorar", false],
      ];
      for (const [route, label, heroRoute] of routes) {
        const page = await openPage(1440, 900);
        await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(250);
        const s = (await page.evaluate(`(${READ_STATE})()`)) as {
          headerBg: string;
          pastHero: string | null;
          spacerDisplay: string;
          logoVisible: string[];
          heroMedia: string | null;
        };
        await page.screenshot({ path: path.join(OUT_DIR, `10-rota-${label.replace(/\s+/g, "-")}.png`) });
        // Sem hero de MATERIA, `data-past-hero` nunca aparece e o spacer segue
        // a regra antiga (ausente em rota de hero, presente no resto).
        const spacerOk = heroRoute ? s.spacerDisplay === "absent" : s.spacerDisplay === "block";
        record(
          `rota ${label} intacta (sem contaminacao do hero de materia)`,
          s.pastHero === null && s.heroMedia === null && spacerOk,
          `pastHero=${s.pastHero ?? "ausente"} spacer=${s.spacerDisplay} bg=${s.headerBg} logo=${s.logoVisible.join("|")}`,
        );
        await page.close();
      }
    }

    await decoder.close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) {
      server.kill();
      await new Promise((r) => setTimeout(r, 400));
    }
    if (disconnect) await disconnect().catch(() => undefined);
    if (started) await pg.stop().catch(() => undefined);
    delete process.env.DATABASE_URL;
    // O Windows costuma segurar handles do cluster por alguns instantes depois
    // do `stop`. Falhar a limpeza nao invalida o QA — mas apagar o erro real
    // que veio antes dela, sim. Por isso ela nao pode lancar.
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    } catch (e) {
      console.warn(`[qa] diretorio temporario nao removido: ${(e as Error).message}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n------------------------------------------------------------");
  console.log(`Resumo: ${results.length - failed.length} PASS, ${failed.length} FAIL`);
  console.log(`Capturas: ${OUT_DIR}`);
  console.log("------------------------------------------------------------\n");
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAIL ${f.n}. ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
