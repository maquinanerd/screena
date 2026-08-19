/**
 * types.ts — Tipos do CLI de revisao/promocao de `watch_availability`. PURO.
 *
 * Este modulo NAO toca rede, banco nem RapidAPI. Ele so descreve a forma de uma
 * oferta candidata a promocao (o subconjunto de colunas que os guardrails
 * inspecionam) e o vocabulario de decisao/recusa.
 *
 * Escopo governado (invariante 6 + termos do provider): a promocao apenas vira o
 * gate `display_allowed` de `false` para `true` em ofertas ja gravadas do
 * fornecedor `streaming_availability`, pais BR. Nunca cria linha, nunca toca
 * outro provider, nunca encosta em ratings/screen_score.
 */

/**
 * Modalidades LEGAIS que podem ser promovidas.
 *
 * ============ A JUSTIFICATIVA ANTERIOR TINHA FICADO FALSA ============
 *
 * Ate 2026-08-19 esta lista era `['subscription','free','rent','buy']`, e a nota
 * ao lado dizia que as quatro eram "as unicas produzidas pela ingestao de
 * streaming". Isso era verdade quando a unica origem era a RapidAPI; **deixou de
 * ser** quando a ingestao TMDB entrou e `WATCH_OFFER_TYPE_BY_TMDB_BUCKET`
 * (services/ingestion) passou a mapear o bucket `ads` do proprio payload.
 *
 * O comentario continuou la, afirmando um fato que nao existia mais — e foi ele
 * que impediu a regra de ser revista: quem lia encontrava uma razao tecnica
 * plausivel e seguia em frente. Um comentario que mente e pior que nenhum.
 *
 * ============ `ads` ENTRA (decisao de Pablo Eduardo, 2026-08-19) ============
 *
 * O argumento e o do leitor: disponibilidade legal e GRATUITA e a informacao
 * mais util que a pagina pode dar. Pluto TV, Mercado Play e NetMovies tinham o
 * titulo de graca e ficavam de fora.
 *
 * `ads` != `free`, e os dois NUNCA colapsam: `free` e gratuito sem
 * contrapartida; `ads` e gratuito COM publicidade. Sao rotulos distintos na tela
 * ("Grátis" vs "Grátis com anúncios" — `apps/web/src/lib/watch-offer-modality.ts`)
 * e entradas distintas em toda a cadeia. Promover os dois nao os iguala.
 *
 * ============ O QUE CONTINUA FORA, E POR QUE ============
 *
 * `cinema` — existe no `enum OfferType` do banco, mas nao e disponibilidade
 * domestica: rotula-lo em "Onde assistir" afirmaria que o leitor assiste em
 * casa. O `watch/providers` do TMDB nunca o emite, e o vocabulario do render
 * tambem o recusa (`resolveWatchModality` devolve `null`).
 *
 * Qualquer valor fora desta lista — inclusive um eventual `addon` — e recusado
 * com `invalid-offer-type`, nunca "aproximado" para a modalidade mais parecida.
 */
export const PROMOTABLE_OFFER_TYPES = ['subscription', 'free', 'ads', 'rent', 'buy'] as const

/** Modalidade promovel derivada. */
export type PromotableOfferType = (typeof PROMOTABLE_OFFER_TYPES)[number]

/** `value` e uma modalidade promovel? */
export function isPromotableOfferType(value: unknown): value is PromotableOfferType {
  return (
    typeof value === 'string' &&
    (PROMOTABLE_OFFER_TYPES as readonly string[]).includes(value)
  )
}

/**
 * Uma oferta candidata: o subconjunto de `watch_availability` que os guardrails
 * e o relatorio precisam. `id`/`entityId` sao BigInt serializados como string
 * (nunca vaza BigInt para o relatorio JSON).
 */
