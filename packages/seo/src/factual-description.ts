/**
 * factual-description.ts — a descricao de quem nao tem sinopse. PURO.
 *
 * O DEFEITO (auditoria de SEO de 11/09/2026, achado M4): a `<meta name=
 * "description">` faltava em 7 de 29 paginas 200 amostradas — 3 de 5 filmes e 2
 * de 2 pessoas. Sem sinopse no idioma publicado a tag nao saia, e o buscador
 * escolhia sozinho um trecho qualquer da pagina para mostrar no resultado.
 *
 * O QUE ISTO NAO E: texto escrito para ganhar palavra. Cada frase e um FATO que a
 * propria pagina ja mostra — ano, genero, direcao, elenco e duracao; funcao,
 * trabalhos e nascimento —, em ordem fixa, sem adjetivo e sem promessa. Fato
 * ausente = frase ausente. Titulo sem nenhum fato alem dele devolve `null`: "A
 * Origem e um filme." nao informa nada que o titulo ja nao diga, e a tag continua
 * omitida.
 *
 * So entra quando a descricao PROPRIA falta: texto editorial sempre vence. O
 * corte em 160 caracteres continua sendo de `buildMetaDescription`, e a ordem das
 * frases e a de importancia — o corte, quando vem, leva a ultima.
 */

const LOCALE = "pt-BR";

const GENRE_LIMIT = 2;
const DIRECTOR_LIMIT = 2;
const CAST_LIMIT = 3;
const KNOWN_FOR_LIMIT = 3;

/** "a" · "a e b" · "a, b e c" — a enumeracao do portugues. */
export function joinWithE(items: readonly string[]): string {
  const list = items.map((item) => item.trim()).filter((item) => item !== "");
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

/**
 * Rotulo de genero DENTRO da frase: "Ficção científica" -> "ficção científica".
 * Baixa so a primeira letra, e so quando a segunda ja e minuscula — "Cinema TV"
 * vira "cinema TV", e uma sigla fica como esta.
 */
function inSentence(label: string): string {
  const text = label.trim();
  if (text.length < 2) return text;
  const second = text.charAt(1);
  const secondIsLowercaseLetter =
    second === second.toLocaleLowerCase(LOCALE) && second !== second.toLocaleUpperCase(LOCALE);
  return secondIsLowercaseLetter ? text.charAt(0).toLocaleLowerCase(LOCALE) + text.slice(1) : text;
}

function firstNonEmpty(values: readonly string[], limit: number): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .slice(0, limit);
}

function textOrEmpty(value: string | null): string {
  return (value ?? "").trim();
}

