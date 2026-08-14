/**
 * ratings-presenter.ts — Monta o painel "Notas da crítica e do público" das
 * paginas de detalhe (filme e serie) a partir do `RatingsPayload` ja governado
 * por `entity-ratings.ts`. PURO: sem rede/DB/IO e sem `Date`.
 *
 * Governanca (invariantes 1, 2, 6):
 *  - IMDb != Rotten Tomatoes. Cada nota fica na ESCALA DA PROPRIA FONTE
 *    (`value`/`best`) e nunca e reescalada, convertida ou somada a outra. Um
 *    8,4/10 do IMDb e um 92/100 do Rotten Tomatoes aparecem lado a lado como
 *    medidas DIFERENTES, jamais como percentuais equivalentes.
 *  - Critica != publico. `scoreType` vira rotulo visivel ("Crítica"/"Público"),
 *    entao Tomatometer e Popcornmeter nunca se confundem na tela.
 *  - `provider_api` != `rating_source`: o credito exibido vem de `attribution`
 *    (a FONTE editorial). O fornecedor tecnico (RapidAPI / Film & Show Ratings)
 *    NUNCA aparece como autor da nota.
 *  - ATRIBUICAO: obrigatoria na PAGINA, nao mais ao lado da nota. Desde
 *    2026-08-13 (decisao do proprietario) o credito de fonte vive no RODAPE
 *    GLOBAL, montado no layout raiz. A licenca das 5 fontes continua exigindo
 *    `requires_attribution` — o que mudou foi o endereco do credito, nunca a
 *    obrigacao. Ver `toPanelItem` para as duas metades que substituiram o gate
 *    antigo, e docs/legal/source-authorization-matrix.md para a matriz.
 *  - SEM logo: `logo_allowed = false` para todas as fontes. O painel exibe o
 *    NOME da fonte em texto, nunca a marca grafica.
 *  - SEM nota propria: este painel nunca agrega, calcula media ou inventa um
 *    "Cinerie Score". Ele so reexibe nota de terceiro, creditada.
 *  - SUFIXO E PROPRIEDADE DA FONTE, nao do numero. Ver `RATING_VALUE_SUFFIX`.
 */

import { RATING_SCALES, type RatingSource } from "@screena/config";
import type { PublicExternalRating, RatingsPayload } from "@screena/public-contracts";

/**
 * Como cada FONTE escreve a propria nota. Isto NAO e formatacao: e o significado
 * da medida, e escrever errado e afirmar um fato falso ao leitor.
 *
 *  - `rotten_tomatoes` -> **"%"**. O Tomatometer e a FRACAO de criticas
 *    positivas ("84% dos criticos aprovaram"), nao uma nota numa regua de 100.
 *    Renderiza-lo como "84/100" transforma uma proporcao em nota — o leitor le
 *    "84 pontos de 100 possiveis", que a fonte nunca disse. O mesmo vale para o
 *    Popcornmeter (publico), que tambem e percentual.
 *  - `metacritic` -> **"/100"**. O Metascore E uma nota numa regua de 100
 *    (media ponderada de criticas), nao uma porcentagem de aprovacao. Os dois
 *    ficam em `RATING_SCALES` com o mesmo denominador 100 e AINDA ASSIM se
 *    escrevem diferente: a escala e a mesma, a MEDIDA nao.
 *  - `imdb` / `filmaffinity` -> "/10"; `letterboxd` -> "/5" (media de votos).
 *
 * O canonico (`paginas/06-movie-detail.html`) ja faz assim: `84<span>%</span>`
 * para o Rotten Tomatoes e `7.9<span>/10</span>` para o IMDb.
 *
 * O mapa e TOTAL sobre `RatingSource` — uma 6a fonte nao compila sem decidir
 * como ela escreve a propria nota.
 */
export const RATING_VALUE_SUFFIX: Readonly<Record<RatingSource, string>> = {
  imdb: "/10",
  rotten_tomatoes: "%",
  metacritic: "/100",
  letterboxd: "/5",
  filmaffinity: "/10",
};

/**
 * Sufixo de uma fonte. Fonte fora do vocabulario canonico cai no denominador
 * CRU da propria linha (`/<best>`) — nunca em "%", que seria afirmar proporcao
 * sobre um dado desconhecido. O valor continua acompanhado da escala, entao o
 * numero nunca fica solto (a regra que o teste `best: 0` protege).
 */
