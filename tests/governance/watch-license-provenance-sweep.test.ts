/**
 * watch-license-provenance-sweep.test.ts — VARREDURA FECHADA: casar uma licenca
 * de `watch_availability` por `source_key` obriga a casar tambem `provider_key`.
 *
 * O PROBLEMA. Desde que a oferta de streaming passou a poder vir por DOIS
 * fornecedores tecnicos (`streaming_availability` -> Movie of the Night; `tmdb`
 * -> JustWatch), existem DUAS licencas vigentes para o MESMO
 * `source_key` (= `watch_providers.slug`). Elas coexistem legitimamente porque
 * `source_licenses_current_unique` inclui `provider_key`.
 *
 * A consequencia e assimetrica e silenciosa: uma consulta que ache a licenca
 * so por `(source_key, content_type)` e resolva o empate com `ORDER BY id DESC`
 * devolve a licenca mais NOVA para as DUAS origens. O dado da RapidAPI passa a
 * sair creditado ao JustWatch — proveniencia FALSA, exatamente o defeito que a
 * separacao por origem existe para impedir, agora invertido e mais dificil de
 * ver, porque a licenca certa existe do lado.
 *
 * POR QUE UMA VARREDURA E NAO TRES ASSERCOES. As tres consultas que hoje fazem
 * isso certo (`watch-providers-store`, `watch-credit-lookup`,
 * `watch-review-store`) ja estao corretas — testar nominalmente essas tres
 * provaria o presente e nada sobre o futuro. Tres e um numero, nao uma prova de
 * completude. O que este teste trava e a REGRA, aplicada a toda consulta que
 * existir depois: quem procura a licenca pela CHAVE tem de dizer de qual ORIGEM.
 *
 * A REGRA, e por que ela se sustenta sozinha:
 *   - Consulta que casa a licenca por `source_key` esta ESCOLHENDO entre as
 *     licencas do slug -> precisa de `provider_key` para nao escolher errado.
 *   - Consulta que chega a licenca pela FK da linha
 *     (`watch_availability.data_usage_decision_id` -> decisao -> licenca) nao
 *     escolhe nada: a proveniencia ja foi fixada na escrita. E o caso do render
 *     (`entity-watch.ts`), que por isso nao menciona `source_key` e sai isento
 *     sem precisar de allowlist. Allowlist apodrece; ausencia de `source_key` e
 *     um fato verificavel do proprio texto.
 *
 * ESCOPO, declarado (nao e descuido): so codigo de RUNTIME — `src/` e `bin/` de
 * `apps/web`, `services/*` e `packages/*`. Os `scripts/validate-*` montam banco
 * efemero proprio e inserem UMA licenca por cenario, entao nao ha empate para
 * resolver neles; e por eles nao passa credito para usuario nenhum.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SELF = fileURLToPath(import.meta.url)

/** Diretorios que nunca entram na varredura (nao sao runtime deste repo). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '__tests__',
  'migrations',
  // Validadores/QA: banco efemero proprio, UMA licenca por cenario (ver escopo).
  'scripts',
])

/** Raizes de runtime varridas. */
const RUNTIME_ROOTS = ['apps', 'services', 'packages', 'api-clients'] as const

/** So `src/` e `bin/` sao runtime dentro de um workspace. */
const RUNTIME_SEGMENTS = ['src', 'bin']

function collect(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      collect(full, out)
      continue
    }
    if (!/\.(ts|tsx|mts|cts)$/.test(entry)) continue
    if (full === SELF) continue
    out.push(full)
  }
}

function runtimeFiles(): string[] {
  const files: string[] = []
  for (const root of RUNTIME_ROOTS) collect(path.join(ROOT, root), files)
  return files.filter((file) => {
    const parts = path.relative(ROOT, file).split(path.sep)
    return parts.some((part) => RUNTIME_SEGMENTS.includes(part))
  })
}

/**
 * Quebra o texto em literais de template (o corpo entre crases), que e onde o
 * SQL vive neste repo (`$queryRaw`/`$executeRaw`/constante de SQL). Analisar
 * por literal, e nao por arquivo, evita o falso verde de um arquivo com duas
 * consultas em que so uma filtra.
 */
