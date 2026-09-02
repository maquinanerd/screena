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
 *  (b) VARREDURA por padroes proibidos nos diretorios de codigo — os de
 *      SCAN_DIRS, que hoje sao `apps`, `packages`, `services` e `api-clients`.
 *      Ate 2026-09-02 esta linha dizia "apps, packages, services, seo": `seo/`
 *      na raiz era codigo morto e foi REMOVIDO, e `api-clients/` — onde vivem
 *      justamente os clients de fornecedor — nao era citado. Um comentario que
 *      descreve o escopo errado ensina o leitor a confiar numa cobertura que
 *      nao existe.
 *
 *  (c) IMPORT DE CLIENT DE FORNECEDOR NO CAMINHO DE RENDER (invariante 3).
 *      Esta e a unica checagem de COMPORTAMENTO deste auditor: as duas acima
 *      medem TEXTO. Ela existe porque o guard de pureza de render (`audit:render`)
 *      procura chamada de rede por padrao textual, e ja passou verde com duas
 *      chamadas externas de pe. Um import e mais dificil de disfarcar do que uma
 *      chamada: se `apps/web` importa `@screena/tmdb-client`, a rede esta a uma
 *      linha de distancia, tenha ela sido escrita ou nao.
 *
 * Saida: relatorio legivel + process.exit(1) se houver VIOLACAO; exit(0) se OK.
 *
 * Uso:
 *   node scripts/audit/check-invariants.mjs
 *   pnpm audit:invariants
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

/** Raiz a partir da qual tudo e resolvido (relativo ao cwd do processo). */
const ROOT = process.cwd()

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
]

/**
 * Diretorios de codigo varridos em busca de padroes proibidos.
 * @type {string[]}
 */
const SCAN_DIRS = ['apps', 'packages', 'services', 'api-clients']

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
])

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
])

/**
 * Saida GERADA das ferramentas de QA visual (`apps/web/.qa-*`, todas
 * gitignored): HTML montado pelo proprio harness a partir do CSS e dos
 * componentes reais.
 *
 * Ignorada pelo mesmo motivo que `.next` e `dist`: e artefato, nao codigo. Uma
 * violacao ali nunca e um defeito do produto — ou o harness copiou marcacao que
 * ja existe (e o arquivo-fonte e que seria acusado, corretamente) ou e cenario
 * de teste. Varrer artefato produz acusacao que ninguem pode consertar no lugar
 * certo, e depende de quem rodou o QA por ultimo: o mesmo commit passa ou falha
 * conforme exista ou nao um diretorio local.
 */
const IGNORED_DIR_PREFIXES = ['.qa-']

