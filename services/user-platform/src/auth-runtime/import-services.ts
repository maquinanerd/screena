/**
 * SERVICOS DE APLICACAO da IMPORTACAO (C8).
 *
 * O fluxo obrigatorio da missao (§28) — nunca "upload e escreve tudo":
 *
 *   upload -> parse -> normalize -> match -> preview  [NENHUMA escrita]
 *                                              |
 *                                     confirmacao do usuario
 *                                              |
 *                                            apply
 *
 * TRES GARANTIAS, cada uma com seu mecanismo:
 *
 *  1. IDEMPOTENCIA (§39). Reimportar o mesmo arquivo nao duplica nada, porque
 *     TODA escrita e um upsert sobre um unique: watch state por
 *     (user, entidade), progresso por (user, episodio), item de lista por
 *     (lista, entidade), evento de diario por (user, chave, tipo). A segunda
 *     execucao encontra tudo no lugar e nao muda nada.
 *
 *  2. RETOMADA (§41). O plano e ORDENADO por linha do arquivo e `appliedCount`
 *     e o cursor. Reprocessar comeca em `appliedCount` — e, como cada acao e
 *     idempotente, mesmo recomecar do zero produziria o mesmo estado final.
 *
 *  3. CONCORRENCIA (§50). O CAS de status do job (`preview_ready -> applying`)
 *     elege UM vencedor entre dois `apply` simultaneos. Os uniques ja
 *     protegeriam o dado; o CAS evita o trabalho duplicado e a contagem
 *     inflada.
 */

import {
  buildImportPlan,
  classifyMatch,
  dedupeRecords,
  existingStateKey,
  parseCsv,
  parseSourceRows,
  sanitizeFileName,
  validateAndDecodeUpload,
  validateSourceHeader,
  type ExistingEntityState,
  type ImportPlan,
  type ImportTargetState,
  type MatchedImportRecord,
  type SupportedImportSource,
} from "../imports/index.js";
import { assertTrackingMutationAllowed } from "../tracking/policy.js";
import { type DomainResult, err, ok } from "../core/result.js";
import type { AuthenticatedContext, AuthRuntimeDeps, LibraryStores } from "./deps.js";
import type { ImportJobRecord, TransactionScope } from "../persistence/types.js";
import { setWatchState } from "./library-services.js";

/** Candidatos lidos por titulo — acima disso a linha e ambigua de qualquer modo. */
const TITLE_CANDIDATE_LIMIT = 5;

/** Acoes aplicadas por transacao. Mantem cada commit curto e retomavel. */
export const IMPORT_APPLY_BATCH = 200;

export interface CreateImportInput {
  readonly source: SupportedImportSource;
  readonly targetState: ImportTargetState;
  readonly fileName: string | null;
  readonly bytes: Uint8Array;
}

export interface ImportPreviewResult {
  readonly job: ImportJobRecord;
  readonly plan: ImportPlan;
}

/**
 * Recebe o arquivo, monta o PREVIEW e persiste o plano — sem tocar na
 * biblioteca do usuario.
 *
 * O job nasce `uploaded` e termina esta funcao em `preview_ready`. Nenhuma
 * escrita de biblioteca acontece aqui: e a promessa que a tela de
 * pre-visualizacao faz ao usuario.
 */
