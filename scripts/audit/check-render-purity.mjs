#!/usr/bin/env node
// @ts-check
/**
 * check-render-purity.mjs — Pureza de render do app publico Screena.
 *
 * Invariantes protegidas:
 *  - "Zero API externa no render": paginas publicas indexaveis leem apenas
 *    PostgreSQL/cache local; nunca chamam TMDB, RapidAPI, Rotten Tomatoes,
 *    Gemini/Google APIs, IMDb ou qualquer host externo no caminho de render.
 *  - "Zero Gemini no render": a IA so roda offline.
 *
 * Imagens do TMDB (decisao de arquitetura: nao salvar imagem no servidor): a URL
 * publica de imagem (`image.tmdb.org`) e CONSTRUIDA (string) num unico helper
 * governado (`IMAGE_URL_HELPER_REL`) e renderizada por `<img src>`. Isso NAO viola
 * "zero API externa no render" (nao ha chamada de rede no render — so concatenacao
 * de string a partir do PostgreSQL). O literal do host continua PROIBIDO em
 * qualquer outro arquivo de apps/web, e `fetch(` a host TMDB segue barrado em
 * TODOS os arquivos (inclusive o helper). Nenhum token TMDB pode ir ao cliente.
 *
 * O que faz: varre apps/web (recursivo) procurando, em codigo de pagina
 * (server components / rotas), padroes proibidos:
 *   1) chamadas fetch( cujo alvo aponta para hosts externos conhecidos
 *      (tmdb / themoviedb / rapidapi / googleapis / gemini / generativelanguage
 *       / rottentomatoes / imdb);
 *   2) imports de clients de API ('../api-clients', '@screena/api-clients') ou
 *      do contrato de DB ('@screena/db') dentro de arquivos de pagina/layout.
 *      (O DB e lido por camada de dados controlada, nunca importado direto no
 *      componente de pagina.)
 *   3) imports worker-only proibidos em QUALQUER arquivo de apps/web: o Entity
 *      Writer ('services/entity-writer' / '@screena/entity-writer') e qualquer
 *      SDK/client Gemini (Google GenAI, 'api-clients/gemini',
 *      '@screena/gemini-client'). Sao offline-only e nunca entram no bundle de
 *      render (invariantes 3 e 4).
 *   4) imports do contrato de DB ('@screena/db') ou de clients de API dentro de
 *      CLIENT COMPONENTS (arquivos com a diretiva "use client"). O acesso ao
 *      PostgreSQL e server-only: permitido em modulos sem "use client"
 *      (ex.: apps/web/src/server/**), proibido em qualquer codigo que vai para o
 *      bundle do cliente (invariantes 3 e 4).
 *
 * Como apps/web ainda esta praticamente vazio nesta fase, o script DEVE passar
 * (exit 0) hoje — mas ja funciona e travara regressoes assim que houver codigo.
 *
 * Roda 100% offline, sem dependencias externas (apenas Node ESM).
 *
 * Uso:
 *   node scripts/audit/check-render-purity.mjs
 *   pnpm audit:render
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** Raiz a partir da qual tudo e resolvido (relativo ao cwd do processo). */
const ROOT = process.cwd();

/** Diretorio do app publico varrido. */
const WEB_DIR = path.join(ROOT, 'apps', 'web');

/** Extensoes consideradas codigo de render. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Diretorios ignorados na varredura recursiva. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
]);

/**
 * Hosts externos cujo uso em fetch( e proibido no render.
 * @type {string[]}
 */
const EXTERNAL_HOSTS = [
  'tmdb',
  'themoviedb',
  'rapidapi',
  'googleapis',
  'gemini',
  'generativelanguage',
  'rottentomatoes',
  'rotten-tomatoes',
  'imdb',
];

/**
 * Detecta `fetch(` (ou fetch com generic / await) seguido, na mesma linha, de
 * uma referencia a host externo conhecido.
 * @type {{ name: string, regex: RegExp }[]}
 */