/**
 * Padroes proibidos: 'imdb' colado/adjacente a um rotulo do Rotten Tomatoes.
 * Cobrimos separadores comuns (nada, espaco, hifen, underscore, ponto, barra)
 * e a ordem inversa. Case-insensitive.
 * @type {{
 *   name: string,
 *   regex: RegExp,
 *   include?: RegExp,
 *   exclude?: RegExp,
 *   codeOnly?: boolean,
 *   allowedWhen?: RegExp,
 *   stripAllowedHomePlaceholderGates?: boolean,
 * }[]}
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
  {
    name: 'home /pt com literal fake de streaming/plataforma fora do gate',
    regex:
      /\bHOME_VISUAL_PLATFORMS\b|\bhomeVisualPlatform\b|\bhome-v4-series-platform\b|\b(?:NETFLIX|Netflix|Prime Video|Disney\+|Star\+|Apple TV\+|Max)\b/,
    include: /^apps\/web\/app\/pt\/page\.tsx$/,
    codeOnly: true,
    stripAllowedHomePlaceholderGates: true,
  },
  {
    name: "home /pt promete 'Onde assistir' sem disponibilidade real",
    regex: /Onde assistir/i,
    include: /^apps\/web\/app\/pt\/page\.tsx$/,
    codeOnly: true,
    stripAllowedHomePlaceholderGates: true,
  },
  {
    name: 'component compartilhado com literal fake de streaming/plataforma',
    regex:
      /\bHOME_VISUAL_PLATFORMS\b|\bhomeVisualPlatform\b|\bhome-v4-series-platform\b|\b(?:NETFLIX|Netflix|Prime Video|Disney\+|Star\+|Apple TV\+|Max)\b/,
    include: /^apps\/web\/app\/_components\/.*\.tsx$/,
    exclude: /^apps\/web\/app\/_components\/(?:episodes-ticker|watch-providers)\.tsx$/,
    codeOnly: true,
  },
  {
    name: "component compartilhado promete 'Onde assistir' sem contrato de watch",
    regex: /Onde assistir/i,
    include: /^apps\/web\/app\/_components\/.*\.tsx$/,
    exclude: /^apps\/web\/app\/_components\/(?:episodes-ticker|watch-providers)\.tsx$/,
    codeOnly: true,
    // O componente pode prometer "Onde assistir" quando de fato carrega o
    // contrato licenciado (o mesmo gate `licensedWatchWhere` do painel de
    // detalhe). `TickerProvider`/`WatchAvailabilityView` so existem para dado
    // que ja passou por esse gate — plataforma inventada continua proibida.
    allowedWhen: /\bTickerProvider\b|\bWatchAvailabilityView\b|watch-availability-presenter/,
  },
  {
    name: 'UI publica com pseudo-ranking ou affordance morta',
    // "Avaliar" SAIU da lista em 20/08/2026: deixou de ser affordance morta
    // quando o botao do topo canonico passou a persistir de verdade
    // (`/api/me/ratings`, nota pessoal 0,5..5,0 do C5A — entity-actions.tsx).
    // "Marcar como assistido" continua morta: nenhum botao com esse rotulo
    // tem backend.
    regex:
      /\bhome-v4-rank-badge\b|\bhome-v4-compact-rank\b|#\{rank\}|\bhome-v4-muted-action\b|\bhome-v4-watch-action\b|Marcar como assistido/i,
    include: /^apps\/web\//,
    codeOnly: true,
  },
  {
    name: 'UI publica com claim literal de ranking falso (#1/#2/#3)',
    // "#N" visivel sobre um card e afirmacao de ranking. A home nao ranqueia;
    // so o JSX vivo (comentarios removidos) das telas publicas e varrido.
    // `\b` apos o digito ignora hex CSS (#1a2b3c) — so pega o rank literal solto.
    regex: /#[1-9]\b/,
    include: /^apps\/web\/app\/(?:pt\/page\.tsx|_components\/.*\.tsx)$/,
    codeOnly: true,
  },
  {
    name: 'seed demo marcando screen_score como exibivel',
    regex: /screenScore:\s*\w+\.screenScore|screenScoreDisplay:\s*true/,
    include: /^apps\/admin\/scripts\/public-demo-seed\.ts$/,
    codeOnly: true,
  },
]

/* ------------------------------------------------------------------ */
/* Acumuladores de relatorio                                          */
/* ------------------------------------------------------------------ */

/** @type {string[]} */
const violations = []
/** @type {string[]} */
const warnings = []
/** @type {string[]} */
const passes = []

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
    return await readFile(absPath, 'utf8')
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null
    }
    throw err
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
  const out = []

  let entries
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return out
    }
    throw err
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      if (IGNORED_DIR_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue
      const childFiles = await collectFiles(path.join(absDir, entry.name))
      out.push(...childFiles)
    } else if (entry.isFile()) {
      if (SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        out.push(path.join(absDir, entry.name))
      }
    }
  }

  return out
}

/**
 * Caminho relativo amigavel (sempre com '/') para o relatorio.
 * @param {string} absPath
 * @returns {string}
 */
function rel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

/**
 * Remove comentarios de bloco/linha para varreduras que precisam olhar so
 * codigo/markup vivo. Preserva URLs com "://".
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === '/' && line[i + 1] === '/') {
          if (i > 0 && line[i - 1] === ':') continue
          return line.slice(0, i)
        }
      }
      return line
    })
    .join('\n')
}

/**
 * Remove usos permitidos pelo gate de placeholders visuais da home.
 * @param {string} source
 * @returns {string}
 */
function stripAllowedHomePlaceholderGates(source) {
  return source.replace(/\{\s*allowPlaceholders\s*\?\s*<EpisodesTicker\s*\/>\s*:\s*null\s*\}/g, '')
}

