/**
 * snapshot.mjs — o working tree como o GitHub o veria, em LF, num `.tar`.
 *
 * POR QUE NAO COPIAR A PASTA: no Windows o checkout tem `core.autocrlf=true` e
 * os arquivos estao com CRLF no disco (o indice guarda LF). Um `docker build`
 * a partir do disco copiaria `scripts/container/pid1-shell.sh` com `\r` — e
 * esse script E o `/bin/sh` das imagens: a imagem local sairia diferente (e
 * quebrada) da que o EasyPanel constroi a partir do GitHub. O mesmo vale para
 * qualquer `.sh` rodado dentro do container Linux.
 *
 * COMO: um INDICE TEMPORARIO (copia do real, para nao re-hashear o que nao
 * mudou) recebe `git add -A`, vira uma arvore com `git write-tree`, e a arvore
 * sai por `git archive` sem conversao de fim de linha. Inclui alteracoes nao
 * commitadas e arquivos novos nao ignorados; respeita o `.gitignore`. Nao toca
 * no indice real, no stash nem em branch nenhuma.
 */

import { copyFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'

import { capture } from './proc.mjs'

/** Cria `outFile` (.tar) com o working tree de `repoRoot`. Devolve o id da arvore. */
export function createSnapshot(repoRoot, outFile) {
  const gitIndex = path.resolve(repoRoot, capture('git', ['rev-parse', '--git-path', 'index'], { cwd: repoRoot }).stdout.trim())
  const tmpIndex = `${outFile}.index`
  if (existsSync(gitIndex)) copyFileSync(gitIndex, tmpIndex)
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
  try {
    // safecrlf=false: sem o aviso "LF will be replaced by CRLF" para cada arquivo.
    capture('git', ['-c', 'core.safecrlf=false', 'add', '-A'], { cwd: repoRoot, env })
    const tree = capture('git', ['write-tree'], { cwd: repoRoot, env }).stdout.trim()
    capture('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=tar', '-o', outFile, tree], {
      cwd: repoRoot,
    })
    return tree
  } finally {
    rmSync(tmpIndex, { force: true })
  }
}
