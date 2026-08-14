/**
 * popular-rankings.ts — Configuracao e contrato PURO da secao "Popular essa
 * semana" (home, `/pt/filmes`, `/pt/series`). Sem rede, sem DB, sem IO.
 *
 * ============ O DEFEITO QUE ESTE MODULO EXISTE PARA FECHAR ============
 *
 * As abas eram `<a href>` DECORATIVAS com o conjunto da home (`Filmes`/`Series`)
 * repetido nas tres paginas. Duas consequencias, e a segunda e a grave:
 *
 *  1. clicar numa aba NAVEGAVA para outra rota em vez de trocar o recorte;
 *  2. a pagina de uma vertical oferecia a aba da OUTRA — `/pt/filmes` convidava
 *     o leitor a ver series, que e exatamente o que uma pagina de vertical nao
 *     pode fazer.
 *
 * Aqui as abas passam a ser CONFIGURACAO POR VERTICAL, e cada rotulo tem uma
 * consulta propria (ver `server/popular-rankings.ts`). O componente nao conhece
 * conjunto de abas nenhum: ele recebe o que a rota declarou.
 *
 * ============ "Bilheteria" e "Classicas" NAO EXISTEM ============
 *
 * Foram removidas da decisao de produto. Nao ha valor de `slug` para elas neste
 * modulo, e como o componente so aceita `RankingTabSlug`, nao ha caminho de
 * codigo que as reintroduza — nem como opcao escondida.
 */

import { MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from "./routes";

/** Contexto de render da secao. `home` e a UNIAO das duas verticais. */
export type RankingVertical = "home" | "movies" | "series";

/**
 * Recortes existentes. Um union fechado: aba desconhecida nao compila e
 * `?ranking=` com valor invalido cai no default (nunca em consulta fantasma).
 */
export type RankingTabSlug =
  | "filmes"
  | "series"
  | "streaming"
  | "cinema"
  | "em-cartaz"
  | "classicos"
  | "no-ar"
  | "novas-temporadas";

export interface RankingTab {
  readonly slug: RankingTabSlug;
  readonly label: string;
  /**
   * Destino do "Ver tudo" DESTA aba — o botao segue o recorte ativo, nunca e
   * link fixo.
   *
   * DIVERGENCIA DECLARADA: a especificacao pede `/filmes/streaming`,
   * `/series/novas-temporadas` etc. Essas rotas NAO existem no app (conferido em
   * `apps/web/app/pt/**`), e apontar para elas produziria 404 — um link quebrado
   * e pior que um link aproximado. Cada aba aponta para a listagem real mais
   * proxima do seu recorte; quando as rotas por recorte existirem, so este mapa
   * muda.
   */
  readonly seeAllHref: string;
}

/** Hub de streaming — a unica listagem real de "onde assistir" que existe. */
const WATCH_HUB_PATH = "/pt/onde-assistir/";

/**
 * Abas por vertical. Ordem = ordem na tela; a PRIMEIRA e o default.
 *
 * Conjuntos definitivos (decisao de produto de 13/08/2026):
 *  - `/pt/filmes`  -> Em cartaz · Streaming · Classicos
 *  - `/pt/series`  -> No ar · Streaming · Novas temporadas
 *  - home          -> Filmes · Series · Streaming · Cinema
 */
export const RANKING_TABS: Readonly<Record<RankingVertical, readonly RankingTab[]>> = {
  home: [
    { slug: "filmes", label: "Filmes", seeAllHref: MOVIES_INDEX_PATH },
    { slug: "series", label: "Séries", seeAllHref: SERIES_INDEX_PATH },
    { slug: "streaming", label: "Streaming", seeAllHref: WATCH_HUB_PATH },
    { slug: "cinema", label: "Cinema", seeAllHref: MOVIES_INDEX_PATH },
  ],
  movies: [
    { slug: "em-cartaz", label: "Em cartaz", seeAllHref: MOVIES_INDEX_PATH },
    { slug: "streaming", label: "Streaming", seeAllHref: WATCH_HUB_PATH },
    { slug: "classicos", label: "Clássicos", seeAllHref: MOVIES_INDEX_PATH },
  ],
  series: [
    { slug: "no-ar", label: "No ar", seeAllHref: SERIES_INDEX_PATH },
    { slug: "streaming", label: "Streaming", seeAllHref: WATCH_HUB_PATH },
    { slug: "novas-temporadas", label: "Novas temporadas", seeAllHref: SERIES_INDEX_PATH },
  ],
};

/** Nome do query param que carrega a aba ativa (compartilhavel, sobrevive ao refresh). */
export const RANKING_QUERY_PARAM = "ranking";

/** Itens por aba. O rank e a posicao DENTRO da aba, 1..LIMIT — nunca global. */
export const POPULAR_RANKING_LIMIT = 10;

/**
 * Linha de aba vazia. A secao NAO some: esconde-la tornaria a aba vazia
 * invisivel, e o leitor nao saberia que aquele recorte existe.
 */
export const RANKING_EMPTY_MESSAGE = "Nada por aqui esta semana.";

/**
 * Aba ativa a partir do `?ranking=`. Valor ausente, desconhecido ou de OUTRA
 * vertical (ex.: `?ranking=novas-temporadas` em `/pt/filmes`) cai na primeira
 * aba da vertical — um param forjado nunca dispara a consulta de outra pagina.
 */
export function resolveActiveRankingSlug(
  vertical: RankingVertical,
  requested: string | readonly string[] | undefined | null,
): RankingTabSlug {
  const tabs = RANKING_TABS[vertical];
  const fallback = tabs[0];
  // O union fechado garante que toda vertical tem ao menos uma aba; o
  // estreitamento abaixo e so para o compilador.
  if (fallback === undefined) throw new Error(`vertical sem abas: ${vertical}`);
  const value = Array.isArray(requested) ? requested[0] : requested;
  if (typeof value !== "string") return fallback.slug;
  const match = tabs.find((tab) => tab.slug === value);
  return match?.slug ?? fallback.slug;
}

/** Um titulo ja posicionado no ranking. Card = poster + numero, nada mais. */
export interface RankedTitle {
  /** `${entityType}:${id}` — chave estavel e unica entre filmes e series. */
  readonly id: string;
  /** Posicao DENTRO da aba (1..POPULAR_RANKING_LIMIT). */
  readonly rank: number;
  readonly title: string;
  readonly href: string;
  /** URL absoluta do poster 2:3, ou null (a moldura fica no fundo neutro). */
  readonly posterUrl: string | null;
}

/** Entrada crua de um titulo candidato (ja serializada pelo loader server). */
export interface RankedTitleInput {
  readonly id: string;
  readonly title: string | null;
  readonly href: string | null;
  readonly posterUrl: string | null;
}

/**
 * Numera os candidatos de 1..limit, descartando quem nao tem titulo ou rota.
 *
 * O rank e atribuido DEPOIS do descarte: uma lista com um titulo invalido no
 * meio nao produz "1, 3, 4" nem um buraco — produz 1, 2, 3. Sem poster o card
 * ainda entra (a moldura neutra e honesta); sem href entrar seria oferecer um
 * link quebrado.
 */
export function rankTitles(
  inputs: readonly RankedTitleInput[],
  limit: number = POPULAR_RANKING_LIMIT,
): RankedTitle[] {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : POPULAR_RANKING_LIMIT;
  const out: RankedTitle[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    if (out.length === cap) break;
    const title = input.title?.trim();
    const href = input.href?.trim();
    if (!title || !href) continue;
    // Uma entidade nunca ocupa duas posicoes na mesma aba (ex.: uma serie com
    // duas temporadas estreando na janela de "Novas temporadas").
    if (seen.has(input.id)) continue;
    seen.add(input.id);
    out.push({ id: input.id, rank: out.length + 1, title, href, posterUrl: input.posterUrl });
  }
  return out;
}

/**
 * Nome acessivel do card. O numero e INFORMACAO, nao decoracao: o card nao tem
 * texto visivel nenhum, entao a posicao precisa entrar no nome acessivel.
 */
export function rankedTitleAccessibleName(item: RankedTitle): string {
  return `${item.rank}. ${item.title}`;
}
