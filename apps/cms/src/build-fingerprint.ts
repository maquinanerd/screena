/**
 * build-fingerprint.ts — Impressao digital do fonte do CMS. PURO.
 *
 * POR QUE ISTO EXISTE. O harness de integracao aceita `CMS_IT_SKIP_BUILD=1`
 * para iterar sem pagar ~4 minutos de `next build` a cada rodada. Na FASE 2B
 * isso me custou caro: rodei a suite com o atalho ligado contra um build
 * ANTIGO, o teste passou, e a correcao de hook que eu acabara de escrever nunca
 * chegou a ser exercitada. Um atalho que MENTE em silencio e pior que atalho
 * nenhum.
 *
 * A trava: o build carimba a impressao digital do fonte; pular o build compara
 * a impressao atual com a carimbada e FALHA se o fonte mudou. O atalho continua
 * existindo, mas so vale quando de fato nao ha nada para reconstruir.
 */

/** Metadado de um arquivo de fonte. `mtimeMs` e `size` bastam para detectar edicao. */
export interface SourceFileStamp {
  readonly path: string
  readonly mtimeMs: number
  readonly size: number
}

/**
 * Serializa os carimbos de forma DETERMINISTICA.
 *
 * Ordenado por caminho: a ordem em que o sistema de arquivos devolve entradas
 * nao pode mudar a impressao digital, senao o atalho falharia aleatoriamente e
 * seria desligado por irritacao — voltando ao problema original.
 */
export function serializeSourceStamps(stamps: readonly SourceFileStamp[]): string {
  return [...stamps]
    .map((stamp) => ({ ...stamp, path: stamp.path.replace(/\\/g, '/') }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((stamp) => `${stamp.path}:${String(stamp.size)}:${String(Math.trunc(stamp.mtimeMs))}`)
    .join('\n')
}

export type BuildFreshness =
  | { readonly fresh: true }
  | { readonly fresh: false; readonly reason: 'no_fingerprint' | 'source_changed' }

/**
 * O build carimbado ainda corresponde ao fonte atual?
 *
 * Sem carimbo o veredito e "nao fresco": nunca presumimos que um build que nao
 * sabemos de onde veio serve.
 */
export function evaluateBuildFreshness(
  recorded: string | null,
  current: string,
): BuildFreshness {
  if (recorded === null || recorded.trim() === '') {
    return { fresh: false, reason: 'no_fingerprint' }
  }
  return recorded.trim() === current.trim()
    ? { fresh: true }
    : { fresh: false, reason: 'source_changed' }
}

/** O atalho de pular build pode ser usado neste ambiente? */
export function skipBuildAllowed(env: Record<string, string | undefined>): boolean {
  // NUNCA em CI. O valor do CI e justamente provar a pipeline inteira; um
  // atalho de conveniencia local nao pode atravessar para la nem por acidente.
  if (env.CI !== undefined && env.CI !== '' && env.CI !== 'false') return false
  return env.CMS_IT_SKIP_BUILD === '1'
}
