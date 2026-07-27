/**
 * dedup.ts — Deduplicacao DETERMINISTICA de itens recebidos. PURO.
 *
 * Regra-mestra (fail-closed): sem evidencia de IDENTIDADE ESTAVEL, dois itens
 * NAO sao fundidos. Preservar dois itens e barato e reversivel; fundir dois
 * fatos distintos corrompe a proveniencia de um artigo publicado e nao tem
 * volta automatica.
 *
 * Por isso NAO existe aqui nenhum sinal semantico (similaridade de texto,
 * embedding, "mesma manchete"). Manchete igual e um sinal notoriamente ruim:
 * "Trailer de X e divulgado" descreve eventos diferentes em anos diferentes.
 * Os unicos sinais que fundem sao os que identificam o MESMO RECURSO:
 *
 *   1. mesma (fonte, id externo)  -> mesmo item, reingerido  => `duplicate`
 *   2. mesma URL canonica normalizada -> mesmo recurso        => `duplicate`
 *   3. mesmo fingerprint de conteudo NA MESMA FONTE           => `duplicate`
 *
 * `related` e um sinal FRACO (mesma entidade + janela temporal) que serve
 * apenas para agrupar para revisao humana: nunca funde e nunca descarta.
 */

/** Veredito espelhando o enum `SourceItemDedupVerdict` do banco. */
export type DedupVerdict = 'unique' | 'duplicate' | 'related' | 'superseded'

/** Sinal que sustentou o veredito (auditavel; vai para o log/metrica). */
export type DedupSignal =
  | 'source_external_id'
  | 'normalized_url'
  | 'content_fingerprint'
  | 'entity_time_window'
  | 'none'

/** Item candidato chegando da fonte. */
export interface IncomingItem {
  readonly sourceId: string
  readonly externalId: string
  readonly normalizedUrl: string | null
  readonly contentFingerprint: string | null
  readonly publishedAtIso: string | null
  /** Entidades canonicas ja resolvidas para o item (movie/tv/person + id). */
  readonly entityKeys?: readonly string[]
}

/** Item ja persistido, candidato a ser o primario. */
export interface ExistingItem {
  readonly id: string
  readonly sourceId: string
  readonly externalId: string
  readonly normalizedUrl: string | null
  readonly contentFingerprint: string | null
  readonly publishedAtIso: string | null
  readonly entityKeys?: readonly string[]
}

export interface DedupDecision {
  readonly verdict: DedupVerdict
  readonly signal: DedupSignal
  /** Id do item primario retido. Sempre `null` para `unique`/`related`. */
  readonly duplicateOfId: string | null
}

/** Janela (horas) dentro da qual dois itens da MESMA entidade sao `related`. */
export const RELATED_WINDOW_HOURS = 48

const MS_PER_HOUR = 3_600_000

function epochMs(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Duas listas de entidades compartilham ao menos uma chave.
 * Listas vazias NAO se cruzam (ausencia nao e evidencia).
 */
function sharesEntity(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined || a.length === 0 || b.length === 0) return false
  const set = new Set(a)
  return b.some((key) => set.has(key))
}

/**
 * Classifica um item recebido contra os candidatos ja persistidos.
 *
 * Ordem de avaliacao = ordem de FORCA da evidencia. O primeiro sinal forte
 * encerra a decisao; nada abaixo dele pode "promover" um `related` a
 * `duplicate`.
 *
 * `null` nunca casa com `null`: um item sem URL normalizada e outro sem URL
 * normalizada nao sao o mesmo recurso — sao dois itens sobre os quais nao
 * sabemos nada. Este e o erro classico que funde catalogos inteiros.
 */
export function classifyIncomingItem(
  incoming: IncomingItem,
  candidates: readonly ExistingItem[],
): DedupDecision {
  // 1. Identidade primaria: mesmo item da mesma fonte, reingerido.
  for (const candidate of candidates) {
    if (candidate.sourceId === incoming.sourceId && candidate.externalId === incoming.externalId) {
      return {
        verdict: 'duplicate',
        signal: 'source_external_id',
        duplicateOfId: candidate.id,
      }
    }
  }

  // 2. Mesmo recurso na web (independe da fonte que o entregou).
  if (incoming.normalizedUrl !== null) {
    for (const candidate of candidates) {
      if (candidate.normalizedUrl !== null && candidate.normalizedUrl === incoming.normalizedUrl) {
        return { verdict: 'duplicate', signal: 'normalized_url', duplicateOfId: candidate.id }
      }
    }
  }

  // 3. Mesmo conteudo NA MESMA FONTE (republicacao com outra URL).
  //    Restrito a mesma fonte de proposito: duas publicacoes distintas com o
  //    mesmo texto sao um fato de sindicacao com DUAS proveniencias legitimas,
  //    nao uma duplicata a descartar.
  if (incoming.contentFingerprint !== null) {
    for (const candidate of candidates) {
      if (
        candidate.sourceId === incoming.sourceId &&
        candidate.contentFingerprint !== null &&
        candidate.contentFingerprint === incoming.contentFingerprint
      ) {
        return { verdict: 'duplicate', signal: 'content_fingerprint', duplicateOfId: candidate.id }
      }
    }
  }

  // 4. Sinal FRACO: mesma entidade dentro da janela. Agrupa para revisao
  //    humana; jamais funde nem descarta (fail-closed).
  const incomingMs = epochMs(incoming.publishedAtIso)
  if (incomingMs !== null) {
    for (const candidate of candidates) {
      const candidateMs = epochMs(candidate.publishedAtIso)
      if (candidateMs === null) continue
      if (!sharesEntity(incoming.entityKeys, candidate.entityKeys)) continue
      if (Math.abs(incomingMs - candidateMs) <= RELATED_WINDOW_HOURS * MS_PER_HOUR) {
        return { verdict: 'related', signal: 'entity_time_window', duplicateOfId: null }
      }
    }
  }

  return { verdict: 'unique', signal: 'none', duplicateOfId: null }
}

/**
 * Um item da fonte foi ATUALIZADO (mesmo `external_id`, conteudo novo)?
 *
 * Distingue "mesmo item atualizado" de "historia nova". A identidade estavel e
 * o `external_id`; o que muda e o fingerprint. Sem fingerprint dos dois lados
 * nao afirmamos mudanca (fail-closed: nao reescreve a toa).
 */
export function isUpdatedSourceItem(
  incoming: Pick<IncomingItem, 'contentFingerprint'>,
  existing: Pick<ExistingItem, 'contentFingerprint'>,
): boolean {
  if (incoming.contentFingerprint === null || existing.contentFingerprint === null) return false
  return incoming.contentFingerprint !== existing.contentFingerprint
}
