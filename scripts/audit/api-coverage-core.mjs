// @ts-check
/**
 * api-coverage-core.mjs — Nucleo PURO do validador de cobertura de API (Fase 5).
 *
 * Este modulo nao faz IO por conta propria: recebe o registro ja lido
 * (`providersText`, `endpoints`, `fields`) e uma funcao `readText(relPath)`
 * injetada (usada so para resolver ancoras de codigo e fontes de enumeracao).
 * Isso torna a logica testavel (Vitest injeta dados sinteticos + reader fake) e
 * mantem o CLI `check-api-coverage.mjs` como uma casca fina.
 *
 * Contrato (invariantes que este validador TRAVA):
 *  - Invariante 2: `provider_api` != `rating_source`; e `provider_api` NUNCA e um
 *    valor de `RATING_SOURCES`.
 *  - Invariante 3: toda entrada externa e worker-only (`worker_only === true`).
 *  - Estados de cobertura: EXATAMENTE 1 por endpoint E por campo, dentre os 8
 *    canonicos. `not_applicable` exige `justification`; `deprecated` exige
 *    `superseded_by`.
 *  - Ancora de codigo: toda entrada `implemented === true` aponta um arquivo real
 *    cujo texto contem todas as strings de `anchor.must_contain` (quebra em drift
 *    se o simbolo/caminho sumir/renomear).
 *  - Drift reverso: todo endpoint-metodo `async get<X>(` presente nos clients
 *    enumerados TEM de ter entrada correspondente no registro (endpoint novo em
 *    codigo sem registro = violacao).
 */

/** Os 8 estados de cobertura canonicos (Fase 5). Exatamente 1 por item. */
export const COVERAGE_STATES = Object.freeze([
  'raw_captured',
  'normalized',
  'public_ready',
  'blocked_license',
  'blocked_privacy',
  'blocked_plan',
  'not_applicable',
  'deprecated',
]);

/**
 * Fontes editoriais de rating (espelha `RATING_SOURCES` de `@screena/config`).
 * Um `provider_api` NUNCA pode ser um destes valores (invariante 2).
 */
export const RATING_SOURCES = Object.freeze([
  'imdb',
  'rotten_tomatoes',
  'metacritic',
  'letterboxd',
  'filmaffinity',
]);

/** Papeis validos de endpoint/campo. */
export const ROLES = Object.freeze([
  'catalog',
  'discovery',
  'ratings',
  'streaming',
  'news',
  'ai',
  'infra',
]);

/** Kinds validos de provider tecnico (espelha `api_providers.kind`). */
export const PROVIDER_KINDS = Object.freeze(['data', 'ratings', 'streaming', 'ai', 'news']);

/**
 * Fontes de ENUMERACAO para o drift reverso: arquivos cujos metodos-endpoint
 * publicos (`async get<X>(`) TEM de estar registrados. Escopo deliberadamente
 * restrito aos clients cuja unica funcao publica sao endpoints — evita falso
 * positivo com getters utilitarios.
 * @type {{ file: string, label: string }[]}
 */
export const ENUMERATION_SOURCES = Object.freeze([
  { file: 'api-clients/tmdb/src/endpoints.ts', label: 'TMDB endpoints' },
  { file: 'api-clients/film_show_ratings/src/client.ts', label: 'Film & Show Ratings client' },
  { file: 'api-clients/streaming_availability/src/client.ts', label: 'Streaming Availability client' },
]);