export function ratingValueSuffix(sourceKey: string, best: number): string {
  const known = (RATING_VALUE_SUFFIX as Record<string, string | undefined>)[sourceKey];
  if (known !== undefined) return known;
  return `/${formatRatingNumber(best)}`;
}

/**
 * Ordem de exibicao dos chips na fileira "Avaliacoes". FIXA e declarada: duas
 * replicas do site, ou dois titulos com o mesmo conjunto de fontes, nunca
 * mostram a fileira em ordem diferente.
 *
 * Criterio (nesta ordem): (1) IMDb primeiro — e a unica fonte de PUBLICO do
 * conjunto servido pela OMDb e a mais reconhecida em pt-BR; e a unica com
 * linkback e com contagem de votos, entao ancora a fileira com o chip mais
 * completo. (2) Rotten Tomatoes e (3) Metacritic sao as duas agregadoras de
 * CRITICA, na ordem de reconhecimento de marca no Brasil. (4) Letterboxd e
 * (5) FilmAffinity fecham — nao sao servidas pela OMDb hoje e entram por
 * ultimo quando existirem.
 *
 * Coincide com a ordem do canonico (IMDb a esquerda), que e o unico ponto do
 * mockup em que a ordem foi desenhada.
 */
const RATING_SOURCE_PRIORITY: readonly RatingSource[] = [
  "imdb",
  "rotten_tomatoes",
  "metacritic",
  "letterboxd",
  "filmaffinity",
];

/** Posicao na fileira. Fonte desconhecida vai para o fim (nunca some). */
function sourcePriority(sourceKey: string): number {
  const index = RATING_SOURCE_PRIORITY.indexOf(sourceKey as RatingSource);
  return index === -1 ? RATING_SOURCE_PRIORITY.length : index;
}

/**
 * A escala declarada bate com a escala canonica da fonte?
 *
 * Uma linha `imdb` com `best: 100` renderizaria "8,4/10" a partir de um numero
 * que a fonte mediu em outra regua. O sufixo vem da FONTE e o numero vem da
 * LINHA — se os dois discordam, exibir e mentir com aparencia de precisao.
 * Divergencia => a nota nao vai ao ar (invariante 1).
 */
function scaleMatchesSource(sourceKey: string, best: number): boolean {
  const canonical = (RATING_SCALES as Record<string, number | undefined>)[sourceKey];
  if (canonical === undefined) return true;
  return canonical === best;
}

/** Rotulo pt-BR da natureza da nota. Critica e publico NUNCA se fundem. */
const SCORE_TYPE_LABELS: Readonly<Record<string, string>> = {
  critics: "Crítica",
  audience: "Público",
  editorial: "Editorial",
};

/** Uma nota pronta para render, ja creditada e na escala da propria fonte. */
export interface RatingsPanelItem {
  /** `rating_source` (imdb, rotten_tomatoes, ...) — usado como chave/data-attr. */
  sourceKey: string;
  /** Nome da FONTE editorial, em texto (nunca logo). */
  sourceLabel: string;
  /** Natureza da nota, crua (para data-attr e teste). */
  scoreType: string;
  /** Natureza da nota, legivel ("Crítica"/"Público"/"Editorial"). */
  scoreTypeLabel: string;
  /** Rotulo da metrica como a fonte a chama (ex.: "Tomatometer"). */
  metricLabel: string;
  /** Valor na escala da fonte, em pt-BR (ex.: "8,4"). NUNCA normalizado. */
  valueLabel: string;
  /** Denominador da escala da fonte (ex.: 10, 100, 5). */
  best: number;
  /**
   * Como a FONTE escreve a propria medida: "/10", "/100" ou "%". Existe
   * separado de `scoreLabel` porque o canonico tipografa o sufixo menor que o
   * numero — o render precisa dos dois pedacos, nao da string colada.
   */
  valueSuffix: string;
  /**
   * "8,4/10", "88%" — valor e medida juntos, para nao existir numero solto. O
   * sufixo vem da FONTE (ver `RATING_VALUE_SUFFIX`), nunca do `score_type`.
   */
  scoreLabel: string;
  /** Volume de votos/criticas quando o upstream informa; senao null. */
  countLabel: string | null;
  /**
   * Credito da FONTE (nunca do fornecedor tecnico).
   *
   * NAO e mais renderizado ao lado da nota — desde 2026-08-13 o credito vive no
   * rodape global (ver o cabecalho deste arquivo). Continua VIAJANDO no item de
   * proposito, e nao e campo morto:
   *
   *  - e a proveniencia da linha, usada por auditoria e pelos validadores que
   *    rodam contra Postgres real;
   *  - e o que permite provar, por teste, que a fonte exibida tem credito
   *    correspondente no rodape;
   *  - e o caminho de volta: se um dia o credito voltar para perto do dado,
   *    a informacao ja esta aqui.
   *
   * `text` pode ser `null` porque o presenter deixou de RECUSAR a nota por
   * ausencia de credito adjacente. Quem garante que o credito existe agora e o
   * caminho de ESCRITA (o trigger `external_ratings_display_guard`) mais o
   * rodape — nao este presenter.
   */
  attribution: { text: string | null; url: string | null };
  /**
   * Este chip desenha a divisoria vertical do canonico a sua ESQUERDA?
   *
   * A divisoria e modelada como LIDERANTE (do 2o chip em diante), nao como
   * separador emitido depois de cada chip. E a diferenca entre uma regra que
   * pode errar e uma que nao pode: com divisoria a direita, o ultimo chip
   * precisa de um `if` para nao deixar um risco sobrando na ponta — e esse `if`
   * e exatamente o que quebra quando a fileira passa de 3 para 1 ou para 4
   * fontes. Liderante, "n chips => n-1 divisorias, nunca uma na borda" e
   * consequencia da forma, nao de uma condicao que alguem precisa lembrar.
   */
  leadingDivider: boolean;
}