export async function createImportPreview(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: CreateImportInput,
): Promise<DomainResult<ImportPreviewResult>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }

  // 1. BYTES: tamanho, assinatura binaria (ZIP e afins recusados), UTF-8 e NUL.
  const texto = validateAndDecodeUpload(input.bytes);
  if (!texto.ok) {
    return texto;
  }

  // 2. CSV.
  const tabela = parseCsv(texto.value);
  if (!tabela.ok) {
    return tabela;
  }

  // 3. Cabecalho compativel com a fonte declarada (reprova o ARQUIVO, nao
  //    linha a linha: quem enviou o arquivo errado precisa saber de imediato).
  const cabecalho = validateSourceHeader(input.source, tabela.value);
  if (!cabecalho.ok) {
    return cabecalho;
  }

  // 4. Normalizacao + deduplicacao dentro do proprio arquivo.
  const lidas = parseSourceRows(input.source, tabela.value, input.targetState);
  const { unique, duplicates } = dedupeRecords(lidas.records);

  const now = deps.now();
  const fileName = sanitizeFileName(input.fileName);

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const criado = await stores.imports.create(scope, {
      userId: authenticated.userId,
      source: input.source,
      status: "uploaded",
      fileName,
    });

    // 5. MATCHING contra o catalogo, linha a linha.
    const matches: MatchedImportRecord[] = [];
    for (const record of unique) {
      const byExternalId =
        record.tmdbId === null && record.imdbId === null
          ? []
          : await stores.catalog.findByExternalId(scope, {
              entityType: record.entityType,
              tmdbId: record.tmdbId,
              imdbId: record.imdbId,
            });

      const byTitle =
        byExternalId.length > 0 || record.titleNormalized.length === 0
          ? []
          : await stores.catalog.findByTitle(scope, {
              entityType: record.entityType,
              title: record.title,
              year: record.year,
              limit: TITLE_CANDIDATE_LIMIT,
            });

      matches.push(
        classifyMatch(record, {
          byExternalId: byExternalId.map((c) => ({
            entityType: c.entityType,
            entityId: c.entityId,
            title: c.title,
            year: c.year,
          })),
          byTitle: byTitle.map((c) => ({
            entityType: c.entityType,
            entityId: c.entityId,
            title: c.title,
            year: c.year,
          })),
        }),
      );
    }

    // 6. Estado ATUAL do usuario para as entidades resolvidas — insumo dos
    //    conflitos. So as resolvidas: ler a biblioteca inteira seria inutil.
    const existing = await readExistingStates(stores, scope, authenticated.userId, matches);

    const plan = buildImportPlan({
      source: input.source,
      matches,
      rejected: lidas.rejected,
      duplicateRows: duplicates,
      totalRows: tabela.value.rows.length,
      existing,
    });

    // 7. Persiste o plano e move o job para `preview_ready`.
    const transicao = await stores.imports.transition(scope, {
      id: criado.job.id,
      expectedStatus: "uploaded",
      nextStatus: "preview_ready",
      itemCount: plan.summary.validRows,
      conflictCount: plan.conflicts.length,
      preview: serializePlan(plan),
      conflicts: plan.conflicts.map((c) => ({
        rawRowNumber: c.rawRowNumber,
        kind: c.kind,
        detail: c.detail,
      })),
      now,
    });
    if (transicao.kind !== "updated") {
      return err<ImportPreviewResult>("conflict", "nao foi possivel preparar a importacao.");
    }

    const atualizado = await stores.imports.findById(scope, criado.job.id);
    if (atualizado.kind !== "found") {
      return err<ImportPreviewResult>("not_found", "importacao nao encontrada.");
    }
    return ok({ job: atualizado.job, plan });
  });
}

/** Le o estado atual das entidades resolvidas (watch state + nota). */
async function readExistingStates(
  stores: LibraryStores,
  scope: TransactionScope,
  userId: bigint,
  matches: readonly MatchedImportRecord[],
): Promise<ReadonlyMap<string, ExistingEntityState>> {
  const mapa = new Map<string, ExistingEntityState>();
  for (const match of matches) {
    if (match.resolved === null) continue;
    const chave = existingStateKey(match.resolved.entityType, match.resolved.entityId);
    if (mapa.has(chave)) continue;

    const estado = await stores.watchStates.find(scope, {
      userId,
      entityType: match.resolved.entityType,
      entityId: match.resolved.entityId,
    });
    const nota = await stores.ratings.find(scope, {
      userId,
      entityType: match.resolved.entityType,
      entityId: match.resolved.entityId,
    });

    mapa.set(chave, {
      entityId: match.resolved.entityId,
      status: estado.kind === "found" ? estado.state.status : null,
      watchedAt: estado.kind === "found" ? estado.state.completedAt : null,
      rating: nota.kind === "found" ? nota.rating.value : null,
    });
  }
  return mapa;
}

/** Serializa o plano para a coluna Json (sem `bigint`, que JSON nao carrega). */
function serializePlan(plan: ImportPlan): unknown {
  return {
    summary: plan.summary,
    actions: plan.actions.map((a) => ({
      rawRowNumber: a.rawRowNumber,
      entityType: a.entityType,
      entityId: a.entityId.toString(10),
      targetState: a.targetState,
      watchedAt: a.watchedAt === null ? null : a.watchedAt.toISOString(),
      listName: a.listName,
      rating: a.rating,
    })),
    unmatched: plan.unmatched,
    rejected: plan.rejected,
  };
}

/** Forma das acoes como saem do Json (ids em texto). */
interface StoredAction {
  readonly rawRowNumber: number;
  readonly entityType: "movie" | "tv";
  readonly entityId: string;
  readonly targetState: ImportTargetState;
  readonly watchedAt: string | null;
  readonly listName: string | null;
  readonly rating: number | null;
}

function readStoredActions(preview: unknown): readonly StoredAction[] {
  if (typeof preview !== "object" || preview === null) return [];
  const acoes = (preview as { actions?: unknown }).actions;
  return Array.isArray(acoes) ? (acoes as StoredAction[]) : [];
}