/**
 * @param {string} content
 * @param {{
 *   codeOnly?: boolean,
 *   stripAllowedHomePlaceholderGates?: boolean,
 * }} pattern
 * @returns {string}
 */
function sourceForPattern(content, pattern) {
  let source = pattern.codeOnly ? stripComments(content) : content
  if (pattern.stripAllowedHomePlaceholderGates) {
    source = stripAllowedHomePlaceholderGates(source)
  }
  return source
}

/**
 * @param {string} relFile
 * @param {{ include?: RegExp, exclude?: RegExp }} pattern
 * @returns {boolean}
 */
function shouldScanPattern(relFile, pattern) {
  if (pattern.include && !pattern.include.test(relFile)) return false
  if (pattern.exclude && pattern.exclude.test(relFile)) return false
  return true
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
    const absPath = path.join(ROOT, file)
    const content = await readTextSafe(absPath)

    if (content === null) {
      warnings.push(`Documento de governanca ausente: ${file} (esperado existir).`)
      continue
    }

    const haystack = content.toLowerCase()
    /** @type {string[]} */
    const missing = []
    for (const phrase of required) {
      if (!haystack.includes(phrase.toLowerCase())) {
        missing.push(phrase)
      }
    }

    if (missing.length > 0) {
      violations.push(
        `${file}: frase(s)-chave de invariante ausente(s): ${missing
          .map((m) => `"${m}"`)
          .join(', ')}.`,
      )
    } else {
      passes.push(`${file}: todas as ${required.length} frases-chave presentes.`)
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
  let scannedFiles = 0

  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir)

    let exists = true
    try {
      const st = await stat(absDir)
      if (!st.isDirectory()) exists = false
    } catch {
      exists = false
    }

    if (!exists) {
      warnings.push(`Diretorio de codigo ausente (varredura pulada): ${dir}/.`)
      continue
    }

    const files = await collectFiles(absDir)
    for (const absFile of files) {
      const content = await readTextSafe(absFile)
      if (content === null) continue
      scannedFiles += 1

      const relFile = rel(absFile)
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (!shouldScanPattern(relFile, pattern)) continue

        const source = sourceForPattern(content, pattern)
        // `allowedWhen`: o arquivo pode usar o literal SE carregar o contrato
        // real que o justifica. E a diferenca entre "citar streaming" (proibido)
        // e "exibir oferta ja aprovada pelo gate de licenca" (permitido). Sem
        // isto a unica valvula era uma allowlist por NOME de arquivo, que nao
        // prova nada sobre o conteudo.
        if (pattern.allowedWhen && pattern.allowedWhen.test(source)) continue

        const lines = source.split(/\r?\n/)
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]
          const { name, regex } = pattern
          if (regex.test(line)) {
            violations.push(`Padrao proibido (${name}) em ${relFile}:${i + 1} -> ${line.trim()}`)
          }
        }
      }
    }
  }

  passes.push(`Varredura de padroes proibidos concluida em ${scannedFiles} arquivo(s).`)
}

/* ------------------------------------------------------------------ */
/* (c) Import de client de fornecedor no caminho de RENDER            */
/* ------------------------------------------------------------------ */

/**
 * Pacotes que EXISTEM para falar com fornecedor externo.
 *
 * Nenhum deles pode ser alcancado pelo render publico. A lista e por PACOTE e
 * nao por host: um client novo nasce coberto no dia em que e adicionado aqui,
 * e nao no dia em que alguem lembra de acrescentar um dominio a um regex.
 */
const PROVIDER_CLIENT_PACKAGES = [
  '@screena/tmdb-client',
  '@screena/omdb-client',
  '@screena/rapidapi-core',
  '@screena/film-show-ratings-client',
  '@screena/streaming-availability-client',
]

/**
 * As arvores que o render publico serve.
 *
 * `apps/web/scripts/` fica FORA de proposito: sao harnesses de QA descartaveis,
 * que nunca entram no bundle e as vezes precisam do client de verdade para
 * montar uma fixture honesta.
 * @type {readonly string[]}
 */
const RENDER_TREES = ['apps/web/app', 'apps/web/src']

/**
 * Verifica que nenhum arquivo do render importa um client de fornecedor.
 * @returns {Promise<void>}
 */