/** Modelo de exibicao do painel de notas. */
export interface RatingsPanelView {
  items: RatingsPanelItem[];
  /** "Atualizado em DD/MM/AAAA" derivado do `updatedAt` mais recente. */
  updatedAtLabel: string | null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Numero em pt-BR sem `Intl` (deterministico entre runtimes/versoes de ICU).
 * Mantem a precisao que veio da fonte: nao arredonda para "ficar bonito".
 */
export function formatRatingNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value).replace(".", ",");
}

/** Milhar com ponto (pt-BR): 1234 -> "1.234". Puro. */
export function formatRatingCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "";
  const digits = String(Math.trunc(count));
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ".";
  }
  return out;
}

/**
 * Formata "AAAA-MM-DD..." (ISO) em "DD/MM/AAAA". Puro e deterministico (sem
 * `Date`): usa so o prefixo de data. Retorna null para entrada invalida.
 */
export function formatRatingDate(iso: string | null): string | null {
  const value = trimToNull(iso);
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return null;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** ISO mais recente (comparacao lexicografica valida em ISO-8601) ou null. */
function mostRecentIso(values: Array<string | null>): string | null {
  let latest: string | null = null;
  for (const value of values) {
    const normalized = trimToNull(value);
    if (normalized === null) continue;
    if (latest === null || normalized > latest) latest = normalized;
  }
  return latest;
}

/** Projeta uma nota do contrato publico para item de painel, ou `null`. */
function toPanelItem(rating: PublicExternalRating): RatingsPanelItem | null {
  const sourceLabel = trimToNull(rating.sourceLabel);
  const metricLabel = trimToNull(rating.label);
  if (sourceLabel === null || metricLabel === null) return null;

  // Escala invalida tornaria o numero ambiguo ("8,4" de quanto?). Sem escala
  // confiavel, a nota nao e exibida — nunca um numero solto na tela.
  if (!Number.isFinite(rating.value) || !Number.isFinite(rating.best) || rating.best <= 0) {
    return null;
  }

  // Escala da linha divergente da escala canonica da fonte: o sufixo (que vem
  // da fonte) descreveria uma regua diferente da que produziu o numero.
  if (!scaleMatchesSource(rating.sourceKey, rating.best)) return null;

  // ATRIBUICAO: A TRAVA MUDOU DE ENDERECO, NAO FOI REMOVIDA.
  //
  // Ate 2026-08-12 esta funcao devolvia `null` quando faltava `attribution.text`
  // — o credito ficava DENTRO do chip, e a proximidade era a prova de que a
  // licenca estava cumprida.
  //
  // Decisao do proprietario (Pablo Eduardo, 2026-08-13): o credito saiu do corpo
  // e passou a viver no RODAPE GLOBAL. Entao a regra deixou de ser "a nota so
  // aparece se o credito estiver colado nela" e passou a ser "a nota so aparece
  // se o credito estiver na PAGINA" — e o rodape esta em toda pagina, montado no
  // layout raiz.
  //
  // O que substituiu este `if` (as duas metades existem; nenhuma sozinha basta):
  //  1. `services/legal` -> `publicSourceCredits()` -> rodape: TODA fonte
  //     autorizada e nomeada, com o texto verbatim da licenca. O rodape nao
  //     conhece nome de fonte, entao nao pode esquecer nenhuma;
  //  2. `tests/web/footer-credits.test.tsx`: para cada rota que exibe nota,
  //     renderiza chrome + conteudo e prova que o credito da fonte esta no
  //     TEXTO VISIVEL do documento.
  //
  // E o que NAO mudou: o caminho de ESCRITA continua exigindo credito. O trigger
  // `external_ratings_display_guard` recusa `display_allowed = true` sem
  // `attribution_text`, e `entity-ratings.ts` espelha essa recusa ao projetar do
  // banco. A proveniencia continua gravada; o que mudou foi onde ela aparece.
  const attributionText = trimToNull(rating.attribution?.text ?? null);
  const attributionUrl = trimToNull(rating.attribution?.url ?? null);

  const scoreTypeLabel = SCORE_TYPE_LABELS[rating.scoreType];
  // Um `scoreType` desconhecido nao pode virar rotulo inventado: sem saber se e
  // critica ou publico, exibir arriscaria trocar um pelo outro (invariante 1).
  if (scoreTypeLabel === undefined) return null;

  const valueLabel = formatRatingNumber(rating.value);
  const countLabel =
    rating.count === null || !Number.isFinite(rating.count) || rating.count < 0
      ? null
      : formatRatingCount(rating.count);
  const valueSuffix = ratingValueSuffix(rating.sourceKey, rating.best);

  return {
    sourceKey: rating.sourceKey,
    sourceLabel,
    scoreType: rating.scoreType,
    scoreTypeLabel,
    metricLabel,
    valueLabel,
    best: rating.best,
    valueSuffix,
    // Provisorio: so a fileira ORDENADA sabe quem e o primeiro. Definido em
    // `buildRatingsView`, apos o sort.
    leadingDivider: false,
    // Valor e MEDIDA sempre juntos. A medida vem da fonte: o Metascore e
    // "78/100", o Tomatometer e "88%" — e um nunca vira o outro.
    scoreLabel: `${valueLabel}${valueSuffix}`,
    countLabel,
    attribution: { text: attributionText, url: attributionUrl },
  };
}

/**
 * Monta o painel de notas externas.
 *
 * Retorna `null` quando nenhuma nota sobrevive aos gates — a pagina entao NAO
 * renderiza o painel (nunca heading vazio, "sem notas" ou placeholder). Fonte
 * desligada simplesmente deixa de aparecer: a pagina continua inteira.
 */
export function buildRatingsView(payload: RatingsPayload): RatingsPanelView | null {
  const items: RatingsPanelItem[] = [];
  const seen = new Set<string>();
  const updatedAts: Array<string | null> = [];

  for (const rating of payload.ratings) {
    const item = toPanelItem(rating);
    if (item === null) continue;

    // Uma fonte pode legitimamente ter duas metricas (Tomatometer + Popcornmeter):
    // a chave inclui o scoreType para nao colapsar critica com publico.
    const key = `${item.sourceKey}|${item.scoreType}|${item.metricLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push(item);
    updatedAts.push(rating.updatedAt);
  }

  if (items.length === 0) return null;

  // Ordem TOTAL e estavel: prioridade declarada da fonte, depois natureza,
  // depois metrica. Duas replicas do site nunca mostram a mesma pagina em ordem
  // diferente, e a fileira nao se reorganiza quando uma fonte entra ou sai.
  items.sort((a, b) => {
    const bySource = sourcePriority(a.sourceKey) - sourcePriority(b.sourceKey);
    if (bySource !== 0) return bySource;
    // Empate so acontece entre fontes desconhecidas (mesma posicao de fim):
    // desempata pela chave para a ordem continuar total.
    const byKey = a.sourceKey.localeCompare(b.sourceKey);
    if (byKey !== 0) return byKey;
    const byType = a.scoreType.localeCompare(b.scoreType);
    if (byType !== 0) return byType;
    return a.metricLabel.localeCompare(b.metricLabel);
  });

  // Divisoria liderante: todos menos o primeiro. Uma unica expressao decide a
  // fileira inteira, para 1, 2, 3 ou 4 chips.
  const rowed = items.map((item, index) => ({ ...item, leadingDivider: index > 0 }));

  const updatedDate = formatRatingDate(mostRecentIso(updatedAts));
  return {
    items: rowed,
    updatedAtLabel: updatedDate === null ? null : `Atualizado em ${updatedDate}`,
  };
}