const FETCH_PATTERNS = EXTERNAL_HOSTS.map((host) => ({
  name: `fetch( para host externo "${host}"`,
  // fetch ( ... host ... ) na mesma linha. Tolerante a await/generics/espacos.
  regex: new RegExp(String.raw`\bfetch\s*(?:<[^>]*>)?\s*\([^)\n]*${host}`, 'i'),
}));

/**
 * Literais proibidos em apps/web mesmo quando nao aparecem em fetch. Cobre o CDN
 * remoto de imagens do TMDB (host de `image.tmdb.org`).
 *
 * EXCECAO GOVERNADA (decisao de arquitetura: nao salvar imagem no servidor): a
 * URL publica de imagem do TMDB pode ser CONSTRUIDA (concatenacao de string) em
 * UM unico arquivo de producao — o helper `IMAGE_URL_HELPER_REL` abaixo. Essa
 * excecao vale SO para o literal do host em codigo de construcao de URL de
 * imagem (renderizada por `<img src>`), NUNCA para:
 *   - `fetch(` a qualquer host TMDB no render (segue barrado por FETCH_PATTERNS,
 *     que se aplica a TODOS os arquivos, inclusive o helper);
 *   - token/segredo TMDB no cliente;
 *   - uso espalhado do host fora do helper governado.
 * Fora do helper, o literal continua sendo VIOLACAO.
 * @type {{ name: string, regex: RegExp }[]}
 */
const FORBIDDEN_LITERAL_PATTERNS = [
  {
    name: "referencia ao CDN remoto de imagens TMDB ('image.tmdb.org')",
    regex: /image\.tmdb\.org/i,
  },
];

/**
 * Unico arquivo de producao DO REPOSITORIO INTEIRO autorizado a conter o
 * literal `image.tmdb.org` (construcao GOVERNADA da URL publica de imagem).
 * Caminho relativo a raiz, com '/'. Ver a excecao documentada em
 * FORBIDDEN_LITERAL_PATTERNS. O antigo helper de apps/web e apenas reexport e
 * NAO tem excecao — se o literal voltar la, e violacao.
 * @type {string}
 */
const IMAGE_URL_HELPER_REL = 'packages/public-contracts/src/media-url.ts';

/**
 * Diretorios de PRODUCAO varridos pela checagem repo-wide do host de imagem.
 * `tests/` e `scripts/` ficam de fora: testes citam o host em expects, e este
 * proprio script contem o padrao. Dentro dos diretorios varridos, arquivos de
 * teste (`__tests__/`, `*.test.*`) tambem sao ignorados pelo mesmo motivo.
 * @type {string[]}
 */
const PRODUCTION_DIRS = ['apps', 'packages', 'services', 'api-clients', 'seo', 'workers'];

/**
 * True quando o arquivo NAO e de producao: testes (`__tests__/`, `*.test.*`) e
 * validadores descartaveis (`<pacote>/scripts/`, ex.:
 * services/ingestion/scripts/validate-*.ts). Ambos citam o host em
 * asserts/fixtures (ex.: a configuration mockada do TMDB) e nunca rodam no
 * render — ficam fora da checagem de literal.
 * @param {string} relPath
 * @returns {boolean}
 */
function isTestFile(relPath) {
  return (
    /(^|\/)__tests__\//.test(relPath) ||
    /\.test\.[cm]?[jt]sx?$/.test(relPath) ||
    /(^|\/)scripts\//.test(relPath)
  );
}

/**
 * Imports proibidos em arquivos de pagina/layout.
 * @type {{ name: string, regex: RegExp }[]}
 */
