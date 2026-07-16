#!/usr/bin/env node
// @ts-check
/**
 * check-api-coverage.mjs — Auditoria de COBERTURA DE API da Cinerie (Fase 5).
 *
 * Le o registro em `docs/api-coverage/` (providers.yaml + endpoints.json +
 * fields.json) e o cruza com o codigo real (ancoras + drift reverso), travando
 * as invariantes de cobertura. Roda 100% offline, sem rede, sem DB, sem
 * dependencias externas (apenas Node ESM) — mesmo contrato de
 * `check-invariants.mjs` / `check-render-purity.mjs`.
 *
 * O que verifica (ver `api-coverage-core.mjs` para a logica pura):
 *  (a) Todo endpoint E todo campo tem EXATAMENTE 1 dos 8 estados de cobertura.
 *  (b) `provider_api` != `rating_source` e nunca e uma fonte editorial (inv. 2).
 *  (c) `worker_only === true` em toda entrada (inv. 3: zero API externa no render).
 *  (d) `not_applicable` exige justificativa; `deprecated` exige substituto.
 *  (e) Ancora de codigo: entrada implementada aponta arquivo real que contem os
 *      simbolos declarados (quebra em drift se renomear/sumir).
 *  (f) Drift reverso: metodo-endpoint `async get<X>(` nos clients enumerados sem
 *      entrada no registro = violacao.
 *
 * Saida: relatorio legivel + process.exit(1) se houver VIOLACAO; exit(0) se OK;
 * exit(2) em erro fatal.
 *
 * Uso:
 *   node scripts/audit/check-api-coverage.mjs
 *   pnpm api:coverage
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { evaluateApiCoverage } from './api-coverage-core.mjs';

/** Raiz a partir da qual tudo e resolvido (relativo ao cwd do processo). */
const ROOT = process.cwd();

/** Diretorio canonico do registro de cobertura. */
const REGISTRY_DIR = 'docs/api-coverage';

/**
 * Le um arquivo de texto relativo a ROOT. Retorna null (e nao lanca) se ENOENT.
 * @param {string} relPath
 * @returns {Promise<string | null>}
 */
async function readText(relPath) {
  try {
    return await readFile(path.join(ROOT, relPath), 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Le e faz parse de um JSON do registro. Lanca (capturado pelo main) com uma
 * mensagem clara se ausente/malformado.
 * @param {string} relPath
 * @returns {Promise<unknown>}
 */
async function readJson(relPath) {
  const text = await readText(relPath);
  if (text === null) {
    throw new Error(`Arquivo do registro ausente: ${relPath} (esperado em ${REGISTRY_DIR}/).`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON invalido em ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Imprime o relatorio e encerra com o codigo adequado.
 * @param {{ violations: string[], warnings: string[], passes: string[] }} result
 * @returns {void}
 */
function report(result) {
  const { violations, warnings, passes } = result;

  console.log('============================================================');
  console.log(' Cinerie — Auditoria de cobertura de API (check-api-coverage)');
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
    console.log('\nResultado: FALHOU. Registro de cobertura em drift — corrija as violacoes acima.');
    process.exit(1);
  }

  console.log('\nResultado: PASSOU. Registro de cobertura consistente com o codigo.');
  process.exit(0);
}

async function main() {
  const providersText = await readText(`${REGISTRY_DIR}/providers.yaml`);
  if (providersText === null) {
    throw new Error(`Arquivo do registro ausente: ${REGISTRY_DIR}/providers.yaml.`);
  }
  const endpoints = await readJson(`${REGISTRY_DIR}/endpoints.json`);
  const fields = await readJson(`${REGISTRY_DIR}/fields.json`);

  const result = await evaluateApiCoverage({ providersText, endpoints, fields, readText });
  report(result);
}

main().catch((err) => {
  console.error('\n[ERRO FATAL] A auditoria de cobertura nao pode concluir:');
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