/** Fecha a frase com ponto, sem dobrar a pontuacao de um titulo que ja termina nela. */
function sentence(text: string): string {
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

function paragraph(sentences: readonly (string | null)[]): string {
  return sentences.filter((part): part is string => part !== null).join(" ");
}

export interface MovieDescriptionFacts {
  readonly title: string;
  readonly year: number | null;
  /** Rotulos pt-BR, na ordem da pagina. */
  readonly genres: readonly string[];
  readonly directors: readonly string[];
  /** Elenco na ordem de credito da pagina. */
  readonly cast: readonly string[];
  /** A duracao como a pagina a escreve ("2h 28min"). */
  readonly runtimeLabel: string | null;
}

export function describeMovieFactually(facts: MovieDescriptionFacts): string | null {
  const title = facts.title.trim();
  const genres = firstNonEmpty(facts.genres, GENRE_LIMIT).map(inSentence);
  const directors = firstNonEmpty(facts.directors, DIRECTOR_LIMIT);
  const cast = firstNonEmpty(facts.cast, CAST_LIMIT);
  const runtime = textOrEmpty(facts.runtimeLabel);
  if (title === "") return null;
  if (genres.length === 0 && directors.length === 0 && cast.length === 0 && runtime === "") {
    return null;
  }

  const lead =
    `${title}${facts.year !== null ? ` (${facts.year})` : ""} é um filme` +
    (genres.length > 0 ? ` de ${joinWithE(genres)}` : "");
  return paragraph([
    sentence(lead),
    directors.length > 0 ? sentence(`Direção: ${joinWithE(directors)}`) : null,
    cast.length > 0 ? sentence(`Elenco: ${joinWithE(cast)}`) : null,
    runtime !== "" ? sentence(`Duração: ${runtime}`) : null,
  ]);
}

export interface SeriesDescriptionFacts {
  readonly title: string;
  /** O periodo como a pagina o escreve ("1988–2020"). */
  readonly periodLabel: string | null;
  readonly genres: readonly string[];
  readonly seasonsCount: number | null;
  readonly cast: readonly string[];
}

export function describeSeriesFactually(facts: SeriesDescriptionFacts): string | null {
  const title = facts.title.trim();
  const period = textOrEmpty(facts.periodLabel);
  const genres = firstNonEmpty(facts.genres, GENRE_LIMIT).map(inSentence);
  const cast = firstNonEmpty(facts.cast, CAST_LIMIT);
  const seasons =
    facts.seasonsCount !== null && Number.isInteger(facts.seasonsCount) && facts.seasonsCount > 0
      ? facts.seasonsCount
      : null;
  if (title === "") return null;
  if (genres.length === 0 && cast.length === 0 && seasons === null) return null;

  const lead =
    `${title}${period !== "" ? ` (${period})` : ""} é uma série` +
    (genres.length > 0 ? ` de ${joinWithE(genres)}` : "") +
    (seasons !== null ? `, com ${seasons} ${seasons === 1 ? "temporada" : "temporadas"}` : "");
  return paragraph([sentence(lead), cast.length > 0 ? sentence(`Elenco: ${joinWithE(cast)}`) : null]);
}

export interface PersonKnownFor {
  readonly title: string;
  readonly year: number | null;
}

export interface PersonDescriptionFacts {
  readonly name: string;
  /** A funcao como a pagina a escreve ("Atuação"). */
  readonly roleLabel: string | null;
  /** Os trabalhos da secao "Conhecido por", na ordem da pagina. */
  readonly knownFor: readonly PersonKnownFor[];
  /** A data como a pagina a escreve ("11 de novembro de 1974"). */
  readonly birthDateLabel: string | null;
  readonly placeOfBirth: string | null;
  readonly deathDateLabel: string | null;
}

export function describePersonFactually(facts: PersonDescriptionFacts): string | null {
  const name = facts.name.trim();
  const role = textOrEmpty(facts.roleLabel);
  const works = facts.knownFor
    .map((work) => ({ title: work.title.trim(), year: work.year }))
    .filter((work) => work.title !== "")
    .slice(0, KNOWN_FOR_LIMIT)
    .map((work) => (work.year !== null ? `${work.title} (${work.year})` : work.title));
  const birth = textOrEmpty(facts.birthDateLabel);
  const place = textOrEmpty(facts.placeOfBirth);
  const death = textOrEmpty(facts.deathDateLabel);
  if (name === "") return null;
  if (role === "" && works.length === 0 && birth === "" && place === "" && death === "") {
    return null;
  }

  // Sem genero gramatical: "Nascido/Nascida" exigiria um dado que a pagina nao
  // mostra, e adivinhar seria afirmar o que ninguem afirmou.
  const origin =
    birth !== ""
      ? sentence(`Nascimento: ${birth}${place !== "" ? `, ${place}` : ""}`)
      : place !== ""
        ? sentence(`Natural de ${place}`)
        : null;
  return paragraph([
    sentence(role !== "" ? `${name} — ${inSentence(role)}` : name),
    works.length > 0 ? sentence(`Trabalhos em destaque: ${joinWithE(works)}`) : null,
    origin,
    death !== "" ? sentence(`Falecimento: ${death}`) : null,
  ]);
}

// ---------------------------------------------------------------------------
// A DESCRICAO COMPOSTA DA FICHA (22/09/2026)
// ---------------------------------------------------------------------------
//
// O DEFEITO. Com sinopse, a descricao da ficha de filme e de serie era a
// SINOPSE DO TMDB cortada em 160 caracteres — a mesma frase que o proprio TMDB e
// todo site que reusa o TMDB mostram no resultado da busca. O snippet da Cinerie
// era indistinguivel dos outros e nao dizia nada que a sinopse ja nao dissesse.
//
// A REGRA. Uma abertura CURTA com fatos que a pagina mostra — tipo, genero, ano,
// direcao, elenco principal —, e depois a sinopse. O titulo NAO entra: ele ja
// esta na aba e na linha azul do resultado. Descricao editorial propria vence
// sempre, intocada. Quem corta em 160 continua sendo `buildMetaDescription`.

/**
 * Teto da ABERTURA factual. O resto dos 160 caracteres fica para a sinopse:
 * com 90, sobram ~70 para o gancho do texto — o bastante para o leitor saber de
 * que trata a obra.
 */
export const DESCRIPTION_LEAD_MAX = 90;

/**
 * Monta a abertura: a base e, em ordem de importancia, um trecho de cada grupo —
 * o primeiro trecho do grupo que ainda couber no teto (o grupo de elenco oferece
 * "A e B" e, na falta de espaco, so "A"). Um grupo que nao cabe e pulado, e a
 * abertura fecha com ponto.
 */
function leadWithin(base: string, groups: ReadonlyArray<readonly string[]>): string {
  let lead = base;
  for (const alternatives of groups) {
    const fits = alternatives.find(
      (extra) => extra !== "" && `${lead}${extra}.`.length <= DESCRIPTION_LEAD_MAX,
    );
    if (fits !== undefined) lead += fits;
  }
  return sentence(lead);
}

/** Alternativas do grupo de elenco: os dois primeiros e, se nao couber, so o primeiro. */
function castGroup(cast: readonly string[]): string[] {
  if (cast.length === 0) return [];
  const first = cast[0] ?? "";
  return cast.length > 1 ? [`, com ${joinWithE(cast.slice(0, 2))}`, `, com ${first}`] : [`, com ${first}`];
}

export interface MovieLeadFacts {
  readonly year: number | null;
  /** Rotulos pt-BR, na ordem da pagina. So o primeiro entra. */
  readonly genres: readonly string[];
  readonly directors: readonly string[];
  /** Elenco na ordem de credito da pagina. */
  readonly cast: readonly string[];
}

/**
 * "Filme de ficção científica (2010), dirigido por Christopher Nolan, com
 * Leonardo DiCaprio e Elliot Page." — ou o que couber em
 * `DESCRIPTION_LEAD_MAX`. Sem nenhum fato devolve `null`.
 */
export function movieDescriptionLead(facts: MovieLeadFacts): string | null {
  const genre = firstNonEmpty(facts.genres, 1).map(inSentence)[0];
  const director = firstNonEmpty(facts.directors, 1)[0];
  const cast = firstNonEmpty(facts.cast, 2);
  if (genre === undefined && facts.year === null && director === undefined && cast.length === 0) {
    return null;
  }
  const base = `Filme${genre !== undefined ? ` de ${genre}` : ""}${facts.year !== null ? ` (${facts.year})` : ""}`;
  return leadWithin(base, [
    director !== undefined ? [`, dirigido por ${director}`] : [],
    castGroup(cast),
  ]);
}

export interface SeriesLeadFacts {
  /** O periodo como a pagina o escreve ("2008–2013"). */
  readonly periodLabel: string | null;
  readonly genres: readonly string[];
  readonly seasonsCount: number | null;
  readonly cast: readonly string[];
}

/**
 * "Série de drama (2008–2013) em 5 temporadas, com Bryan Cranston e Aaron
 * Paul." — ou o que couber em `DESCRIPTION_LEAD_MAX`. Sem nenhum fato devolve
 * `null`.
 */
export function seriesDescriptionLead(facts: SeriesLeadFacts): string | null {
  const genre = firstNonEmpty(facts.genres, 1).map(inSentence)[0];
  const period = textOrEmpty(facts.periodLabel);
  const cast = firstNonEmpty(facts.cast, 2);
  const seasons =
    facts.seasonsCount !== null && Number.isInteger(facts.seasonsCount) && facts.seasonsCount > 0
      ? facts.seasonsCount
      : null;
  if (genre === undefined && period === "" && seasons === null && cast.length === 0) return null;
  const base = `Série${genre !== undefined ? ` de ${genre}` : ""}${period !== "" ? ` (${period})` : ""}`;
  return leadWithin(base, [
    seasons !== null ? [` em ${seasons} ${seasons === 1 ? "temporada" : "temporadas"}`] : [],
    castGroup(cast),
  ]);
}

export interface CatalogDescriptionSource {
  /** Descricao EDITORIAL propria (`entity_translations.meta_description`). */
  readonly editorial: string | null;
  /** A abertura factual (`movieDescriptionLead` / `seriesDescriptionLead`). */
  readonly lead: string | null;
  /** A sinopse do locale publicado. */
  readonly synopsis: string | null;
}

/**
 * O TEXTO de origem da descricao da ficha, para `buildMetaDescription` cortar.
 *
 *  1. descricao editorial propria: vence, como esta;
 *  2. abertura + sinopse;
 *  3. so a sinopse, quando nao ha fato para a abertura;
 *  4. sem editorial e sem sinopse: `null` — a pagina cai na descricao factual
 *     completa (`describeMovieFactually` / `describeSeriesFactually`), que tem o
 *     titulo e mais fatos, porque nao divide espaco com texto nenhum.
 */
export function composeCatalogDescriptionSource(source: CatalogDescriptionSource): string | null {
  const editorial = textOrEmpty(source.editorial);
  if (editorial !== "") return editorial;
  const synopsis = textOrEmpty(source.synopsis);
  if (synopsis === "") return null;
  const lead = textOrEmpty(source.lead);
  return lead !== "" ? `${lead} ${synopsis}` : synopsis;
}

/**
 * A temporada que entra no indice SEM sinopse propria.
 *
 * MEDIDO em producao em 22/09/2026, logo apos o portao de conteudo por dado
 * (`evaluateSeasonQualityGate`) trazer 11.008 temporadas ao indice: numa amostra
 * de 25, **13 responderam sem `<meta name="description">` nenhuma** — enquanto
 * 25 de 25 episodios tinham a sua. Nao e acaso: o portao admite a temporada por
 * DOIS caminhos, sinopse propria OU um guia de tres episodios com sinopse, e o
 * segundo caminho nao passa por texto proprio nenhum. `buildMetaDescription(null)`
 * devolve `null`, e a tag some.
 *
 * Os fatos abaixo sao os que a PROPRIA pagina mostra: o nome da serie, o numero
 * e o titulo da temporada, o ano de estreia e a contagem de episodios. Nenhum e
 * inferido, e fato ausente vira frase ausente.
 */
export interface SeasonDescriptionFacts {
  readonly seriesTitle: string;
  readonly seasonNumber: number;
  /**
   * O titulo PROPRIO da temporada, quando ela tem um ("Livro 3: Mudança").
   * `Temporada 3` nao conta: repetir o numero que a frase ja diz nao informa.
   */
  readonly seasonTitle: string | null;
  readonly airYear: number | null;
  readonly episodeCount: number | null;
}

export function describeSeasonFactually(facts: SeasonDescriptionFacts): string | null {
  const series = facts.seriesTitle.trim();
  if (series === "") return null;
  if (!Number.isInteger(facts.seasonNumber) || facts.seasonNumber < 1) return null;

  const year =
    facts.airYear !== null && Number.isInteger(facts.airYear) && facts.airYear > 0
      ? facts.airYear
      : null;
  const episodes =
    facts.episodeCount !== null &&
    Number.isInteger(facts.episodeCount) &&
    facts.episodeCount > 0
      ? facts.episodeCount
      : null;

  // So o numero da temporada e o nome da serie ja estao no titulo da pagina e no
  // H1: sem ano e sem contagem, a frase nao acrescenta nada e a tag fica de fora.
  if (year === null && episodes === null) return null;

  const ownTitle = textOrEmpty(facts.seasonTitle);
  const named =
    ownTitle !== "" && ownTitle !== `Temporada ${facts.seasonNumber}` ? ownTitle : null;

  const lead =
    `${facts.seasonNumber}ª temporada de ${series}` +
    (named !== null ? `, ${named}` : "") +
    (episodes !== null ? `, com ${episodes} ${episodes === 1 ? "episódio" : "episódios"}` : "") +
    (year !== null ? `, estreou em ${year}` : "");
  return paragraph([sentence(lead)]);
}