async function scanRenderProviderImports() {
  let scanned = 0
  let found = 0

  for (const tree of RENDER_TREES) {
    const absDir = path.join(ROOT, tree)
    let exists = true
    try {
      const st = await stat(absDir)
      if (!st.isDirectory()) exists = false
    } catch {
      exists = false
    }
    if (!exists) {
      // FAIL-LOUD: uma arvore de render que sumiu significa que esta checagem
      // parou de medir o que o nome dela promete.
      violations.push(
        `Arvore de render ausente (a checagem de import de fornecedor nao mediu nada): ${tree}/.`,
      )
      continue
    }

    const files = await collectFiles(absDir)
    for (const absFile of files) {
      const relFile = rel(absFile)
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(relFile)) continue
      const content = await readTextSafe(absFile)
      if (content === null) continue
      scanned += 1

      // Comentario fora: o cabecalho de um arquivo de render pode CITAR o
      // client para explicar por que nao o usa — e essa explicacao nao pode
      // reprovar o arquivo que ela protege.
      const source = stripCommentsForScan(content)
      for (const pkg of PROVIDER_CLIENT_PACKAGES) {
        // Comparacao por SUBSTRING, e nao regex montada: o nome do pacote tem
        // `@`, `/` e `-`, e escapa-los para dentro de uma `RegExp` construida em
        // template literal e exatamente onde este arquivo ja quebrou uma vez.
        // Aqui a pergunta e simples e nao precisa de regex: o especificador
        // aparece entre aspas em algum lugar do arquivo sem comentario?
        const quoted = [`'${pkg}`, `"${pkg}`, '`' + pkg]
        if (quoted.some((needle) => source.includes(needle))) {
          found += 1
          violations.push(
            `Client de fornecedor importado no caminho de render (invariante 3): ` +
              `${relFile} importa ${pkg}.`,
          )
        }
      }
    }
  }

  if (found === 0) {
    passes.push(
      `Render puro por IMPORT: ${scanned} arquivo(s) de ${RENDER_TREES.join(', ')} ` +
        `sem nenhum dos ${PROVIDER_CLIENT_PACKAGES.length} clients de fornecedor.`,
    )
  }
}

/**
 * Remove comentarios para a varredura de import.
 *
 * Ingenuo de proposito e SEGURO para o que faz: ele nao precisa preservar
 * string (o alvo e um import), e um `//` dentro de uma URL so pode aparecer em
 * string ou comentario — nos dois casos, nao e um import.
 * @param {string} source
 * @returns {string}
 */
function stripCommentsForScan(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

/* ------------------------------------------------------------------ */
/* Relatorio + exit                                                  */
/* ------------------------------------------------------------------ */

/**
 * Imprime o relatorio e encerra com o codigo adequado.
 * @returns {void}
 */
function report() {
  console.log('============================================================')
  console.log(' Screena — Auditoria de invariantes (check-invariants)')
  console.log('============================================================')

  if (passes.length > 0) {
    console.log('\nOK:')
    for (const p of passes) console.log(`  [ok]   ${p}`)
  }

  if (warnings.length > 0) {
    console.log('\nAVISOS (nao bloqueiam):')
    for (const w of warnings) console.log(`  [warn] ${w}`)
  }

  if (violations.length > 0) {
    console.log('\nVIOLACOES:')
    for (const v of violations) console.log(`  [FAIL] ${v}`)
  }

  console.log('\n------------------------------------------------------------')
  console.log(
    `Resumo: ${passes.length} ok, ${warnings.length} aviso(s), ${violations.length} violacao(oes).`,
  )
  console.log('------------------------------------------------------------')

  if (violations.length > 0) {
    console.log('\nResultado: FALHOU. Corrija as violacoes acima.')
    process.exit(1)
  }

  console.log('\nResultado: PASSOU. Invariantes intactas.')
  process.exit(0)
}

/* ------------------------------------------------------------------ */
/* Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  await checkGovernanceDocs()
  await scanForbiddenPatterns()
  await scanRenderProviderImports()
  report()
}

main().catch((err) => {
  console.error('\n[ERRO FATAL] A auditoria nao pode concluir:')
  console.error(err)
  process.exit(2)
})
