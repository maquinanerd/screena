#!/usr/bin/env node
// @ts-check
/**
 * check-invariants.mjs — Auditoria de governanca da Screena.
 *
 * Objetivo: travar, em CI e localmente, as invariantes inegociaveis do projeto.
 * Roda 100% offline, sem rede, sem DB, sem dependencias externas (apenas Node ESM).
 *
 * O que verifica:
 *  (a) PRESENCA de frases-chave das invariantes em CLAUDE.md e nos 5 arquivos
 *      .claude/rules/*.md. Se um arquivo de regra nao existir, conta como AVISO
 *      (nao quebra), mas a ausencia de frases obrigatorias em arquivos que existem
 *      e VIOLACAO.
 *  (b) VARREDURA por padroes proibidos nos diretorios de codigo (apps, packages,
 *      services, seo): ocorrencias onde 'imdb' aparece colado/adjacente a
 *      'tomatometer' / 'tomate' / 'popcornmeter'. Isso protege a invariante
 *      "IMDb != Rotten Tomatoes" e "nota IMDb nunca vira Tomatometer".
 *
 * Saida: relatorio legivel + process.exit(1) se houver VIOLACAO; exit(0) se OK.
 *
 * Uso:
 *   node scripts/audit/check-invariants.mjs
 *   pnpm audit:invariants
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** Raiz a partir da qual tudo e resolvido (relativo ao cwd do processo). */
const ROOT = process.cwd();

/* ------------------------------------------------------------------ */
/* Configuracao declarativa                                            */
/* ------------------------------------------------------------------ */

/**
 * Frases-chave que DEVEM aparecer (case-insensitive) em cada documento de
 * governanca. Sao trechos curtos e estaveis das invariantes — nao o texto
 * completo, para nao quebrar a cada ajuste editorial.
 *
 * @type {{ file: string, required: string[] }[]}
 */
const DOC_CHECKS = [
  {
    file: 'CLAUDE.md',
    required: [
      'IMDb',
      'Rotten',
      'provider_api',
      'rating_source',
      'noindex',
      'render',
      'pt-BR',
      'pirataria',
      'content_blocks',
      'Entity Writer',
      'AggregateRating',
    ],
  },
  {
    file: '.claude/rules/ratings.md',
    required: ['IMDb', 'Rotten', 'provider_api', 'rating_source', 'license'],
  },
  {
    file: '.claude/rules/seo.md',
    required: ['noindex', 'render', 'content_blocks'],
  },
  {
    file: '.claude/rules/ingestion.md',
    required: ['render', 'log'],
  },
  {
    file: '.claude/rules/i18n.md',
    required: ['pt-BR', 'noindex'],
  },
  {
    file: '.claude/rules/entity-writer.md',
    required: ['content_blocks', 'render'],
  },
];

/**
 * Diretorios de codigo varridos em busca de padroes proibidos.
 * @type {string[]}
 */
const SCAN_DIRS = ['apps', 'packages', 'services', 'seo'];

/** Extensoes de arquivo elegiveis para a varredura de padroes proibidos. */
const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.mdx',
  '.json',
  '.css',
  '.scss',
  '.html',
  '.py',
]);

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
 * Padroes proibidos: 'imdb' colado/adjacente a um rotulo do Rotten Tomatoes.
 * Cobrimos separadores comuns (nada, espaco, hifen, underscore, ponto, barra)
 * e a ordem inversa. Case-insensitive.
 * @type {{ name: string, regex: RegExp }[]}
 */
const FORBIDDEN_PATTERNS = [
  {
    name: "'imdb' adjacente a 'tomatometer'",
    regex: /imdb[\s._/-]{0,3}tomatometer|tomatometer[\s._/-]{0,3}imdb/i,
  },
  {
    name: "'imdb' adjacente a 'popcornmeter'",
    regex: /imdb[\s._/-]{0,3}popcornmeter|popcornmeter[\s._/-]{0,3}imdb/i,
  },
  {
    name: "'imdb' adjacente a 'tomate'",
    regex: /imdb[\s._/-]{0,3}tomate|tomate[\s._/-]{0,3}imdb/i,
  },
];

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
 * Caminhada recursiva que coleta arquivos elegiveis para varredura.
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
      if (SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
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

/* ------------------------------------------------------------------ */
/* (a) Presenca de frases-chave nos documentos de governanca          */
/* ------------------------------------------------------------------ */

/**
 * Verifica que cada frase obrigatoria aparece no documento.
 * @returns {Promise<void>}
 */
async function checkGovernanceDocs() {
  for (const { file, required } of DOC_CHECKS) {
    const absPath = path.join(ROOT, file);
    const content = await readTextSafe(absPath);

    if (content === null) {
      warnings.push(`Documento de governanca ausente: ${file} (esperado existir).`);
      continue;
    }

    const haystack = content.toLowerCase();
    /** @type {string[]} */
    const missing = [];
    for (const phrase of required) {
      if (!haystack.includes(phrase.toLowerCase())) {
        missing.push(phrase);
      }
    }

    if (missing.length > 0) {
      violations.push(
        `${file}: frase(s)-chave de invariante ausente(s): ${missing
          .map((m) => `"${m}"`)
          .join(', ')}.`,
      );
    } else {
      passes.push(`${file}: todas as ${required.length} frases-chave presentes.`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* (b) Varredura por padroes proibidos no codigo                      */
/* ------------------------------------------------------------------ */

/**
 * Varre os diretorios de codigo procurando padroes proibidos.
 * @returns {Promise<void>}
 */
async function scanForbiddenPatterns() {
  let scannedFiles = 0;

  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);

    let exists = true;
    try {
      const st = await stat(absDir);
      if (!st.isDirectory()) exists = false;
    } catch {
      exists = false;
    }

    if (!exists) {
      warnings.push(`Diretorio de codigo ausente (varredura pulada): ${dir}/.`);
      continue;
    }

    const files = await collectFiles(absDir);
    for (const absFile of files) {
      const content = await readTextSafe(absFile);
      if (content === null) continue;
      scannedFiles += 1;

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        for (const { name, regex } of FORBIDDEN_PATTERNS) {
          if (regex.test(line)) {
            violations.push(
              `Padrao proibido (${name}) em ${rel(absFile)}:${i + 1} -> ${line.trim()}`,
            );
          }
        }
      }
    }
  }

  passes.push(`Varredura de padroes proibidos concluida em ${scannedFiles} arquivo(s).`);
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
  console.log(' Screena — Auditoria de invariantes (check-invariants)');
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
    console.log('\nResultado: FALHOU. Corrija as violacoes acima.');
    process.exit(1);
  }

  console.log('\nResultado: PASSOU. Invariantes intactas.');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  await checkGovernanceDocs();
  await scanForbiddenPatterns();
  report();
}

main().catch((err) => {
  console.error('\n[ERRO FATAL] A auditoria nao pode concluir:');
  console.error(err);
  process.exit(2);
});
