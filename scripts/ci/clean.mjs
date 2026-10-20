#!/usr/bin/env node
/**
 * clean.mjs — limpeza MANUAL. A CI nunca chama isto: ela reaproveita
 * node_modules, o cache do Next e as imagens/volumes do Docker de proposito.
 *
 *   node scripts/ci/clean.mjs                  artefatos de build e de teste
 *   node scripts/ci/clean.mjs --node-modules   + todos os node_modules
 *   node scripts/ci/clean.mjs --docker         + imagens e volumes da CI local
 *   node scripts/ci/clean.mjs --dry-run        so lista
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { capture } from './lib/proc.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
for (const a of args) {
  if (!['--node-modules', '--docker', '--dry-run'].includes(a)) {
    console.error(`opcao desconhecida: ${a}`)
    process.exit(1)
  }
}

/** Diretorios de workspace (apps/*, packages/*, api-clients/*, services/*). */
const workspaces = ['apps', 'packages', 'api-clients', 'services'].flatMap((group) => {
  const dir = path.join(REPO_ROOT, group)
  return existsSync(dir) ? readdirSync(dir).map((d) => path.join(dir, d)).filter((d) => statSync(d).isDirectory()) : []
})

const targets = [
  ...workspaces.flatMap((w) => ['.next', 'coverage', '.vitest', '.turbo', 'test-results', 'playwright-report', '.playwright', 'tsconfig.tsbuildinfo'].map((d) => path.join(w, d))),
  ...['coverage', '.vitest', '.turbo', 'test-results', 'playwright-report', 'tsconfig.tsbuildinfo'].map((d) => path.join(REPO_ROOT, d)),
  // Capturas dos QA visuais e o harness de estilo computado (regeraveis).
  ...readdirSync(path.join(REPO_ROOT, 'apps', 'web'))
    .filter((d) => d.startsWith('.qa-'))
    .map((d) => path.join(REPO_ROOT, 'apps', 'web', d)),
]
if (args.has('--node-modules')) targets.push(path.join(REPO_ROOT, 'node_modules'), ...workspaces.map((w) => path.join(w, 'node_modules')))

let removed = 0
for (const t of targets) {
  if (!existsSync(t)) continue
  console.log(`${dryRun ? '[dry-run] ' : ''}remover ${path.relative(REPO_ROOT, t)}`)
  if (!dryRun) rmSync(t, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  removed++
}

if (args.has('--docker')) {
  const images = capture('docker', ['images', '-q', '--filter', 'reference=cinerie-ci-runner'], { allowFail: true }).stdout.split(/\s+/).filter(Boolean)
  const ciTags = ['cinerie-web:ci', 'cinerie-publication:ci', 'cinerie-admin:ci', 'cinerie-cms:ci']
  const volumes = capture('docker', ['volume', 'ls', '-q', '--filter', 'name=cinerie-ci-'], { allowFail: true }).stdout.split(/\s+/).filter(Boolean)
  console.log(`${dryRun ? '[dry-run] ' : ''}docker: ${images.length} imagem(ns) do executor, tags ${ciTags.join(', ')}, ${volumes.length} volume(s) de cache`)
  if (!dryRun) {
    if (images.length) capture('docker', ['rmi', '-f', ...images], { allowFail: true })
    capture('docker', ['rmi', ...ciTags], { allowFail: true })
    if (volumes.length) capture('docker', ['volume', 'rm', ...volumes], { allowFail: true })
  }
}

console.log(`limpeza ${dryRun ? 'simulada' : 'concluida'}: ${removed} caminho(s)`)
