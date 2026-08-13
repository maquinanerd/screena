/**
 * territories.ts — Escopo TERRITORIAL da ingestao de `watch/providers`.
 * Modulo PURO (sem Prisma, sem rede, sem relogio).
 *
 * ============ POR QUE ESTE MODULO EXISTE ============
 *
 * O payload real do TMDB traz **138 paises** por titulo. `watch_availability`
 * .country_code e FK para `countries.code`, e `countries` e uma tabela de
 * REFERENCIA semeada com 13 codigos (`COUNTRY_SEED`). O reprocessamento gravava
 * todo pais que viesse no bloco: a primeira oferta de um pais ausente do
 * dicionario derrubava a transacao inteira daquele pais com `23503`
 * (`watch_availability_country_code_fkey`) — 100 falhas em 100 titulos.
 *
 * A cura NAO e afrouxar a FK (ela existe para recusar codigo de pais inventado)
 * e tambem nao e despejar os 138 codigos no dicionario. E declarar o escopo:
 *
 *  - o render publico le UM territorio (`WATCH_COUNTRY = 'BR'` em
 *    `apps/web/src/server/entity-watch.ts`);
 *  - a exibicao ja e governada por territorio em `data_usage_decisions.territory`,
 *    entao oferta de territorio sem decisao nunca poderia aparecer;
 *  - cada pais e uma transacao propria no `replaceSnapshot`: 138 paises sao 138
 *    round-trips por titulo para linhas que ninguem le.
 *
 * Logo: o dicionario `countries` continua sendo um dicionario (checagem de
 * grafia), e o que entra passa a ser uma decisao EXPLICITA de territorio.
 *
 * ANTI-SILENCIO: o pais recusado por escopo NUNCA some. Ele e contado por
 * codigo (`countriesOutOfScope`) e aparece no relatorio. "Nao ingerimos AD"
 * precisa ser legivel; indistinguivel de "AD nao tinha oferta" nao serve.
 */

/**
 * Territorio ingerido por default: o unico que o render le hoje.
 *
 * Ampliar e uma decisao de dados, nao de codigo: passe `--countries=BR,US` e
 * garanta que os codigos existam em `countries` (o CLI faz esse preflight e
 * recusa ANTES de escrever, em vez de estourar FK no meio do lote).
 */
export const DEFAULT_WATCH_TERRITORIES: readonly string[] = ['BR']

/** ISO 3166-1 alpha-2. Mesmo padrao do normalizador. */
const TERRITORY_PATTERN = /^[A-Za-z]{2}$/

/** Resultado de `parseWatchTerritories`. Erro nomeado, nunca `null` mudo. */
export interface WatchTerritoryParse {
  readonly ok: boolean
  /** Codigos MAIUSCULOS, deduplicados, em ordem de aparicao. */
  readonly territories: readonly string[]
  readonly errors: readonly string[]
}

/**
 * Le a flag `--countries`. Lista vazia e ERRO explicito: "ingerir nenhum
 * territorio" seria um no-op que se parece com sucesso.
 */
export function parseWatchTerritories(raw: string | null): WatchTerritoryParse {
  if (raw === null) {
    return { ok: true, territories: [...DEFAULT_WATCH_TERRITORIES], errors: [] }
  }

  const errors: string[] = []
  const territories: string[] = []
  const seen = new Set<string>()

  for (const piece of raw.split(',')) {
    const trimmed = piece.trim()
    if (trimmed === '') continue
    if (!TERRITORY_PATTERN.test(trimmed)) {
      errors.push(`territorio invalido: ${JSON.stringify(trimmed)} (esperado ISO 3166-1 alpha-2)`)
      continue
    }
    const code = trimmed.toUpperCase()
    if (seen.has(code)) continue
    seen.add(code)
    territories.push(code)
  }

  if (territories.length === 0 && errors.length === 0) {
    errors.push('--countries nao listou nenhum territorio; ingerir zero territorio nao e um modo de operacao')
  }

  return { ok: errors.length === 0, territories, errors }
}

/**
 * Porta de preflight do dicionario. Implementada sobre `countries` no adapter
 * Prisma; existe como porta para que o CLI possa recusar ANTES do primeiro
 * INSERT, em vez de descobrir a ausencia como `23503` no meio do lote.
 */
export interface CountryRegistry {
  /** Codigos pedidos que NAO existem em `countries` (subconjunto da entrada). */
  missing(codes: readonly string[]): Promise<readonly string[]>
}