export interface ApplyImportResult {
  readonly appliedCount: number;
  readonly totalActions: number;
  readonly completed: boolean;
}

/**
 * APLICA o plano ja aprovado.
 *
 * Processa em LOTES a partir de `appliedCount` (o cursor de retomada). Cada
 * lote roda na sua transacao: uma falha no meio deixa o cursor onde parou, e a
 * chamada seguinte continua dali — sem rollback gigante e sem duplicar, porque
 * toda escrita e idempotente.
 */
export async function applyImport(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly jobId: bigint },
): Promise<DomainResult<ApplyImportResult>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();

  // 1. CAS `preview_ready -> applying`: elege UM vencedor entre dois apply
  //    concorrentes do mesmo job.
  const inicio = await deps.runInLibraryTransaction(async (scope, stores) => {
    const job = await stores.imports.findById(scope, input.jobId);
    if (job.kind !== "found" || job.job.userId !== authenticated.userId) {
      return err<{ readonly actions: readonly StoredAction[]; readonly cursor: number }>(
        "not_found",
        "importacao nao encontrada.",
      );
    }
    // Retomada: um job ja `applying` (falhou no meio) pode continuar.
    const esperado = job.job.status === "applying" ? "applying" : "preview_ready";
    if (job.job.status !== "preview_ready" && job.job.status !== "applying") {
      return err<{ readonly actions: readonly StoredAction[]; readonly cursor: number }>(
        "precondition_failed",
        "esta importacao nao esta pronta para ser aplicada.",
      );
    }

    const transicao = await stores.imports.transition(scope, {
      id: input.jobId,
      expectedStatus: esperado,
      nextStatus: "applying",
      now,
    });
    if (transicao.kind !== "updated") {
      return err<{ readonly actions: readonly StoredAction[]; readonly cursor: number }>(
        "conflict",
        "esta importacao ja esta sendo aplicada.",
      );
    }
    return ok({ actions: readStoredActions(job.preview), cursor: job.job.appliedCount });
  });

  if (!inicio.ok) {
    return inicio;
  }

  const acoes = inicio.value.actions;
  let cursor = Math.max(0, Math.min(inicio.value.cursor, acoes.length));

  // 2. Lotes. Cada um numa transacao propria e curta.
  while (cursor < acoes.length) {
    const lote = acoes.slice(cursor, cursor + IMPORT_APPLY_BATCH);
    for (const acao of lote) {
      await applyAction(deps, authenticated, acao, input.jobId, now);
    }
    cursor += lote.length;

    await deps.runInLibraryTransaction((scope, stores) =>
      stores.imports.transition(scope, {
        id: input.jobId,
        expectedStatus: "applying",
        nextStatus: "applying",
        appliedCount: cursor,
        now,
      }),
    );
  }

  // 3. Conclui.
  await deps.runInLibraryTransaction((scope, stores) =>
    stores.imports.transition(scope, {
      id: input.jobId,
      expectedStatus: "applying",
      nextStatus: "applied",
      appliedCount: cursor,
      appliedAt: now,
      now,
    }),
  );

  return ok({ appliedCount: cursor, totalActions: acoes.length, completed: true });
}

/**
 * Aplica UMA acao. Toda escrita e idempotente por unique — reexecutar nao
 * duplica.
 */
