/**
 * synopsis-language.ts — De que idioma veio a sinopse, e como a tela diz isso.
 *
 * ================== O DEFEITO QUE ESTE MODULO EXISTE PARA FECHAR ============
 * A politica de idioma do T2 e ASSIMETRICA e foi decidida pelo dono:
 *
 *   SEMENTE     exige `pt-BR`/`pt`. Sem traducao, o titulo nao entra.
 *   SOB DEMANDA aceita o idioma de ORIGEM, porque o leitor digitou o nome e
 *               pediu — e recusar quem pediu e pior que mostrar o original.
 *
 * A ingestao ja implementa a assimetria (`on-demand/eligibility.ts`, que devolve
 * `overviewSource: 'fallback'`). O que NAO existia era o outro lado: a pagina.
 *
 * `movie-page.ts`/`series-page.ts` liam a traducao com `languageCode: 'pt-BR'`
 * no WHERE. Uma sinopse gravada em `en-US` pelo caminho sob demanda nao chegava
 * rotulada errada — ela **nao chegava**. A pagina renderizava sem sinopse
 * nenhuma, e nada no codigo dizia por que. Ou seja: autorizamos ingerir o texto
 * em ingles e descartavamos esse texto no render, em silencio, para o leitor que
 * o tinha pedido explicitamente.
 *
 * ================== POR QUE A MARCA NAO PODE SER OPCIONAL ==================
 * O tipo {@link SynopsisView} e uma uniao DISCRIMINADA, e o braco de fallback
 * declara `notice` como obrigatorio. Nao existe forma de construir "texto em
 * idioma de origem" sem a frase que avisa o leitor — o compilador recusa. Uma
 * flag booleana opcional teria permitido exatamente o esquecimento que este
 * modulo existe para impedir.
 *
 * ================== O QUE ESTE MODULO NAO FAZ ==============================
 *  - **Nao afrouxa a prioridade global de locale.** {@link PUBLISHED_LOCALES}
 *    aqui e o MESMO conjunto que o resto do site publica, e o texto do locale
 *    publicado vence SEMPRE que existir. A excecao tem escopo: so a sinopse
 *    visivel, so quando nao ha texto publicado.
 *  - **Nao alimenta `<meta name="description">` nem o JSON-LD.** Uma descricao
 *    em ingles numa pagina declarada `pt-BR` e afirmacao errada para o robo, e
 *    metadado nao tem onde carregar o aviso que a tela carrega. Ver
 *    `selectMetaDescription`, que continua restrita ao locale publicado.
 *  - **Nao inventa selo.** O rotulo sai de `mapOriginalLanguage`, a MESMA tabela
 *    que ja escreve "Inglês" na ficha tecnica.
 */

import { mapOriginalLanguage } from "./entity-status";

/**
 * Locales que o site publica, em ordem de prioridade (o primeiro vence).
 *
 * Espelha `LOCALE_PRIORITY` da ingestao. A copia e deliberada — `apps/web` so
 * toca o banco por `src/server/**` e nao importa de `services/*` —, e a
 * divergencia entre as duas listas e travada por teste.
 */
export const PUBLISHED_LOCALES = ["pt-BR", "pt"] as const;

/** Uma linha de `entity_translations` candidata a fornecer a sinopse. */
export interface TranslationCandidate {
  /** Locale EXATO da linha (`pt-BR`, `en-US`, ...). Nunca inferido. */
  readonly languageCode: string;
  readonly metaDescription: string | null;
  readonly summary: string | null;
}

/**
 * A sinopse escolhida, e de onde ela veio.
 *
 * O braco `original_language` carrega `notice` OBRIGATORIO: e o que torna
 * impossivel exibir texto estrangeiro sem dizer ao leitor que ele e o original.
 */
