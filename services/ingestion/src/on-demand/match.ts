/**
 * match.ts — O CRITERIO DE CONFIANCA da cobertura sob demanda (PURO).
 *
 * O PROBLEMA. `hydration.ts` ja sabe hidratar um `tmdbId`. Mas o leitor nao
 * digita id: ele digita "Superman 2025". Falta o tradutor TERMO -> `tmdbId`, e e
 * nele que mora o risco do T4 — porque aqui, ao contrario da busca do site,
 * NINGUEM escolhe da lista. O que sair daqui vira PAGINA PUBLICADA.
 *
 * A REGRA E A MESMA DE `apps/web/src/lib/entity-resolve.ts`, e pelo mesmo
 * motivo, dito la textualmente: **um `null` e inofensivo; um id errado e uma
 * mentira publicada.** Aquele modulo resolve nome -> id INTERNO contra o
 * catalogo; este resolve termo -> `tmdbId` contra o resultado do TMDB. Domínios
 * diferentes, disciplina identica — e por isso o vocabulario de confianca e
 * deliberadamente o mesmo, em vez de um segundo criterio paralelo que
 * divergiria no primeiro conserto.
 *
 * NAO HA FUZZY, NAO HA PREFIXO, NAO HA "MAIS POPULAR". Escolher o mais popular
 * entre dois homonimos e exatamente o defeito do "Chris Evans errado": o
 * resultado tem cara de certo e esta errado, e ninguem e avisado. Empate
 * derruba para recusa.
 *
 * O QUE ESTE MODULO NAO FAZ: nao chama o TMDB. Ele recebe os candidatos JA
 * buscados e devolve o veredito. A busca vive no worker (invariante 3: zero API
 * externa no render).
 */

import { foldText } from '../search/fold.js'

/** Tipos que a cobertura sob demanda cria pagina para. */
export const MATCHABLE_KINDS = ['movie', 'tv'] as const

/** Um tipo casavel. */
export type MatchableKind = (typeof MATCHABLE_KINDS)[number]

/**
 * COMO o casamento aconteceu. Espelha `MATCHED_BY` de `entity-resolve.ts`.
 *
 *  - `exact_title_year` (0.9) — o termo trouxe ano, e titulo + ano + tipo batem
 *    exatamente num UNICO candidato. O sinal mais forte disponivel a partir de
 *    texto: o ano e o que separa os remakes;
 *  - `exact_title_unique` (0.8) — o termo nao trouxe ano; o titulo dobrado bate
 *    exatamente e em UM SO candidato do conjunto. Mais fraco que o anterior
 *    porque um homonimo que o TMDB nao devolveu nesta pagina o derrubaria — e e
 *    por isso que ele exige unicidade, e nao "o primeiro".
 */
export const ON_DEMAND_MATCHED_BY = ['exact_title_year', 'exact_title_unique'] as const

/** Uma forma de casamento. */
export type OnDemandMatchedBy = (typeof ON_DEMAND_MATCHED_BY)[number]

/** Confianca por forma de casamento. Declarada, nunca calculada no chamador. */
export const ON_DEMAND_CONFIDENCE: Readonly<Record<OnDemandMatchedBy, number>> = Object.freeze({
  exact_title_year: 0.9,
  exact_title_unique: 0.8,
})

/**
 * Piso de confianca para CRIAR PAGINA.
 *
 * 0.8 admite as duas formas acima e exclui qualquer coisa abaixo delas. O numero
 * esta aqui, e nao espalhado em `if`s, porque ele e uma POLITICA editorial:
 * mexer nele muda o que o site publica sozinho, e isso tem de ser uma linha
 * revisavel num diff.
 */
export const ON_DEMAND_MIN_CONFIDENCE = 0.8

/** Por que NAO casou. Todo veredito sem id carrega um destes. */
export type OnDemandRefusal =
  /** Termo vazio ou curto demais para significar alguma coisa. */
  | 'no_input'
  /** O TMDB nao devolveu candidato nenhum. */
  | 'not_found'
  /** Nenhum candidato bate EXATAMENTE com o termo (so aproximacoes). */
  | 'no_exact_match'
  /** Dois ou mais candidatos batem igualmente bem. NUNCA desempata por popularidade. */
  | 'ambiguous_title'
  /** Casou, mas o titulo nao merece pagina (ver `eligibility.ts`). */
  | 'not_eligible'

/** Um candidato devolvido pela busca do TMDB. */
export interface OnDemandCandidate {
  readonly kind: MatchableKind
  readonly tmdbId: number
  /** Titulo como o TMDB devolveu (nao dobrado). */
  readonly title: string
  /** Ano de lancamento; `null` quando o TMDB nao tem data (titulo anunciado). */
  readonly year: number | null
  /** Titulos alternativos conhecidos, quando o chamador os tiver. */
  readonly alternativeTitles?: readonly string[]
}

/** Veredito do casamento. Sempre explicito — nunca um `null` mudo. */
export type OnDemandMatch =
  | {
      readonly matched: true
      readonly kind: MatchableKind
      readonly tmdbId: number
      readonly matchedBy: OnDemandMatchedBy
      readonly confidence: number
      /** Frase estavel para log. */
      readonly detail: string
    }
  | {
      readonly matched: false
      readonly refusal: OnDemandRefusal
      /** Quantos candidatos empataram (>1 explica `ambiguous_title`). */
      readonly tiedCount: number
      readonly detail: string
    }

