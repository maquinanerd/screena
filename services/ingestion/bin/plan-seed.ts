#!/usr/bin/env node
/**
 * bin/plan-seed.ts — Planejador da SEMENTE do espelho, em MODO SECO.
 *
 * Baixa o Daily ID Export publico (`files.tmdb.org/p/exports`), ordena por
 * popularidade, corta no teto pedido e IMPRIME o plano. Nao busca detalhe, nao
 * escreve no banco, nao grava objeto, nao gasta um unico request de cota de
 * API: o export e arquivo publico e NAO exige token TMDB.
 *
 * Por isso este comando roda HOJE, sem nenhuma credencial provisionada — que e
 * exatamente o ponto: dimensionar o custo ANTES de contratar o bucket.
 *
 * NAO ENTRA NA SEMENTE: pessoa. Sao 4,86 M (77% do universo) e a esmagadora
 * maioria nunca sera pedida. As alcancaveis pelos titulos da semente chegam
 * pelos creditos, no MESMO request do titulo.
 *
 * A ordenacao acontece sobre o export INTEIRO (`selectTopByPopularity`), nunca
 * sobre um prefixo. Ver `src/discovery/seed-plan.ts` e o teste
 * `discovery-seed-plan.test.ts`, que trava o defeito nos dois sentidos.
 *
 * Uso (a partir da raiz):
 *   node <caminho-do-tsx> services/ingestion/bin/plan-seed.ts
 *   node <caminho-do-tsx> services/ingestion/bin/plan-seed.ts --limit=50000 --date=2026-08-10
 *   # flags:
 *   #   --limit=N            teto TOTAL de titulos (default 50000), rateado
 *   #                        entre filme e serie na proporcao do universo
 *   #   --limit-movies=N     teto explicito de filmes (sobrepoe o rateio)
 *   #   --limit-tv=N         teto explicito de series (sobrepoe o rateio)
 *   #   --date=YYYY-MM-DD    data do export (default: ontem UTC, que e o ultimo
 *   #                        publicado com certeza)
 *   #   --avg-bytes-movie=N  bytes/entidade MEDIDOS de filme (ver nota de base)
 *   #   --avg-bytes-tv=N     bytes/entidade MEDIDOS de serie
 *   #   --json               imprime o plano como JSON em vez de texto
 */

import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import readline from 'node:readline'

import { appendChunksForType } from '@screena/tmdb-client'

import { filterAdult } from '../src/discovery/adult-filter.js'
import {
  DAILY_ID_EXPORTS,
  exportUrl,
  parseIdExportLine,
  type IdExportFile,
  type IdExportRecord,
} from '../src/discovery/id-exports.js'
import {
  buildSeedPlan,
  formatBytes,
  selectTopByPopularity,
  type MeasuredPayloadSize,
  type SeedKind,
  type SeedSelection,
} from '../src/discovery/seed-plan.js'

/** Teto total default da semente. */
const DEFAULT_TOTAL_LIMIT = 50_000

/**
 * Rateio default do teto entre filme e serie.
 *
 * Base: o universo medido no export de 2026-08-10 tem 1.230.788 filmes e
 * 228.804 series — cerca de 84% / 16%. O rateio espelha essa proporcao para nao
 * inflar artificialmente um dos dois lados. `--limit-movies`/`--limit-tv`
 * sobrepoem quando o operador quiser outra mistura.
 */
const DEFAULT_SPLIT: Readonly<Record<SeedKind, number>> = { movie: 0.84, tv: 0.16 }

/** Exports que alimentam a semente (pessoa fica de fora, de proposito). */
const SEED_EXPORTS: Readonly<Record<SeedKind, IdExportFile>> = {
  movie: DAILY_ID_EXPORTS.find((e) => e.kind === 'movie')!,
  tv: DAILY_ID_EXPORTS.find((e) => e.kind === 'tv')!,
}

interface Flags {
  readonly totalLimit: number
  readonly limitByKind: Readonly<Record<SeedKind, number>>
  readonly date: Date
  readonly measured: readonly MeasuredPayloadSize[]
  readonly json: boolean
}

function flagValue(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`
  const hit = argv.find((arg) => arg.startsWith(prefix))
  return hit === undefined ? null : hit.slice(prefix.length)
}

function positiveInt(raw: string | null, fallback: number, name: string): number {
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} deve ser inteiro >= 0; recebido ${JSON.stringify(raw)}`)
  }
  return value
}