export interface PromotionCandidate {
  readonly id: string
  /** `movie` | `tv` (nunca season/episode/person nesta fase). */
  readonly entityType: string
  readonly entityId: string
  /** Titulo original da entidade, quando facil de obter; senao `null`. */
  readonly title: string | null
  readonly countryCode: string
  readonly providerApi: string | null
  readonly providerKey: string | null
  readonly providerName: string | null
  /**
   * Slug do provedor CANONICO resolvido por `watch_provider_aliases`
   * (`provider_api` + `provider_key`), ou `null` quando nao ha alias.
   *
   * POR QUE ENTROU (2026-08-19). Sem este campo, uma oferta de provedor NAO
   * registrado era avaliada como `elegivel` pelos guardrails e so morria la no
   * fundo, na excecao do trigger — o revisor lia "elegivel" numa linha que o
   * banco jamais aceitaria, e a promocao devolvia uma recusa crua de Postgres
   * em vez de uma instrucao. O elo faltante existia; faltava NOME.
   *
   * Nao e o mesmo que `watch_availability.watch_provider_id`: aquela coluna so
   * e preenchida NO ATO da promocao (pelo UPDATE), entao antes de promover ela
   * e sempre `null` e nao serve para decidir nada.
   */
  readonly canonicalProviderSlug: string | null
  readonly offerType: string | null
  /** Destino NO PROVEDOR. `null` em toda oferta de origem TMDB. */
  readonly deepLink: string | null
  /**
   * Destino no AGREGADOR do pais (`web_url`) — o `link` por pais do payload
   * TMDB, alimentado pelo JustWatch. E o unico destino que a origem TMDB tem, e
   * por isso entra nos guardrails: recusar por `missing-link` uma oferta que TEM
   * destino legitimo seria barrar dado bom por um campo que aquele fornecedor
   * nunca preenche.
   */
  readonly webUrl: string | null
  readonly price: number | null
  readonly currency: string | null
  readonly quality: string | null
  readonly availableUntil: Date | null
  readonly fetchedAt: Date | null
  readonly displayAllowed: boolean
  /** `requires_attribution` da linha (nasce `true` por default no banco). */
  readonly requiresAttribution: boolean
  /** `requires_linkback` da linha (nasce `true` por default no banco). */
  readonly requiresLinkback: boolean
  /** Credito textual JA hidratado na linha; `null` = ainda nao licenciada. */
  readonly attributionText: string | null
  /** Linkback do credito JA hidratado na linha. */
  readonly attributionUrl: string | null
}

/**
 * Motivos de recusa de uma promocao. Espelha exatamente os guardrails exigidos:
 * fornecedor errado, pais errado, ja exibivel, modalidade invalida, provider
 * incompleto, sem link, link inseguro, oferta vencida.
 */
export type PromotionRejectionReason =
  | 'wrong-provider'
  | 'wrong-country'
  | 'already-display-allowed'
  /**
   * A oferta passaria em tudo, e mesmo assim NAO deve ser promovida — ha uma
   * decisao humana registrada retendo aquela origem. Ver `WITHHELD_OFFER_SOURCES`.
   *
   * Este motivo existe porque "elegivel e deliberadamente nao promovido" nao
   * tinha como ser dito. Uma revisao daqui a tres meses mostraria as linhas como
   * ELEGIVEL, e o operador as promoveria sem ter como saber que alguem ja tinha
   * decidido o contrario. Ausencia de acao nao e registro.
   */
  | 'withheld-by-decision'
  | 'invalid-offer-type'
  | 'missing-provider'
  /**
   * A oferta nomeia um provedor, mas `(provider_api, provider_key)` nao tem
   * alias em `watch_provider_aliases` — nao ha provedor CANONICO, logo nao ha
   * licenca nem decisao de uso para ela, e o trigger a recusaria.
   *
   * A acao do operador e especifica e diferente de todas as outras:
   * acrescentar a chave a `WATCH_PROVIDER_REGISTRY` (com evidencia) e rodar
   * `register-watch-providers` + `legal sources apply`. Antes deste motivo, essa
   * oferta aparecia como `elegivel` na revisao e virava uma excecao crua de
   * Postgres na promocao.
   */
  | 'no-canonical-provider'
  | 'missing-link'
  | 'unsafe-link'
  /**
   * A oferta exige credito (`requires_attribution`/`requires_linkback`) e nao o
   * tem hidratado. O trigger do banco ja recusaria — mas com uma EXCECAO, que o
   * laco de promocao engolia num `catch` vazio, e o operador via "0 promovidas"
   * sem motivo. Nomear a recusa aqui transforma um erro mudo numa instrucao:
   * falta rodar `pnpm legal sources apply` para aquele provedor/origem.
   *
   * E o terceiro dos tres negativos independentes que impedem oferta TMDB sem
   * credito de JustWatch de ir ao ar (os outros dois: o gate de escrita e o
   * presenter).
   */
  | 'missing-attribution'
  | 'expired'

/** Motivos de recusa de uma reversao (revoke). */
export type RevocationRejectionReason = 'wrong-provider' | 'already-disallowed'

/** Decisao sobre uma promocao. */
export interface PromotionEvaluation {
  readonly eligible: boolean
  readonly reason: PromotionRejectionReason | null
}

/** Decisao sobre uma reversao. */
export interface RevocationEvaluation {
  readonly eligible: boolean
  readonly reason: RevocationRejectionReason | null
}