function templateLiterals(source: string): string[] {
  const chunks = source.split('`')
  const literals: string[] = []
  for (let i = 1; i < chunks.length; i += 2) literals.push(chunks[i]!)
  return literals
}

/** A consulta ESCOLHE uma licenca de watch pela chave do provedor canonico? */
function picksWatchLicenseByKey(sql: string): boolean {
  return (
    /source_licenses/.test(sql) &&
    /watch_availability/.test(sql) &&
    /source_key/.test(sql)
  )
}

/** A consulta diz de qual ORIGEM (fornecedor tecnico) e a licenca? */
function constrainsProvider(sql: string): boolean {
  return /provider_key/.test(sql)
}

interface Offender {
  readonly file: string
  readonly excerpt: string
}

function sweep(): { readonly matched: string[]; readonly offenders: Offender[] } {
  const matched: string[] = []
  const offenders: Offender[] = []

  for (const file of runtimeFiles()) {
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!source.includes('source_licenses')) continue

    for (const sql of templateLiterals(source)) {
      if (!picksWatchLicenseByKey(sql)) continue
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      matched.push(rel)
      if (!constrainsProvider(sql)) {
        offenders.push({ file: rel, excerpt: sql.replace(/\s+/g, ' ').slice(0, 200) })
      }
    }
  }

  return { matched, offenders }
}

describe('proveniencia: quem casa licenca de watch por source_key casa provider_key', () => {
  const { matched, offenders } = sweep()

  /**
   * CONTROLE POSITIVO DA VARREDURA. Sem ele, um erro de caminho/filtro que
   * deixasse a varredura vazia passaria como "nenhum ofensor" — o verde mais
   * perigoso que existe: o que afirma cobertura sem ter lido nada.
   */
  it('CONTROLE POSITIVO: a varredura encontra as consultas que sabemos existir', () => {
    expect(matched.length).toBeGreaterThanOrEqual(3)
    const files = new Set(matched)
    expect(files).toContain('services/ingestion/src/persistence/watch-providers-store.ts')
    expect(files).toContain('services/streaming/src/persistence/watch-credit-lookup.ts')
    expect(files).toContain('services/streaming/src/persistence/watch-review-store.ts')
  })

  it('nenhuma consulta de runtime escolhe licenca de watch sem dizer a origem', () => {
    expect(offenders).toEqual([])
  })

  /**
   * CONTROLE NEGATIVO DO DETECTOR. Prova que a regra REPROVA o texto errado —
   * senao "zero ofensores" poderia significar apenas que o detector nao detecta.
   * Este SQL e sintetico e existe so aqui; e a forma exata que o
   * `authorization-spec.ts` descreve como proveniencia falsa.
   */
  it('CONTROLE NEGATIVO: o detector reprova a consulta sem filtro de origem', () => {
    const semFiltro = [
      'SELECT l."id" FROM "source_licenses" l',
      "WHERE l.\"source_key\" = p.\"slug\" AND l.\"content_type\" = 'watch_availability'",
      'AND l."is_current" ORDER BY l."id" DESC LIMIT 1',
    ].join(' ')
    expect(picksWatchLicenseByKey(semFiltro)).toBe(true)
    expect(constrainsProvider(semFiltro)).toBe(false)

    const comFiltro = `${semFiltro} AND l."provider_key" = $1`
    expect(picksWatchLicenseByKey(comFiltro)).toBe(true)
    expect(constrainsProvider(comFiltro)).toBe(true)
  })

  /**
   * O render e isento POR CONSTRUCAO, e este teste prova o motivo em vez de
   * confiar nele: ele nao casa licenca por chave nenhuma — parte da FK que a
   * linha ja carrega, entao a origem ja esta fixada. Se um dia alguem trocar
   * essa travessia por uma busca por `source_key`, a varredura acima passa a
   * exigir `provider_key` dele tambem, sem que ninguem precise lembrar.
   */
  it('o render chega a licenca pela FK da linha, nao por busca por chave', () => {
    const render = readFileSync(
      path.join(ROOT, 'apps/web/src/server/entity-watch.ts'),
      'utf8',
    )
    expect(render).toContain('dataUsageDecision')
    expect(render).toContain('sourceLicense')
    expect(render).not.toContain('source_key')
    expect(render).not.toContain('sourceKey')
  })
})
