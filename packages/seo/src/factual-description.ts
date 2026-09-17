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