export type SynopsisView =
  | {
      readonly source: "published_locale";
      readonly text: string;
      readonly languageCode: string;
    }
  | {
      readonly source: "original_language";
      readonly text: string;
      readonly languageCode: string;
      /** Frase exibida ao lado da sinopse. Nunca vazia. */
      readonly notice: string;
    };

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Peso do locale (MENOR vence); desconhecido perde de todos. */
export function publishedLocaleRank(languageCode: string): number {
  const index = (PUBLISHED_LOCALES as readonly string[]).indexOf(languageCode);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** O locale e um dos que o site publica? */
export function isPublishedLocale(languageCode: string): boolean {
  return publishedLocaleRank(languageCode) !== Number.MAX_SAFE_INTEGER;
}

/**
 * Subtag primaria de um BCP-47 (`en-US` -> `en`).
 *
 * `mapOriginalLanguage` fala ISO 639-1; `entity_translations.language_code`
 * guarda BCP-47. Sem este corte, `en-US` cairia no `null` da tabela e o aviso
 * perderia o nome do idioma — a frase generica ainda protegeria o leitor, mas
 * seria pior sem necessidade.
 */
export function primarySubtag(languageCode: string): string {
  const [primary] = languageCode.trim().toLowerCase().split(/[-_]/);
  return primary ?? "";
}

/**
 * A frase que acompanha a sinopse em idioma de origem.
 *
 * Idioma reconhecido nomeia o idioma; desconhecido cai numa frase generica que
 * ainda diz a verdade essencial (o texto nao esta em portugues). Em nenhum
 * caminho o retorno e vazio — `SynopsisView` depende disso.
 */
export function originalLanguageNotice(languageCode: string): string {
  const label = mapOriginalLanguage(primarySubtag(languageCode));
  return label === null
    ? "Sinopse no idioma original — ainda sem tradução para o português."
    : `Sinopse em ${label} — ainda sem tradução para o português.`;
}

/** O texto util de uma candidata (`meta_description`, senao `summary`). */
function textOf(candidate: TranslationCandidate): string | null {
  return (
    trimToNull(candidate.metaDescription) ?? trimToNull(candidate.summary)
  );
}

/**
 * Escolhe a sinopse entre TODAS as traducoes da entidade.
 *
 * Ordem de decisao, e ela nao tem empate:
 *
 *  1. Locale publicado com texto — pela prioridade declarada (`pt-BR` > `pt`).
 *     Enquanto existir, o resto e ignorado: a excecao do T2 e para AUSENCIA de
 *     texto publicado, nunca para "preferir" o original.
 *  2. Idioma de origem da obra, quando informado e presente entre as linhas.
 *     Preferi-lo importa: uma obra japonesa com traducao `en-US` e `fr-FR` deve
 *     mostrar o texto que o leitor tem mais chance de reconhecer como original.
 *  3. Qualquer outra linha com texto, em ordem alfabetica de locale — criterio
 *     ARBITRARIO mas TOTAL, para que duas execucoes sobre as mesmas linhas
 *     escolham a mesma. Depender da ordem do `findMany` faria a pagina mudar
 *     conforme o plano do PostgreSQL.
 *
 * `null` quando nenhuma linha tem texto: a pagina omite a sinopse, como antes.
 */
export function selectSynopsis(
  candidates: readonly TranslationCandidate[],
  originalLanguage: string | null | undefined,
): SynopsisView | null {
  const withText = candidates
    .map((candidate) => ({ candidate, text: textOf(candidate) }))
    .filter((entry): entry is { candidate: TranslationCandidate; text: string } =>
      entry.text !== null,
    );

  const published = withText
    .filter((entry) => isPublishedLocale(entry.candidate.languageCode))
    .sort(
      (a, b) =>
        publishedLocaleRank(a.candidate.languageCode) -
        publishedLocaleRank(b.candidate.languageCode),
    )[0];

  if (published !== undefined) {
    return {
      source: "published_locale",
      text: published.text,
      languageCode: published.candidate.languageCode,
    };
  }

  const foreign = withText.filter(
    (entry) => !isPublishedLocale(entry.candidate.languageCode),
  );
  if (foreign.length === 0) return null;

  const origin = trimToNull(originalLanguage);
  const preferred =
    (origin === null
      ? undefined
      : foreign.find(
          (entry) =>
            primarySubtag(entry.candidate.languageCode) ===
            primarySubtag(origin),
        )) ??
    [...foreign].sort((a, b) =>
      a.candidate.languageCode.localeCompare(b.candidate.languageCode),
    )[0];

  // `foreign.length > 0` garante que `preferred` existe; o `!` seria mentira e
  // o `??` acima ja cobre o caso, entao a checagem e defensiva e explicita.
  if (preferred === undefined) return null;

  return {
    source: "original_language",
    text: preferred.text,
    languageCode: preferred.candidate.languageCode,
    notice: originalLanguageNotice(preferred.candidate.languageCode),
  };
}
