/**
 * author-presenter.ts — quem assina as materias, e a pagina de cada assinatura. PURO.
 *
 * AUDITORIA DE SEO (11/09/2026, secao 3.6): nao existia pagina de autor. A
 * assinatura das materias ("por Pablo Gameleira") era texto simples, e por isso o
 * `NewsArticle` saia sem `author.url` — omissao correta enquanto nao houvesse
 * para onde apontar.
 *
 * ============================================================================
 * O QUE UMA PAGINA DE AUTOR SABE — E SO ISSO
 * ============================================================================
 * De quem escreve, o banco publico guarda uma coisa: `articles.author_name`. Nao
 * ha biografia, foto, cargo nem credencial. A pagina mostra o nome que assina e
 * as materias no ar com essa assinatura, e nada alem — inventar qualquer uma das
 * outras coisas seria fabricar autoridade.
 *
 * As materias sao as MESMAS da listagem (`buildPublishableNewsCards`): o mesmo
 * gate de publicacao, licenca e atribuicao. Um autor so tem pagina enquanto
 * tiver ao menos uma materia no ar — e toda materia no ar esta na pagina do seu
 * autor, entao o link da assinatura nunca leva a 404.
 *
 * ============================================================================
 * O SLUG
 * ============================================================================
 * Sai do nome: sem acento, minusculo, o que nao e letra ou digito vira hifen.
 * Duas grafias que dao o mesmo slug ("Ana Souza", "ana  souza") sao a mesma
 * pagina, e o nome exibido e o da materia mais recente. Nome sem letra ou digito
 * latino nao rende slug — e entao nao ha link, em vez de um link para lugar
 * nenhum.
 */

import type { NewsCardView } from "./news-presenter";
import { authorPath } from "./routes";

/** Marcas combinantes, escritas ESCAPADAS (mesma decisao de `group-label-rule.ts`). */
const COMBINING_MARKS = /[̀-ͯ]/gu;

/** O slug da pagina de autor de uma assinatura, ou `null` quando o nome nao rende um. */
export function authorSlug(name: string | null): string | null {
  if (name === null) return null;
  const slug = name
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? null : slug;
}

/** O caminho da pagina de autor de uma assinatura, ou `null`. */
export function authorHrefOf(name: string | null): string | null {
  const slug = authorSlug(name);
  return slug === null ? null : authorPath(slug);
}

export interface AuthorProfileView {
  readonly slug: string;
  /** O nome como assina a materia mais recente. */
  readonly name: string;
  readonly href: string;
  readonly articleCount: number;
  /** Data da materia mais recente, ou `null` quando nenhuma tem data. */
  readonly latestDateIso: string | null;
  readonly latestDateLabel: string | null;
  /** Da mais recente para a mais antiga — a ordem em que as materias chegam. */
  readonly articles: readonly NewsCardView[];
}

/**
 * Agrupa as materias publicaveis por assinatura.
 *
 * `cards` chega ordenado (data desc, depois titulo) por
 * `buildPublishableNewsCards`, e cada autor herda essa ordem. Os autores saem pela
 * materia mais recente, e o empate pelo nome — comparacao de codigo, nao
 * `localeCompare`: este modulo e puro e deterministico, e ICU varia de runtime.
 */
export function buildAuthorDirectory(cards: readonly NewsCardView[]): AuthorProfileView[] {
  const groups = new Map<string, { name: string; articles: NewsCardView[] }>();
  for (const card of cards) {
    if (card.author === null) continue;
    const slug = authorSlug(card.author);
    if (slug === null) continue;
    const group = groups.get(slug);
    if (group === undefined) groups.set(slug, { name: card.author, articles: [card] });
    else group.articles.push(card);
  }

  const directory: AuthorProfileView[] = [];
  for (const [slug, group] of groups) {
    const latest = group.articles.find((article) => article.dateIso !== null) ?? null;
    directory.push({
      slug,
      name: group.name,
      href: authorPath(slug),
      articleCount: group.articles.length,
      latestDateIso: latest?.dateIso ?? null,
      latestDateLabel: latest?.dateLabel ?? null,
      articles: group.articles,
    });
  }

  directory.sort((a, b) => {
    const ad = a.latestDateIso ?? "";
    const bd = b.latestDateIso ?? "";
    if (ad !== bd) return ad < bd ? 1 : -1;
    if (a.name === b.name) return 0;
    return a.name < b.name ? -1 : 1;
  });
  return directory;
}

/** A pagina de UM autor, pelo slug da URL. So o slug canonico casa. */
export function findAuthorProfile(
  directory: readonly AuthorProfileView[],
  slug: string,
): AuthorProfileView | null {
  return directory.find((author) => author.slug === slug) ?? null;
}

/** "1 matéria" / "3 matérias". */
export function articleCountLabel(count: number): string {
  return count === 1 ? "1 matéria" : `${count} matérias`;
}

/**
 * A frase de abertura da pagina de autor, que tambem e a base da meta description.
 * So fatos que a pagina mostra: quantas materias e a data da mais recente.
 */
export function describeAuthorProfile(author: AuthorProfileView): string {
  const count =
    author.articleCount === 1 ? "1 matéria publicada" : `${author.articleCount} matérias publicadas`;
  const latest =
    author.latestDateLabel === null ? "" : `; a mais recente em ${author.latestDateLabel}`;
  return `${author.name} assina ${count} na Cinerie${latest}.`;
}
