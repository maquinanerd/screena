#!/usr/bin/env node
/**
 * hooks.mjs — liga ou desliga os hooks versionados em `.githooks/`.
 *
 *   node scripts/ci/hooks.mjs install     git config core.hooksPath .githooks
 *   node scripts/ci/hooks.mjs uninstall   remove o core.hooksPath
 *   node scripts/ci/hooks.mjs status
 *
 * Sem dependencia nova (nada de Husky/lefthook): o git ja sabe usar um
 * diretorio de hooks versionado.
 *
 * ATENCAO: `core.hooksPath` vai para a config COMPARTILHADA do repositorio —
 * vale para o checkout principal e para todos os worktrees. Num worktree sem
 * `node_modules` o pre-push reprova (de proposito: sem dependencias nao ha
 * validacao). Para um push pontual sem hooks: `git push --no-verify`.
 */

import { capture } from './lib/proc.mjs'

const action = process.argv[2] ?? 'status'
const current = () => capture('git', ['config', '--get', 'core.hooksPath'], { allowFail: true }).stdout.trim()

if (action === 'install') {
  capture('git', ['config', 'core.hooksPath', '.githooks'])
  console.log('hooks instalados: core.hooksPath=.githooks')
  console.log('  pre-commit -> eslint nos arquivos staged')
  console.log('  pre-push   -> CI local, perfil rapido (typecheck, lint, test, auditorias, build)')
  console.log('Vale para TODOS os worktrees deste repositorio. Desfazer: corepack pnpm run hooks:uninstall')
} else if (action === 'uninstall') {
  if (current()) capture('git', ['config', '--unset', 'core.hooksPath'])
  console.log('hooks desligados (core.hooksPath removido)')
} else if (action === 'status') {
  const value = current()
  console.log(value === '.githooks' ? 'hooks instalados (core.hooksPath=.githooks)' : `hooks nao instalados (core.hooksPath=${value || 'vazio'})`)
} else {
  console.error(`acao desconhecida: ${action} (use install, uninstall ou status)`)
  process.exit(1)
}