/** Regex que captura o nome de um metodo-endpoint publico `async get<X>(`. */
const ENDPOINT_METHOD_RE = /\basync\s+(get[A-Z][A-Za-z0-9]*)\s*\(/g;

/**
 * Parser YAML MINIMO e proposital para `providers.yaml`.
 *
 * Aceita EXATAMENTE o subconjunto plano que este projeto controla:
 *   providers:
 *     - key: tmdb
 *       provider_api: tmdb
 *       kind: data
 *       ...
 * Cada item e um mapa de escalares (string | boolean). Nao suporta aninhamento,
 * listas internas nem multilinha — de proposito. Ignora comentarios `#` e linhas
 * em branco. Retorna `{ providers, errors }`.
 *
 * @param {string} text
 * @returns {{ providers: Record<string, string | boolean>[], errors: string[] }}
 */
export function parseProvidersYaml(text) {
  /** @type {Record<string, string | boolean>[]} */
  const providers = [];
  /** @type {string[]} */
  const errors = [];

  if (typeof text !== 'string' || text.trim() === '') {
    errors.push('providers.yaml vazio ou ilegivel.');
    return { providers, errors };
  }

  const lines = text.split(/\r?\n/);
  let sawHeader = false;
  /** @type {Record<string, string | boolean> | null} */
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    // Remove comentarios (o `#` so inicia comentario fora de aspas; nossos
    // valores nao usam `#` — mantemos simples).
    const withoutComment = rawLine.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    const line = withoutComment.replace(/\s+$/, '');
    if (line.trim() === '') continue;

    if (/^providers:\s*$/.test(line)) {
      sawHeader = true;
      continue;
    }

    const itemStart = line.match(/^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (itemStart) {
      if (current) providers.push(current);
      current = {};
      current[itemStart[1]] = coerceScalar(itemStart[2]);
      continue;
    }

    const kv = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) {
      if (!current) {
        errors.push(`providers.yaml linha ${i + 1}: par chave/valor fora de um item de lista.`);
        continue;
      }
      current[kv[1]] = coerceScalar(kv[2]);
      continue;
    }

    errors.push(`providers.yaml linha ${i + 1}: sintaxe nao reconhecida -> ${line.trim()}`);
  }

  if (current) providers.push(current);
  if (!sawHeader) errors.push('providers.yaml sem a chave raiz `providers:`.');

  return { providers, errors };
}

/**
 * Converte um valor escalar YAML simples: aspas removidas, booleanos, senao
 * string trimada.
 * @param {string} raw
 * @returns {string | boolean}
 */
