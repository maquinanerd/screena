/**
 * audit — Auditoria SOMENTE LEITURA do banco real (Backend A §13).
 *
 * Nunca inventa numero de producao: tudo aqui vem de SELECT/count no banco
 * apontado por DATABASE_URL. NUNCA escreve, NUNCA imprime credencial, e exige
 * `--confirm-production-read` quando o ambiente e producao (ler producao e uma
 * decisao consciente, mesmo sendo read-only).
 *
 * Este modulo e PURO (shape + gate + formatacao); o reader Prisma vive em
 * services/ingestion/src/persistence/audit-reader.ts.
 */

/** Contagens de uma entidade do catalogo. */
export interface EntityCountRow {
  readonly entity: string
  readonly total: number
  readonly lastSyncedAt: Date | null
}

/** Cobertura de midia/trailer por tipo. */
export interface CoverageRow {
  readonly kind: string
  readonly total: number
  readonly withImages: number
  readonly withTrailer: number
  readonly imageRatio: number
  readonly trailerRatio: number
}

/** Estado da fila. */
export interface JobsAuditRow {
  readonly status: string
  readonly count: number
}

/** Checkpoint observado. */
export interface CheckpointAuditRow {
  readonly job: string
  readonly lastPage: number
  readonly totalPages: number | null
  readonly done: boolean
  readonly cursor: string | null
  readonly updatedAt: Date
}

/** Frescor de um snapshot de descoberta. */
export interface SnapshotAuditRow {
  readonly listType: string
  readonly entityType: string
  readonly locale: string
  readonly capturedAt: Date
  readonly expiresAt: Date
  readonly ageSeconds: number
  readonly expired: boolean
  readonly items: number
}

/**
 * Publicabilidade de UM tipo de entidade.
 *
 * Estados distintos que NAO podem ser confundidos: existir no banco, ter rota,
 * poder renderizar, poder ser publicada, entrar no sitemap e ser indexavel sao
 * seis coisas diferentes. Um censo que so conta linhas nao responde nenhuma.
 */
export interface PublishabilityRow {
  readonly entity: string
  readonly total: number
  readonly withSlug: number
  readonly withoutSlug: number
  readonly withTranslation: number
  readonly withoutTranslation: number
  readonly withMedia: number
  readonly withoutMedia: number
  /** Tem rota + titulo: a pagina resolve. */
  readonly renderable: number
  /** Passa nos gates do tipo (inclui elegibilidade de pessoa). */
  readonly publishable: number
  /** Entraria no sitemap hoje. */
  readonly sitemapEligible: number
  /** Tem decisao persistida vigente. */
  readonly withDecision: number
  /** SEM decisao persistida — a policy nunca foi aplicada a ela. */
  readonly missingDecision: number
  /** Decisao persistida DIVERGE do que a policy diria agora. */
  readonly staleDecision: number
}

/** Contagem de decisoes por razao. */
export interface DecisionReasonRow {
  readonly reason: string
  readonly count: number
}

/** Relatorio completo da auditoria. */
export interface DatabaseAuditReport {
  readonly generatedAt: Date
  readonly environment: string
  readonly entities: readonly EntityCountRow[]
  readonly coverage: readonly CoverageRow[]
  readonly jobs: readonly JobsAuditRow[]
  readonly deadLetters: number
  readonly checkpoints: readonly CheckpointAuditRow[]
  readonly snapshots: readonly SnapshotAuditRow[]
  readonly searchDocuments: {
    readonly total: number
    readonly byLocale: readonly { locale: string; count: number }[]
  }
  /** Publicabilidade por tipo (Prompt 03.2). */
  readonly publishability: readonly PublishabilityRow[]
  /** Razoes das decisoes vigentes. */
  readonly decisionReasons: readonly DecisionReasonRow[]
}

/** Porta de leitura da auditoria (SO leitura). */
export interface AuditReaderPort {
  readEntityCounts(): Promise<EntityCountRow[]>
  readCoverage(): Promise<CoverageRow[]>
  readJobs(): Promise<JobsAuditRow[]>
  readDeadLetterCount(): Promise<number>
  readCheckpoints(): Promise<CheckpointAuditRow[]>
  readSnapshots(now: Date): Promise<SnapshotAuditRow[]>
  readSearchDocuments(): Promise<{ total: number; byLocale: { locale: string; count: number }[] }>
  readPublishability(language: string): Promise<PublishabilityRow[]>
  readDecisionReasons(language: string): Promise<DecisionReasonRow[]>
}

/** Decisao do gate de execucao da auditoria. */
export interface AuditGateDecision {
  readonly allowed: boolean
  readonly reason: string | null
}

/**
 * Gate: em producao, exige `--confirm-production-read` explicito. Fora de
 * producao, sempre permitido (continua sendo read-only).
 */
export function evaluateAuditGate(input: {
  readonly environment: string | undefined
  readonly confirmProductionRead: boolean
  readonly hasDatabaseUrl: boolean
}): AuditGateDecision {
  if (!input.hasDatabaseUrl) {
    return { allowed: false, reason: 'DATABASE_URL ausente: nada para auditar.' }
  }
  const isProduction = input.environment === 'production'
  if (isProduction && !input.confirmProductionRead) {
    return {
      allowed: false,
      reason:
        'ambiente de producao: repita com --confirm-production-read para ler o banco de producao (somente leitura).',
    }
  }
  return { allowed: true, reason: null }
}