const IMPORT_PATTERNS = [
  {
    name: "import de client de API ('../api-clients' / '@screena/api-clients')",
    regex:
      /\b(?:import|require)\b[^\n;]*['"`](?:[./]*api-clients|@screena\/api-clients)[^'"`]*['"`]/,
  },
  {
    name: "import direto do contrato de DB ('@screena/db')",
    regex: /\b(?:import|require)\b[^\n;]*['"`]@screena\/db(?:\/server)?['"`]/,
  },
  {
    name: "import de service de ingestao/sync ('services/ingestion' | 'services/sync' | '@screena/ingestion' | '@screena/sync')",
    regex:
      /\b(?:import|require)\b[^\n;]*['"`](?:[./]*services\/(?:ingestion|sync)|@screena\/(?:ingestion|sync))[^'"`]*['"`]/,
  },
  {
    name: "import do client TMDB ('@screena/tmdb-client' / 'api-clients/tmdb')",
    regex:
      /\b(?:import|require)\b[^\n;]*['"`](?:[./]*api-clients\/tmdb|@screena\/tmdb-client)[^'"`]*['"`]/,
  },
];

/**
 * Imports worker-only proibidos em QUALQUER arquivo de apps/web (nao apenas
 * paginas/layout): o Entity Writer e qualquer SDK/client Gemini sao offline-only
 * e nunca entram no caminho de render (invariantes 3 e 4).
 * @type {{ name: string, regex: RegExp }[]}
 */
const GLOBAL_IMPORT_PATTERNS = [
  {
    name: "import do Entity Writer ('services/entity-writer' / '@screena/entity-writer')",
    regex:
      /\b(?:import|require)\b[^\n;]*['"`](?:[./]*services\/entity-writer|@screena\/entity-writer)[^'"`]*['"`]/,
  },
  {
    name: "import de SDK/client Gemini (Google GenAI / 'api-clients/gemini' / '@screena/gemini-client')",
    regex:
      /\b(?:import|require)\b[^\n;]*['"`](?:@google\/(?:generative-ai|genai)|google-generativeai|[./]*api-clients\/gemini|@screena\/gemini-client)[^'"`]*['"`]/i,
  },
];

/**
 * Imports proibidos em CLIENT COMPONENTS (arquivos com a diretiva "use client"),
 * em QUALQUER diretorio de apps/web. O acesso ao DB e a clients de API e
 * server-only: nunca pode atravessar para o bundle do cliente (invariantes 3/4).
 * @type {{ name: string, regex: RegExp }[]}
 */
const CLIENT_IMPORT_PATTERNS = [
  {
    name: "import do contrato de DB ('@screena/db') em client component (\"use client\")",
    regex: /\b(?:import|require)\b[^\n;]*['"`]@screena\/db(?:\/server)?['"`]/,
  },
  {
    name: "import de client de API ('api-clients' / '@screena/api-clients') em client component (\"use client\")",
    regex:
      /\b(?:import|require)\b[^\n;]*['"`](?:[./]*api-clients|@screena\/api-clients)[^'"`]*['"`]/,
  },
];

/**
 * Nomes de arquivo que constituem "codigo de pagina" no App Router, onde o
 * import de DB/api-clients e proibido. fetch externo e proibido em qualquer
 * arquivo de render varrido.
 * @type {Set<string>}
 */
const PAGE_FILE_NAMES = new Set([
  'page.tsx',
  'page.ts',
  'page.jsx',
  'page.js',
  'layout.tsx',
  'layout.ts',
  'layout.jsx',
  'layout.js',
  'template.tsx',
  'template.ts',
  'default.tsx',
  'default.ts',
]);

/* ------------------------------------------------------------------ */
/* Acumuladores de relatorio                                          */
/* ------------------------------------------------------------------ */

/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const warnings = [];
/** @type {string[]} */
const passes = [];

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Le um arquivo de texto. Retorna null (e nao lanca) se nao existir.
 * @param {string} absPath
 * @returns {Promise<string | null>}
 */
async function readTextSafe(absPath) {
  try {
    return await readFile(absPath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Caminhada recursiva que coleta arquivos de codigo.
 * Tolerante a diretorios inexistentes (retorna lista vazia).
 * @param {string} absDir
 * @returns {Promise<string[]>}
 */
async function collectFiles(absDir) {
  /** @type {string[]} */
  const out = [];

  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return out;
    }
    throw err;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const childFiles = await collectFiles(path.join(absDir, entry.name));
      out.push(...childFiles);
    } else if (entry.isFile()) {
      if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        out.push(path.join(absDir, entry.name));
      }
    }
  }

  return out;
}

/**
 * Caminho relativo amigavel (sempre com '/') para o relatorio.
 * @param {string} absPath
 * @returns {string}
 */
function rel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

/**
 * Remove comentarios de linha (// ...) de uma linha para reduzir falso-positivo
 * em exemplos comentados. Nao tenta lidar com blocos de comentario multi-linha
 * — suficiente para o objetivo de auditoria.
 * @param {string} line
 * @returns {string}
 */
function stripLineComment(line) {
  // Procura '//' que nao seja parte de um esquema de URL ('http://', 'https://',
  // 'ws://' etc.), ou seja, '//' nao precedido imediatamente por ':'. Assim, uma
  // URL dentro de uma string nao e confundida com inicio de comentario.
  for (let i = 0; i < line.length - 1; i += 1) {
    if (line[i] === '/' && line[i + 1] === '/') {
      if (i > 0 && line[i - 1] === ':') continue; // parte de '://'
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Detecta a diretiva "use client" (client component). Para valer, ela precisa
 * ser a PRIMEIRA instrucao do arquivo: a primeira linha nao vazia e nao
 * comentada deve ser exatamente a string da diretiva.
 * @param {string} content
 * @returns {boolean}
 */
function hasUseClientDirective(content) {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
    return /^['"]use client['"];?$/.test(line);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Varredura                                                         */
/* ------------------------------------------------------------------ */

/**
 * Varre apps/web aplicando os padroes proibidos.
 * @returns {Promise<void>}
 */
async function scanWeb() {
  let exists = true;
  try {
    const st = await stat(WEB_DIR);
    if (!st.isDirectory()) exists = false;
  } catch {
    exists = false;
  }

  if (!exists) {
    warnings.push('apps/web ausente: nada a varrer (esperado nesta fase inicial).');
    return;
  }

  const files = await collectFiles(WEB_DIR);
  let scannedFiles = 0;

  for (const absFile of files) {
    const content = await readTextSafe(absFile);
    if (content === null) continue;
    scannedFiles += 1;

    const baseName = path.basename(absFile).toLowerCase();
    const isPageFile = PAGE_FILE_NAMES.has(baseName);
    const isClientComponent = hasUseClientDirective(content);

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const line = stripLineComment(raw);
      if (line.trim() === '') continue;

      // O literal do host de imagem e checado REPO-WIDE em scanRepoForImageHost
      // (unica fonte da regra) — nao repetimos aqui para nao reportar em dobro.

      // (1) fetch externo — proibido em qualquer arquivo de render.
      for (const { name, regex } of FETCH_PATTERNS) {
        if (regex.test(line)) {
          violations.push(`${name} em ${rel(absFile)}:${i + 1} -> ${raw.trim()}`);
        }
      }

      // (2) imports worker-only (Entity Writer / Gemini) — proibidos em
      //     QUALQUER arquivo de apps/web, nao so em pagina/layout.
      for (const { name, regex } of GLOBAL_IMPORT_PATTERNS) {
        if (regex.test(line)) {
          violations.push(`${name} em ${rel(absFile)}:${i + 1} -> ${raw.trim()}`);
        }
      }

      // (3) imports proibidos — restritos a arquivos de pagina/layout.
      if (isPageFile) {
        for (const { name, regex } of IMPORT_PATTERNS) {
          if (regex.test(line)) {
            violations.push(`${name} em ${rel(absFile)}:${i + 1} -> ${raw.trim()}`);
          }
        }
      }

      // (4) DB / api-clients em client component ("use client") — proibido em
      //     qualquer diretorio: o acesso a dados e server-only.
      if (isClientComponent) {
        for (const { name, regex } of CLIENT_IMPORT_PATTERNS) {
          if (regex.test(line)) {
            violations.push(`${name} em ${rel(absFile)}:${i + 1} -> ${raw.trim()}`);
          }
        }
      }
    }
  }

  passes.push(`apps/web varrido: ${scannedFiles} arquivo(s) de codigo analisado(s).`);
}

/**
 * Varredura REPO-WIDE do host do CDN de imagens.
 *
 * O literal `image.tmdb.org` so pode existir em UM arquivo de producao
 * (IMAGE_URL_HELPER_REL). A varredura anterior cobria apenas apps/web — o que
 * deixaria packages/services livres para espalhar a construcao de URL e minar a
 * fonte unica. Agora todos os diretorios de producao sao varridos; testes ficam
 * de fora (citam o host em expects).
 * @returns {Promise<void>}
 */
async function scanRepoForImageHost() {
  let scannedFiles = 0;
  let helperSeen = false;

  for (const dirName of PRODUCTION_DIRS) {
    const absDir = path.join(ROOT, dirName);
    let exists = true;
    try {
      const st = await stat(absDir);
      if (!st.isDirectory()) exists = false;
    } catch {
      exists = false;
    }
    if (!exists) continue;

    const files = await collectFiles(absDir);
    for (const absFile of files) {
      const relPath = rel(absFile);
      if (isTestFile(relPath)) continue;

      const content = await readTextSafe(absFile);
      if (content === null) continue;
      scannedFiles += 1;

      const isCanonicalHelper = relPath === IMAGE_URL_HELPER_REL;
      if (isCanonicalHelper) helperSeen = true;

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i];
        for (const { name, regex } of FORBIDDEN_LITERAL_PATTERNS) {
          if (regex.test(raw) && !isCanonicalHelper) {
            violations.push(`${name} em ${relPath}:${i + 1} -> ${raw.trim()}`);
          }
        }
      }
    }
  }

  // O helper canonico SUMIR tambem e falha: significaria que a excecao aponta
  // para um caminho morto e a regra deixou de ter fonte unica verificavel.
  if (!helperSeen) {
    violations.push(
      `helper canonico de URL de imagem ausente: esperado em ${IMAGE_URL_HELPER_REL}`,
    );
  }

  passes.push(
    `host de imagem TMDB verificado repo-wide: ${scannedFiles} arquivo(s) de producao; literal permitido so em ${IMAGE_URL_HELPER_REL}.`,
  );
}

/* ------------------------------------------------------------------ */
/* Relatorio + exit                                                  */
/* ------------------------------------------------------------------ */

/**
 * Imprime o relatorio e encerra com o codigo adequado.
 * @returns {void}
 */
function report() {
  console.log('============================================================');
  console.log(' Screena — Pureza de render (check-render-purity)');
  console.log('============================================================');

  if (passes.length > 0) {
    console.log('\nOK:');
    for (const p of passes) console.log(`  [ok]   ${p}`);
  }

  if (warnings.length > 0) {
    console.log('\nAVISOS (nao bloqueiam):');
    for (const w of warnings) console.log(`  [warn] ${w}`);
  }

  if (violations.length > 0) {
    console.log('\nVIOLACOES:');
    for (const v of violations) console.log(`  [FAIL] ${v}`);
  }

  console.log('\n------------------------------------------------------------');
  console.log(
    `Resumo: ${passes.length} ok, ${warnings.length} aviso(s), ${violations.length} violacao(oes).`,
  );
  console.log('------------------------------------------------------------');

  if (violations.length > 0) {
    console.log('\nResultado: FALHOU. O render publico deve ler so PostgreSQL/cache local.');
    process.exit(1);
  }

  console.log('\nResultado: PASSOU. Render puro de IO externo.');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  await scanWeb();
  await scanRepoForImageHost();
  report();
}

main().catch((err) => {
  console.error('\n[ERRO FATAL] A auditoria de render nao pode concluir:');
  console.error(err);
  process.exit(2);
});