async function applyAction(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  acao: StoredAction,
  jobId: bigint,
  now: Date,
): Promise<void> {
  const entityId = BigInt(acao.entityId);
  // Chave estavel por (job, linha): reexecutar o mesmo job nao gera evento novo.
  const idempotencyKey = `import-${jobId.toString(10)}-${acao.rawRowNumber}`;

  // NUNCA REBAIXAR NO APPLY. A politica anti-rebaixamento do preview (plan.ts)
  // e calculada contra um SNAPSHOT do estado no momento do preview. Entre o
  // preview e o apply (tempo do usuario, retomada, ou o proprio arquivo listando
  // a mesma entidade em dois estados) esse snapshot fica velho — entao a decisao
  // e RE-DERIVADA aqui, de forma atomica, no proprio banco.
  if (acao.targetState === "watched") {
    // "Assistido" e uma PROMOCAO: setWatchState promove planned/watching ->
    // watched e faz no-op quando ja assistido; nunca rebaixa.
    await setWatchState(deps, authenticated, {
      entityType: acao.entityType,
      entityId,
      status: "watched",
      idempotencyKey,
      expectedVersion: null,
    });
  } else if (acao.targetState === "watchlist") {
    // "Quero assistir" e o sinal MAIS FRACO. Importar nunca deve mudar um estado
    // ja existente: escrita INSERT-ONLY (`expectedVersion: null` => o adapter
    // emite `INSERT ... ON CONFLICT DO NOTHING`). Cria `planned` se nao houver
    // estado; se ja houver QUALQUER estado (watched/watching/...), no-op — jamais
    // rebaixa. Fecha o rebaixamento tanto no TOCTOU quanto no arquivo com a mesma
    // entidade em duas linhas (watched antes de watchlist).
    await deps.runInLibraryTransaction((scope, stores) =>
      stores.watchStates.upsert(scope, {
        userId: authenticated.userId,
        entityType: acao.entityType,
        entityId,
        expectedVersion: null,
        status: "planned",
        startedAt: null,
        completedAt: null,
        rewatchCount: 0,
        nextVersion: 1,
        now,
      }),
    );
  }

  if (acao.rating !== null) {
    // A nota do arquivo NUNCA sobrescreve a nota local: insercao atomica so se
    // ausente (o preview ja anula a nota quando havia uma local; isto fecha a
    // janela TOCTOU em que o usuario avalia entre o preview e o apply).
    await deps.runInLibraryTransaction((scope, stores) =>
      stores.ratings.insertIfAbsent(scope, {
        userId: authenticated.userId,
        entityType: acao.entityType,
        entityId,
        value: acao.rating as number,
        now,
      }),
    );
  }

  // Marca a PROVENIENCIA no diario: `source` carrega a origem da importacao.
  await deps.runInLibraryTransaction((scope, stores) =>
    stores.viewingEvents.append(scope, {
      userId: authenticated.userId,
      entityType: acao.entityType,
      entityId,
      eventType: "import_applied",
      occurredAt: acao.watchedAt === null ? now : new Date(acao.watchedAt),
      source: `import:${jobId.toString(10)}`,
      idempotencyKey,
    }),
  );
}

/**
 * CANCELA a importacao.
 *
 * Antes do apply: descarta o plano. Durante o apply: NAO desfaz o que ja foi
 * aplicado — a arquitetura e incremental e idempotente, e inventar um rollback
 * gigante seria pior do que parar com seguranca. O job vai para `cancelled`
 * com o `appliedCount` que alcancou, e o que entrou na biblioteca continua la
 * (o usuario pode desfazer item a item, como qualquer outro dado dele).
 */
export async function cancelImport(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly jobId: bigint },
): Promise<DomainResult<{ readonly cancelled: true }>> {
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const job = await stores.imports.findById(scope, input.jobId);
    if (job.kind !== "found" || job.job.userId !== authenticated.userId) {
      return err<{ readonly cancelled: true }>("not_found", "importacao nao encontrada.");
    }
    if (job.job.status === "applied" || job.job.status === "cancelled") {
      return err<{ readonly cancelled: true }>(
        "precondition_failed",
        "esta importacao ja foi concluida ou cancelada.",
      );
    }

    const transicao = await stores.imports.transition(scope, {
      id: input.jobId,
      expectedStatus: job.job.status,
      nextStatus: "cancelled",
      // Descarta o plano: nao ha razao para reter as linhas normalizadas de um
      // arquivo que o usuario decidiu nao importar.
      preview: null,
      conflicts: null,
      now,
    });
    if (transicao.kind !== "updated") {
      return err<{ readonly cancelled: true }>("conflict", "nao foi possivel cancelar.");
    }
    return ok({ cancelled: true as const });
  });
}

/** Lista os jobs do titular (tela "minhas importacoes"). */
export async function listImports(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly limit: number; readonly offset: number },
) {
  return deps.runInLibraryTransaction((scope, stores) =>
    stores.imports.listByUser(scope, {
      userId: authenticated.userId,
      limit: Math.min(Math.max(1, input.limit), 50),
      offset: Math.max(0, input.offset),
    }),
  );
}

/** Le UM job, com ownership. */
export async function readImport(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly jobId: bigint },
): Promise<DomainResult<{ readonly job: ImportJobRecord; readonly preview: unknown }>> {
  return deps.runInLibraryTransaction(async (scope, stores) => {
    const job = await stores.imports.findById(scope, input.jobId);
    // Mesma mensagem para "nao existe" e "nao e sua".
    if (job.kind !== "found" || job.job.userId !== authenticated.userId) {
      return err<{ readonly job: ImportJobRecord; readonly preview: unknown }>(
        "not_found",
        "importacao nao encontrada.",
      );
    }
    return ok({ job: job.job, preview: job.preview });
  });
}