/** Termo menor que isto nao e busca, e digitacao. */
const MIN_TERM_LENGTH = 2

/**
 * Ano no fim do termo: "Superman 2025", "Duna 2021".
 *
 * So no FIM, e so 4 digitos numa faixa plausivel. "2001: Uma Odisseia no
 * Espaco" nao pode perder o "2001" para o extrator — por isso a ancora `$` e a
 * exigencia de um separador antes.
 */
const TRAILING_YEAR = /^(.*\S)\s+(\d{4})$/

/** Faixa de ano aceita. Igual a de `entity-resolve.ts`. */
const MIN_YEAR = 1870
const MAX_YEAR = 2200

/** Termo do leitor, separado em titulo e (talvez) ano. */
export interface ParsedTerm {
  readonly title: string
  readonly year: number | null
}

/**
 * Separa um ano final do termo, quando houver.
 *
 * Devolve o termo inteiro como titulo quando nao ha ano plausivel no fim —
 * inclusive quando os 4 digitos finais estao fora da faixa, caso em que eles
 * provavelmente fazem parte do proprio titulo.
 */
export function parseTerm(raw: string): ParsedTerm {
  const trimmed = raw.trim()
  const hit = TRAILING_YEAR.exec(trimmed)
  if (hit === null) return { title: trimmed, year: null }
  const year = Number(hit[2])
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return { title: trimmed, year: null }
  }
  return { title: hit[1] as string, year }
}

/** Todos os textos pelos quais um candidato pode ser chamado, ja dobrados. */
function foldedNames(candidate: OnDemandCandidate): readonly string[] {
  const names = [candidate.title, ...(candidate.alternativeTitles ?? [])]
  return names.map(foldText).filter((name) => name.length > 0)
}

function refuse(refusal: OnDemandRefusal, detail: string, tiedCount = 0): OnDemandMatch {
  return { matched: false, refusal, tiedCount, detail }
}

/**
 * Casa um termo de busca contra os candidatos do TMDB.
 *
 * Ordem: exige EXATIDAO, depois exige UNICIDADE. Nunca o contrario — pegar "o
 * unico que mais se parece" e adivinhar com passos extras.
 *
 * `kind` opcional restringe o conjunto (ex.: a rota so quer filme). Ausente,
 * filmes e series concorrem no mesmo conjunto, e um filme e uma serie de mesmo
 * nome e ano sao AMBIGUOS — corretamente, porque sao obras diferentes.
 */
export function matchOnDemand(
  rawTerm: string,
  candidates: readonly OnDemandCandidate[],
  kind?: MatchableKind,
): OnDemandMatch {
  const { title, year } = parseTerm(rawTerm)
  const foldedTerm = foldText(title)

  if (foldedTerm.length < MIN_TERM_LENGTH) {
    return refuse('no_input', `termo curto demais: "${rawTerm}"`)
  }

  const pool = kind === undefined ? candidates : candidates.filter((c) => c.kind === kind)
  if (pool.length === 0) {
    return refuse('not_found', `o upstream nao devolveu candidato para "${rawTerm}"`)
  }

  const exact = pool.filter((c) => foldedNames(c).includes(foldedTerm))
  if (exact.length === 0) {
    return refuse(
      'no_exact_match',
      `nenhum dos ${pool.length} candidatos bate exatamente com "${title}"`,
    )
  }

  // Com ano no termo, o ano e uma TRAVA, nao um desempate: candidato de outro
  // ano sai do conjunto em vez de perder pontos.
  if (year !== null) {
    const byYear = exact.filter((c) => c.year === year)
    if (byYear.length === 0) {
      return refuse(
        'no_exact_match',
        `"${title}" existe, mas nenhum candidato e de ${year}`,
      )
    }
    if (byYear.length > 1) {
      return refuse(
        'ambiguous_title',
        `${byYear.length} obras com titulo "${title}" em ${year}: recusado sem desempate`,
        byYear.length,
      )
    }
    const only = byYear[0] as OnDemandCandidate
    return {
      matched: true,
      kind: only.kind,
      tmdbId: only.tmdbId,
      matchedBy: 'exact_title_year',
      confidence: ON_DEMAND_CONFIDENCE.exact_title_year,
      detail: `"${title}" (${year}) casou por titulo+ano em ${only.kind}#${only.tmdbId}`,
    }
  }

  if (exact.length > 1) {
    // O caso "Chris Evans": varios batem, e escolher o mais popular publicaria
    // a obra errada com cara de certo.
    return refuse(
      'ambiguous_title',
      `${exact.length} obras com titulo exato "${title}" e sem ano no termo: recusado sem desempate`,
      exact.length,
    )
  }

  const only = exact[0] as OnDemandCandidate
  return {
    matched: true,
    kind: only.kind,
    tmdbId: only.tmdbId,
    matchedBy: 'exact_title_unique',
    confidence: ON_DEMAND_CONFIDENCE.exact_title_unique,
    detail: `"${title}" casou por titulo exato e unico em ${only.kind}#${only.tmdbId}`,
  }
}

/** O veredito autoriza criar pagina? Confronta a confianca com o piso. */
export function isConfident(match: OnDemandMatch): boolean {
  return match.matched && match.confidence >= ON_DEMAND_MIN_CONFIDENCE
}
