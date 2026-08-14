/**
 * eligibility.ts — O CORTE EDITORIAL da cobertura sob demanda (PURO).
 *
 * A REGRA, decidida pelo dono: so nasce pagina para o titulo que tem
 * **poster + titulo + sinopse**. Sem os tres, a busca diz honestamente que nao
 * encontrou.
 *
 * O MOTIVO: nao encher o catalogo e o Google de paginas magras. Uma pagina com
 * um nome e nada mais nao serve ao leitor e machuca o site inteiro.
 *
 * O DESCARTE NUNCA E SILENCIOSO. Este e o pior lugar possivel para um descarte
 * mudo: e o leitor pedindo EXPLICITAMENTE um titulo e o sistema jogando fora.
 * Por isso `EligibilityVerdict` sempre carrega os campos que faltaram, para o
 * log — com o id do TMDB. O leitor nao precisa saber da regra interna; o
 * operador precisa saber qual campo derrubou qual id.
 *
 * ================== O QUE A MEDICAO MOSTROU, E O QUE ELA NAO DECIDE =========
 * Medido em 2026-08-14 sobre o export real (125 filmes, amostra estratificada
 * por rank de popularidade), consultando o TMDB em `pt-BR`:
 *
 *   faixa        passa no corte   falta poster   falta sinopse (pt-BR)
 *   top 1–1k          88%              0%                12%
 *   1k–10k            76%              0%                24%
 *   10k–50k           32%             12%                68%
 *   50k–200k          16%             12%                84%
 *   200k+              8%             36%                92%
 *
 * O campo que derruba quase tudo NAO e o poster — e a SINOPSE. E ha uma
 * armadilha: o TMDB devolve `overview` VAZIO quando nao ha traducao no idioma
 * pedido, ainda que exista texto em ingles. Medindo o mesmo conjunto contra as
 * traducoes:
 *
 *   faixa        sinopse pt-BR   sinopse en-US   so tem en-US
 *   top 1–1k          88%            100%            12%
 *   1k–10k            76%             92%            20%
 *   10k–50k           32%            100%            68%
 *   50k–200k          16%             92%            76%
 *   200k+              8%             80%            72%
 *
 * Ou seja: no meio da distribuicao, ~70% das recusas por "sem sinopse" sao de
 * titulos que TEM sinopse — so nao em portugues. Este modulo NAO resolve isso
 * sozinho, e deliberadamente nao inventa um fallback para ingles: a prioridade
 * de locale do site e `['pt-BR', 'pt']` (ver `public-payloads/locale-priority.ts`)
 * e ingles NAO esta nela. Trocar isso e decisao editorial do dono, nao efeito
 * colateral de um corte de elegibilidade.
 *
 * `MISSING_TRANSLATION_ONLY` existe para que essa distincao seja VISIVEL no
 * dado: um titulo sem sinopse nenhuma e um titulo sem sinopse em portugues sao
 * recusados hoje, mas por motivos diferentes — e so o segundo vira elegivel se
 * o dono mudar a politica de idioma.
 */

/** Campos que o corte editorial exige. */
export const REQUIRED_FIELDS = ['poster', 'title', 'overview'] as const

/** Um campo exigido. */
export type RequiredField = (typeof REQUIRED_FIELDS)[number]

/** Fatos do titulo, ja lidos do detalhe do TMDB. */
export interface EligibilityInput {
  readonly kind: 'movie' | 'tv'
  readonly tmdbId: number
  /** `poster_path` cru do TMDB. */
  readonly posterPath: string | null | undefined
  /** Titulo no locale pedido. */
  readonly title: string | null | undefined
  /** `overview` no locale pedido (vazio quando nao ha traducao). */
  readonly overview: string | null | undefined
  /**
   * Existe sinopse em ALGUM idioma? Separa "sem sinopse" de "sem traducao".
   * `undefined` quando o chamador nao consultou traducoes — nesse caso o
   * veredito nao distingue os dois, e diz isso.
   */
  readonly hasOverviewInAnyLocale?: boolean
  /** Data de lancamento; `null` para anunciado sem data. */
  readonly releaseDate?: string | null
}

/** Por que o titulo NAO merece pagina. */
export type IneligibleReason =
  /** Falta pelo menos um dos tres campos exigidos. */
  | 'missing_required_fields'
  /**
   * So falta a TRADUCAO: existe sinopse em outro idioma. Recusado hoje pela
   * politica de locale vigente, e o primeiro candidato a mudar se ela mudar.
   */
  | 'missing_translation_only'

/** Veredito do corte. Sempre com os campos que faltaram — nunca um `false` mudo. */
export type EligibilityVerdict =
  | { readonly eligible: true; readonly detail: string }
  | {
      readonly eligible: false
      readonly reason: IneligibleReason
      /** Campos ausentes, para o log. Nunca vazio quando `eligible` e false. */
      readonly missing: readonly RequiredField[]
      readonly detail: string
    }

/** Texto util: vazio, so-espaco e ausente sao todos "falta". */
function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Aplica o corte editorial.
 *
 * Ordem: junta TODOS os campos ausentes antes de decidir. Recusar no primeiro
 * que faltar economizaria trabalho e esconderia os outros — e o log existe
 * exatamente para dizer o que falta, no plural.
 */
export function checkEligibility(input: EligibilityInput): EligibilityVerdict {
  const missing: RequiredField[] = []
  if (!present(input.posterPath)) missing.push('poster')
  if (!present(input.title)) missing.push('title')
  if (!present(input.overview)) missing.push('overview')

  if (missing.length === 0) {
    return {
      eligible: true,
      detail: `${input.kind}#${input.tmdbId} passa no corte editorial`,
    }
  }

  // So a sinopse falta, E existe em outro idioma: e falta de TRADUCAO, nao de
  // dado. Nomear isso e o que permite promover esses titulos de uma vez se a
  // politica de idioma mudar.
  const onlyOverview = missing.length === 1 && missing[0] === 'overview'
  if (onlyOverview && input.hasOverviewInAnyLocale === true) {
    return {
      eligible: false,
      reason: 'missing_translation_only',
      missing,
      detail:
        `${input.kind}#${input.tmdbId} tem sinopse em outro idioma, mas nao no locale ` +
        `publicado; recusado pela politica de locale vigente`,
    }
  }

  return {
    eligible: false,
    reason: 'missing_required_fields',
    missing,
    detail: `${input.kind}#${input.tmdbId} recusado: falta ${missing.join(', ')}`,
  }
}

/**
 * O titulo e um ANUNCIADO ainda sem ficha? (sem poster e sem sinopse)
 *
 * Nao e um veredito de elegibilidade — e uma CLASSIFICACAO, usada para decidir
 * se o id entra na fila de vigilancia (`watchlist`) em vez de ser esquecido.
 * Um titulo recusado hoje nao pode ficar recusado para sempre so porque
 * ninguem voltou a olhar.
 */
export function looksAnnouncedOnly(input: EligibilityInput): boolean {
  return !present(input.posterPath) && !present(input.overview) && present(input.title)
}