/** Razao segura de um gate negado (nunca inclui a URL/credencial). */
export function describeAuditGate(decision: AuditGateDecision): string {
  return decision.allowed
    ? 'auditoria liberada (somente leitura)'
    : (decision.reason ?? 'bloqueada')
}

/** Monta o relatorio a partir do reader (nenhuma escrita). */
export async function runDatabaseAudit(
  reader: AuditReaderPort,
  input: {
    readonly environment: string
    readonly now: Date
    /** Idioma das dimensoes de publicabilidade. Default pt-BR (invariante 7). */
    readonly language?: string
  },
): Promise<DatabaseAuditReport> {
  const language = input.language ?? 'pt-BR'
  const [
    entities,
    coverage,
    jobs,
    deadLetters,
    checkpoints,
    snapshots,
    searchDocuments,
    publishability,
    decisionReasons,
  ] = await Promise.all([
    reader.readEntityCounts(),
    reader.readCoverage(),
    reader.readJobs(),
    reader.readDeadLetterCount(),
    reader.readCheckpoints(),
    reader.readSnapshots(input.now),
    reader.readSearchDocuments(),
    reader.readPublishability(language),
    reader.readDecisionReasons(language),
  ])
  return {
    generatedAt: input.now,
    environment: input.environment,
    entities,
    coverage,
    jobs,
    deadLetters,
    checkpoints,
    snapshots,
    searchDocuments,
    publishability,
    decisionReasons,
  }
}

/** Formata o relatorio para o terminal (texto estavel, sem credencial). */
export function formatAuditReport(report: DatabaseAuditReport): string {
  const lines: string[] = []
  lines.push(`=== Auditoria do catalogo (somente leitura) — ${report.environment} ===`)
  lines.push(`gerado em: ${report.generatedAt.toISOString()}`)
  lines.push('')
  lines.push('-- Entidades --')
  for (const e of report.entities) {
    const last = e.lastSyncedAt === null ? 'nunca' : e.lastSyncedAt.toISOString()
    lines.push(`  ${e.entity.padEnd(24)} ${String(e.total).padStart(8)}  ultimo sync: ${last}`)
  }
  lines.push('')
  lines.push('-- Cobertura de midia --')
  for (const c of report.coverage) {
    lines.push(
      `  ${c.kind.padEnd(10)} total=${c.total} imagens=${c.withImages} (${(c.imageRatio * 100).toFixed(1)}%) trailer=${c.withTrailer} (${(c.trailerRatio * 100).toFixed(1)}%)`,
    )
  }
  lines.push('')
  lines.push('-- Fila (catalog_jobs) --')
  for (const j of report.jobs) lines.push(`  ${j.status.padEnd(14)} ${j.count}`)
  lines.push(`  dead-letters: ${report.deadLetters}`)
  lines.push('')
  lines.push('-- Checkpoints --')
  if (report.checkpoints.length === 0) lines.push('  (nenhum)')
  for (const c of report.checkpoints) {
    lines.push(
      `  ${c.job.padEnd(20)} page=${c.lastPage}/${c.totalPages ?? '?'} done=${c.done} cursor=${c.cursor ?? '-'}`,
    )
  }
  lines.push('')
  lines.push('-- Snapshots de descoberta --')
  if (report.snapshots.length === 0) lines.push('  (nenhum)')
  for (const s of report.snapshots) {
    lines.push(
      `  ${s.listType.padEnd(12)} ${s.entityType.padEnd(6)} ${s.locale} itens=${s.items} idade=${s.ageSeconds}s ${s.expired ? 'EXPIRADO' : 'valido'}`,
    )
  }
  lines.push('')
  lines.push('-- Busca --')
  lines.push(`  search_documents: ${report.searchDocuments.total}`)
  for (const l of report.searchDocuments.byLocale) lines.push(`    ${l.locale}: ${l.count}`)
  lines.push('')
  lines.push('-- Publicabilidade (existir != renderizar != publicar != indexar) --')
  for (const p of report.publishability) {
    lines.push(
      `  ${p.entity.padEnd(8)} total=${p.total} slug=${p.withSlug}/-${p.withoutSlug} ` +
        `traducao=${p.withTranslation}/-${p.withoutTranslation} midia=${p.withMedia}/-${p.withoutMedia}`,
    )
    lines.push(
      `           renderizavel=${p.renderable} publicavel=${p.publishable} sitemap=${p.sitemapEligible}`,
    )
    lines.push(
      `           decisao: com=${p.withDecision} ausente=${p.missingDecision} divergente=${p.staleDecision}`,
    )
  }
  lines.push('')
  lines.push('-- Razoes das decisoes vigentes --')
  if (report.decisionReasons.length === 0) lines.push('  (nenhuma decisao registrada)')
  for (const r of report.decisionReasons) lines.push(`  ${r.reason.padEnd(24)} ${r.count}`)
  return lines.join('\n')
}