function coerceScalar(raw) {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Avalia o registro de cobertura. Puro (a nao ser por `readText` injetado).
 *
 * @param {{
 *   providersText: string,
 *   endpoints: unknown,
 *   fields: unknown,
 *   readText: (relPath: string) => Promise<string | null>,
 *   enumerationSources?: { file: string, label: string }[],
 * }} input
 * @returns {Promise<{ violations: string[], warnings: string[], passes: string[] }>}
 */
export async function evaluateApiCoverage(input) {
  const { providersText, endpoints, fields, readText } = input;
  const enumerationSources = input.enumerationSources ?? ENUMERATION_SOURCES;

  /** @type {string[]} */
  const violations = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const passes = [];

  /* -------------------------------------------------------------- */
  /* 1. providers.yaml                                              */
  /* -------------------------------------------------------------- */
  const { providers, errors: providerErrors } = parseProvidersYaml(providersText);
  for (const err of providerErrors) violations.push(`providers.yaml: ${err}`);

  /** @type {Map<string, Record<string, string | boolean>>} */
  const providerByKey = new Map();
  for (const p of providers) {
    const key = p.key;
    if (!isNonEmptyString(key)) {
      violations.push('providers.yaml: item sem `key`.');
      continue;
    }
    if (providerByKey.has(String(key))) {
      violations.push(`providers.yaml: provider duplicado \`${String(key)}\`.`);
      continue;
    }
    if (!isNonEmptyString(p.provider_api)) {
      violations.push(`providers.yaml: provider \`${String(key)}\` sem \`provider_api\`.`);
    }
    if (!PROVIDER_KINDS.includes(String(p.kind))) {
      violations.push(
        `providers.yaml: provider \`${String(key)}\` com \`kind\` invalido (${String(p.kind)}); use ${PROVIDER_KINDS.join('|')}.`,
      );
    }
    if (RATING_SOURCES.includes(String(p.provider_api))) {
      violations.push(
        `providers.yaml: provider \`${String(key)}\` usa \`provider_api=${String(p.provider_api)}\`, que e uma fonte editorial (invariante 2).`,
      );
    }
    providerByKey.set(String(key), p);
  }
  if (providerByKey.size > 0) {
    passes.push(`providers.yaml: ${providerByKey.size} provider(s) tecnico(s) catalogado(s).`);
  }

  /* -------------------------------------------------------------- */
  /* 2. endpoints.json                                             */
  /* -------------------------------------------------------------- */
  if (!Array.isArray(endpoints)) {
    violations.push('endpoints.json: raiz deve ser um array.');
  } else {
    /** @type {Set<string>} */
    const seenIds = new Set();
    for (const entry of endpoints) {
      validateEntry(entry, 'endpoint', {
        providerByKey,
        violations,
        warnings,
        seenIds,
        requireAnchorWhenImplemented: true,
      });
    }
    // Ancoras de codigo (drift forward) — precisa de readText (sequencial de proposito).
    for (const entry of endpoints) {
      await checkAnchor(entry, { readText, violations });
    }
    passes.push(`endpoints.json: ${endpoints.length} endpoint(s)/capacidade(s) classificado(s).`);
  }

  /* -------------------------------------------------------------- */
  /* 3. fields.json                                                */
  /* -------------------------------------------------------------- */
  if (!Array.isArray(fields)) {
    violations.push('fields.json: raiz deve ser um array.');
  } else {
    /** @type {Set<string>} */
    const seenFieldIds = new Set();
    for (const entry of fields) {
      validateEntry(entry, 'field', {
        providerByKey,
        violations,
        warnings,
        seenIds: seenFieldIds,
        requireAnchorWhenImplemented: false,
      });
    }
    passes.push(`fields.json: ${fields.length} grupo(s) de campo classificado(s).`);
  }

  /* -------------------------------------------------------------- */
  /* 4. Drift reverso: metodos-endpoint em codigo sem registro     */
  /* -------------------------------------------------------------- */
  const anchoredTokensByFile = buildAnchoredTokenIndex(endpoints);
  for (const source of enumerationSources) {
    const text = await readText(source.file);
    if (text === null) {
      warnings.push(`Fonte de enumeracao ausente (drift reverso pulado): ${source.file}.`);
      continue;
    }
    const tokens = extractEndpointMethods(text);
    const registered = anchoredTokensByFile.get(source.file) ?? new Set();
    for (const token of tokens) {
      if (!registered.has(token)) {
        violations.push(
          `Drift reverso (${source.label}): metodo-endpoint \`${token}\` em ${source.file} sem entrada correspondente em endpoints.json.`,
        );
      }
    }
    if (tokens.size > 0) {
      passes.push(`${source.label}: ${tokens.size} metodo(s)-endpoint conferido(s) contra o registro.`);
    }
  }

  return { violations, warnings, passes };
}

/**
 * Valida uma entrada (endpoint ou field) — campos obrigatorios, estado,
 * invariante 2, worker-only, justificativas.
 *
 * @param {any} entry
 * @param {'endpoint' | 'field'} kind
 * @param {{
 *   providerByKey: Map<string, Record<string, string | boolean>>,
 *   violations: string[],
 *   warnings: string[],
 *   seenIds: Set<string>,
 *   requireAnchorWhenImplemented: boolean,
 * }} ctx
 * @returns {void}
 */
function validateEntry(entry, kind, ctx) {
  const { providerByKey, violations, warnings, seenIds } = ctx;
  const label = `${kind} \`${entry && entry.id ? entry.id : '(sem id)'}\``;

  if (!entry || typeof entry !== 'object') {
    violations.push(`${kind}: entrada nao e um objeto.`);
    return;
  }

  if (!isNonEmptyString(entry.id)) {
    violations.push(`${kind}: entrada sem \`id\`.`);
  } else if (seenIds.has(entry.id)) {
    violations.push(`${kind} \`${entry.id}\`: id duplicado.`);
  } else {
    seenIds.add(entry.id);
  }

  // Provider referencial.
  if (!isNonEmptyString(entry.provider)) {
    violations.push(`${label}: sem \`provider\`.`);
  } else if (!providerByKey.has(entry.provider)) {
    violations.push(`${label}: \`provider=${entry.provider}\` nao existe em providers.yaml.`);
  } else {
    const declared = providerByKey.get(entry.provider);
    if (
      isNonEmptyString(entry.provider_api) &&
      declared &&
      String(declared.provider_api) !== entry.provider_api
    ) {
      violations.push(
        `${label}: \`provider_api=${entry.provider_api}\` diverge de providers.yaml (${String(declared.provider_api)}).`,
      );
    }
  }

  // Papel.
  if (!ROLES.includes(entry.role)) {
    violations.push(`${label}: \`role\` invalido (${String(entry.role)}); use ${ROLES.join('|')}.`);
  }

  // Estado de cobertura (exatamente 1 dos 8).
  if (!COVERAGE_STATES.includes(entry.coverage_state)) {
    violations.push(
      `${label}: \`coverage_state\` invalido (${String(entry.coverage_state)}); use um de ${COVERAGE_STATES.join('|')}.`,
    );
  } else {
    if (entry.coverage_state === 'not_applicable' && !isNonEmptyString(entry.justification)) {
      violations.push(`${label}: \`coverage_state=not_applicable\` exige \`justification\`.`);
    }
    if (entry.coverage_state === 'deprecated' && !isNonEmptyString(entry.superseded_by)) {
      violations.push(`${label}: \`coverage_state=deprecated\` exige \`superseded_by\`.`);
    }
  }

  // Invariante 2: provider_api != rating_source e provider_api nao e fonte.
  if (isNonEmptyString(entry.provider_api) && RATING_SOURCES.includes(entry.provider_api)) {
    violations.push(
      `${label}: \`provider_api=${entry.provider_api}\` e uma fonte editorial (invariante 2: provider_api != rating_source).`,
    );
  }
  if (entry.rating_source != null && entry.rating_source !== '') {
    if (!RATING_SOURCES.includes(entry.rating_source)) {
      violations.push(
        `${label}: \`rating_source=${entry.rating_source}\` nao pertence a RATING_SOURCES (${RATING_SOURCES.join('|')}).`,
      );
    }
    if (entry.rating_source === entry.provider_api) {
      violations.push(
        `${label}: \`rating_source\` igual a \`provider_api\` (${entry.rating_source}) — viola invariante 2.`,
      );
    }
  }

  // Worker-only obrigatorio (invariante 3).
  if (entry.worker_only !== true) {
    violations.push(`${label}: \`worker_only\` deve ser \`true\` (invariante 3: zero API externa no render).`);
  }

  // Implemented + justificativa/ancora.
  if (typeof entry.implemented !== 'boolean') {
    violations.push(`${label}: \`implemented\` deve ser boolean.`);
  } else if (entry.implemented === false) {
    if (!isNonEmptyString(entry.justification)) {
      violations.push(`${label}: \`implemented=false\` exige \`justification\` (ex.: roadmap Fase N).`);
    }
    if (ctx.requireAnchorWhenImplemented && entry.anchor && entry.anchor.file) {
      warnings.push(`${label}: \`implemented=false\` porem tem \`anchor\` — remova a ancora ou marque implemented=true.`);
    }
  } else if (entry.implemented === true && ctx.requireAnchorWhenImplemented) {
    if (!entry.anchor || !isNonEmptyString(entry.anchor.file) || !Array.isArray(entry.anchor.must_contain) || entry.anchor.must_contain.length === 0) {
      violations.push(`${label}: \`implemented=true\` exige \`anchor { file, must_contain[] }\`.`);
    }
  }
}

/**
 * Resolve a ancora de codigo de um endpoint implementado: arquivo existe e
 * contem todas as strings de `must_contain`.
 *
 * @param {any} entry
 * @param {{ readText: (relPath: string) => Promise<string | null>, violations: string[] }} ctx
 * @returns {Promise<void>}
 */
async function checkAnchor(entry, ctx) {
  if (!entry || entry.implemented !== true) return;
  const anchor = entry.anchor;
  if (!anchor || !isNonEmptyString(anchor.file) || !Array.isArray(anchor.must_contain)) return; // ja reportado por validateEntry
  const text = await ctx.readText(anchor.file);
  const label = `endpoint \`${entry.id}\``;
  if (text === null) {
    ctx.violations.push(`${label}: ancora aponta arquivo inexistente (${anchor.file}) — drift.`);
    return;
  }
  for (const needle of anchor.must_contain) {
    if (typeof needle !== 'string' || !text.includes(needle)) {
      ctx.violations.push(
        `${label}: ancora ${anchor.file} nao contem \`${String(needle)}\` — codigo mudou/renomeou (drift).`,
      );
    }
  }
}

/**
 * Indexa, por arquivo de ancora, o conjunto de tokens de `must_contain` que sao
 * nomes de metodo-endpoint (`get<X>`), para o cruzamento reverso.
 * @param {unknown} endpoints
 * @returns {Map<string, Set<string>>}
 */
function buildAnchoredTokenIndex(endpoints) {
  /** @type {Map<string, Set<string>>} */
  const byFile = new Map();
  if (!Array.isArray(endpoints)) return byFile;
  for (const entry of endpoints) {
    if (!entry || entry.implemented !== true || !entry.anchor || !isNonEmptyString(entry.anchor.file)) continue;
    const file = entry.anchor.file;
    if (!byFile.has(file)) byFile.set(file, new Set());
    const set = byFile.get(file);
    if (!set || !Array.isArray(entry.anchor.must_contain)) continue;
    for (const needle of entry.anchor.must_contain) {
      if (typeof needle === 'string' && /^get[A-Z]/.test(needle)) set.add(needle);
    }
  }
  return byFile;
}

/**
 * Extrai nomes de metodos-endpoint publicos (`async get<X>(`) do texto.
 * @param {string} text
 * @returns {Set<string>}
 */
function extractEndpointMethods(text) {
  /** @type {Set<string>} */
  const tokens = new Set();
  ENDPOINT_METHOD_RE.lastIndex = 0;
  let match;
  while ((match = ENDPOINT_METHOD_RE.exec(text)) !== null) {
    tokens.add(match[1]);
  }
  return tokens;
}