/** Ontem UTC: o export de hoje pode ainda nao ter sido publicado (~08:00 UTC). */
function yesterdayUtc(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000)
}

function parseFlags(argv: readonly string[]): Flags {
  const rawDate = flagValue(argv, 'date')
  let date = yesterdayUtc()
  if (rawDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      throw new Error(`--date deve ser YYYY-MM-DD; recebido ${JSON.stringify(rawDate)}`)
    }
    date = new Date(`${rawDate}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime())) throw new Error(`--date invalida: ${rawDate}`)
  }

  const totalLimit = positiveInt(flagValue(argv, 'limit'), DEFAULT_TOTAL_LIMIT, 'limit')
  const limitByKind: Record<SeedKind, number> = {
    movie: positiveInt(
      flagValue(argv, 'limit-movies'),
      Math.round(totalLimit * DEFAULT_SPLIT.movie),
      'limit-movies',
    ),
    tv: positiveInt(
      flagValue(argv, 'limit-tv'),
      Math.round(totalLimit * DEFAULT_SPLIT.tv),
      'limit-tv',
    ),
  }

  const measured: MeasuredPayloadSize[] = []
  for (const kind of ['movie', 'tv'] as const) {
    const raw = flagValue(argv, `avg-bytes-${kind}`)
    if (raw === null) continue
    const avgBytes = Number(raw)
    if (!Number.isFinite(avgBytes) || avgBytes <= 0) {
      throw new Error(`--avg-bytes-${kind} deve ser numero > 0`)
    }
    // `sampleSize: 1` marca "veio de medicao do operador". A base fica impressa
    // no relatorio; uma estimativa cuja base nao aparece nao vale nada.
    measured.push({ kind, avgBytes, sampleSize: 1 })
  }

  return { totalLimit, limitByKind, date, measured, json: argv.includes('--json') }
}

/** Le o export gzip linha a linha, sem materializar o arquivo inteiro. */
async function readExport(
  file: IdExportFile,
  date: Date,
): Promise<{ records: IdExportRecord[]; skippedLines: number; url: string }> {
  const url = exportUrl(file.file, date)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`export ${file.file} respondeu HTTP ${response.status}`)
  }
  if (response.body === null) {
    throw new Error(`export ${file.file} veio sem corpo`)
  }

  const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(
    createGunzip(),
  )
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })

  const records: IdExportRecord[] = []
  let skippedLines = 0
  for await (const line of lines) {
    const record = parseIdExportLine(line)
    // Linha ilegivel e CONTADA, nunca descartada em silencio.
    if (record === null) {
      if (line.trim() !== '') skippedLines += 1
      continue
    }
    records.push(record)
  }
  return { records, skippedLines, url }
}

function renderText(
  plan: ReturnType<typeof buildSeedPlan>,
  context: {
    readonly date: string
    readonly skipped: Record<SeedKind, number>
    readonly adultDropped: Record<SeedKind, number>
    readonly unsafeDropped: Record<SeedKind, number>
  },
): string {
  const lines: string[] = []
  lines.push('PLANO DA SEMENTE (modo seco: nada foi buscado, nada foi escrito)')
  lines.push(`Export do dia ${context.date} — arquivo publico, ZERO cota de API consumida.`)
  lines.push('')

  for (const kind of plan.kinds) {
    const s = kind.stats
    lines.push(`[${kind.kind}]`)
    lines.push(`  universo considerado   ${s.considered.toLocaleString('pt-BR')}`)
    lines.push(`  selecionados           ${kind.entities.toLocaleString('pt-BR')}`)
    lines.push(
      `  corte de popularidade  ${s.cutoffPopularity === null ? '-' : s.cutoffPopularity.toFixed(3)}` +
        `   (topo: ${s.topPopularity === null ? '-' : s.topPopularity.toFixed(3)})`,
    )
    lines.push(`  abaixo do corte        ${s.belowCut.toLocaleString('pt-BR')}`)
    lines.push(
      `  descartes              id invalido ${s.invalidId} · duplicado ${s.duplicate} · ` +
        `sem popularidade ${s.missingPopularity} · adulto ${context.adultDropped[kind.kind]} · ` +
        `malformado ${context.unsafeDropped[kind.kind]} · linha ilegivel ${context.skipped[kind.kind]}`,
    )
    lines.push(
      `  requests de detalhe    ${kind.requests.toLocaleString('pt-BR')}` +
        `   (${kind.appendChunks} bloco(s) de append_to_response por entidade)`,
    )
    lines.push(
      `  bytes brutos           ${formatBytes(kind.rawBytes)}` +
        `   (${formatBytes(kind.bytesPerEntity.avgBytes)}/entidade, base: ${kind.bytesPerEntity.basis})`,
    )
    lines.push('')
  }

  lines.push('TOTAL')
  lines.push(`  entidades              ${plan.totalEntities.toLocaleString('pt-BR')}`)
  lines.push(`  requests               ${plan.totalRequests.toLocaleString('pt-BR')}`)
  lines.push(`  bytes brutos (sem gzip) ${formatBytes(plan.totalRawBytes)}`)
  lines.push('')

  if (plan.usesFallbackBytes) {
    lines.push('AVISO SOBRE A BASE DOS BYTES')
    lines.push(
      '  Pelo menos um tipo usou o FALLBACK de bytes/entidade, nao uma medicao. ' +
        'O numero acima e uma ordem de grandeza, nao um orcamento.',
    )
    lines.push(
      '  Para medir de verdade: rode `bin/sync-tmdb-raw.ts` num lote pequeno e leia ' +
        '`payloadSizes` do relatorio (avgBytes por tipo, em bytes UTF-8 da mesma ' +
        'serializacao canonica que alimenta o hash). Depois passe ' +
        '--avg-bytes-movie=N --avg-bytes-tv=N.',
    )
    lines.push('')
  }

  lines.push('O QUE ESTE PLANO NAO DIZ')
  lines.push('  - Pessoas nao estao na semente (entram pelos creditos dos titulos).')
  lines.push('  - Temporadas/episodios sao um segundo passe, nao contabilizado aqui.')
  lines.push('  - Bytes sao do payload CRU. Object store cobra o objeto como gravado;')
  lines.push('    `tmdb_raw` (jsonb) comprimiria via TOAST — sao numeros diferentes.')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  let flags: Flags
  try {
    flags = parseFlags(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  const isoDate = flags.date.toISOString().slice(0, 10)
  console.log(`Baixando os exports publicos do dia ${isoDate} (sem token, sem cota)...`)

  const selections: SeedSelection[] = []
  const skipped: Record<SeedKind, number> = { movie: 0, tv: 0 }
  const adultDropped: Record<SeedKind, number> = { movie: 0, tv: 0 }
  const unsafeDropped: Record<SeedKind, number> = { movie: 0, tv: 0 }
  const failures: string[] = []

  for (const kind of ['movie', 'tv'] as const) {
    const file = SEED_EXPORTS[kind]
    try {
      const { records, skippedLines, url } = await readExport(file, flags.date)
      console.log(`  ${file.file}: ${records.length.toLocaleString('pt-BR')} linhas — ${url}`)
      skipped[kind] = skippedLines

      // Camada 2 do fail-closed de conteudo adulto: por linha, por tipo. Um
      // export que DEVERIA trazer `adult` e nao traz e tratado como inseguro.
      const filtered = filterAdult(records, { adultFieldRequired: file.hasAdultField })
      adultDropped[kind] = filtered.adultDropped
      unsafeDropped[kind] = filtered.unsafeDropped

      selections.push(selectTopByPopularity(kind, filtered.kept, flags.limitByKind[kind]))
    } catch (error) {
      // Export que falha e ERRO do plano, nunca "zero entidades". Um plano
      // parcial apresentado como completo faria alguem orcar pela metade.
      failures.push(`${file.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (failures.length > 0) {
    console.error('\nFALHA ao baixar export(s):')
    for (const failure of failures) console.error(`  - ${failure}`)
    console.error('\nO plano NAO foi emitido: um plano parcial nao serve para orcar.')
    process.exitCode = 1
    return
  }

  const plan = buildSeedPlan({
    selections,
    // Derivado do proprio catalogo de append do client, nunca chutado.
    appendChunksByKind: {
      movie: appendChunksForType('movie').length,
      tv: appendChunksForType('tv').length,
    },
    measured: flags.measured,
  })

  if (flags.json) {
    console.log(JSON.stringify({ date: isoDate, plan, skipped, adultDropped, unsafeDropped }, null, 2))
    return
  }
  console.log(`\n${renderText(plan, { date: isoDate, skipped, adultDropped, unsafeDropped })}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
