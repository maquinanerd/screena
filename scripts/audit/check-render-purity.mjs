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
 * O que faz: varre apps/web (recursivo) procurando, em codigo de pagina
 * (server components / rotas), padroes proibidos:
 *   1) chamadas fetch( cujo alvo aponta para hosts externos conhecidos
 *      (tmdb / themoviedb / rapidapi / googleapis / gemini / generativelanguage
 *       / rottentomatoes / imdb);
 *   2) imports de clients de API ('../api-clients', '@screena/api-clients') ou
 *      do contrato de DB ('@screena/db') dentro de arquivos de pagina/layout.
 *      (O DB e lido por camada de dados controlada, nunca importado direto no
 *      componente de pagina.)
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
    regex: /\b(?:import|require)\b[^\n;]*['"`]@screena\/db['"`]/,
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

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const line = stripLineComment(raw);
      if (line.trim() === '') continue;

      // (1) fetch externo — proibido em qualquer arquivo de render.
      for (const { name, regex } of FETCH_PATTERNS) {
        if (regex.test(line)) {
          violations.push(`${name} em ${rel(absFile)}:${i + 1} -> ${raw.trim()}`);
        }
      }

      // (2) imports proibidos — restritos a arquivos de pagina/layout.
      if (isPageFile) {
        for (const { name, regex } of IMPORT_PATTERNS) {
          if (regex.test(line)) {
            violations.push(`${name} em ${rel(absFile)}:${i + 1} -> ${raw.trim()}`);
          }
        }
      }
    }
  }

  passes.push(`apps/web varrido: ${scannedFiles} arquivo(s) de codigo analisado(s).`);
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
  report();
}

main().catch((err) => {
  console.error('\n[ERRO FATAL] A auditoria de render nao pode concluir:');
  console.error(err);
  process.exit(2);
});
