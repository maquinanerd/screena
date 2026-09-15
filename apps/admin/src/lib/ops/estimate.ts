/**
 * estimate.ts — O CUSTO de uma acao, mostrado ANTES da confirmacao. PURO.
 *
 * ============================================================================
 * POR QUE O CUSTO APARECE ANTES
 * ============================================================================
 * Um clique despreocupado no botao de uma serie longa enfileira a cascata
 * inteira: detalhe, midia, temporadas, e a midia de cada episodio. Em "Doctor
 * Who" isso sao milhares de requisicoes. Sem o numero na frente do botao, o dono
 * so descobre depois — e neste projeto um caminho parecido ja consumiu a cota
 * diaria inteira.
 *
 * ============================================================================
 * DE ONDE SAI CADA NUMERO
 * ============================================================================
 * Das requisicoes que os handlers REALMENTE fazem, contadas no codigo:
 *
 *   sync_details   1  (detalhe com append)          sync-details-handler.ts
 *   sync_media     2  (/images + /videos)           catalog-services.ts syncMedia
 *   sync_seasons   1  (getTvShow, lista temporadas) catalog-services.ts syncSeasons
 *   sync_episodes  1 + episodios da temporada       catalog-services.ts syncEpisodes
 *                  (getTvSeason + getTvEpisode por episodio)
 *   midia de temporada e de episodio: 2 cada
 *   nota externa   1  (OMDb por imdb_id)
 *   Cinerie Score  0  (calculo local)
 *
 * A contagem de temporadas e episodios e a do BANCO hoje. Uma serie que ganhou
 * episodio no TMDB custa um pouco mais, e a tela diz isso ("com base em...").
 */

import { OMDB_DAILY_LIMIT, ON_DEMAND_RESERVE, OMDB_BACKGROUND_DAILY_ENVELOPE } from "@screena/config";

/** As acoes sobre um titulo. */
export const FORCE_TITLE_ACTIONS = ["detalhe", "midia", "temporadas", "nota", "score"] as const;

/** Uma acao sobre um titulo. */
export type ForceTitleAction = (typeof FORCE_TITLE_ACTIONS)[number];

/** Rotulo de cada acao na tela. */
export const FORCE_TITLE_ACTION_LABELS: Readonly<Record<ForceTitleAction, string>> = {
  detalhe: "Detalhe (com a cascata inteira)",
  midia: "Mídia (trailer, pôster e imagens)",
  temporadas: "Temporadas e episódios",
  nota: "Nota externa (OMDb)",
  score: "Recalcular o Cinerie Score",
};

/** Requisicoes por job, contadas nos handlers. */
export const TMDB_REQUESTS = {
  detail: 1,
  media: 2,
  seasonsList: 1,
  seasonDetail: 1,
  episodeDetail: 1,
  seasonMedia: 2,
  episodeMedia: 2,
} as const;

/** O titulo, como o painel o leu do banco. */
export interface TitleShape {
  readonly kind: "movie" | "tv";
  /** Temporadas no banco. `null` = a serie ainda nao teve as temporadas sincronizadas. */
  readonly seasons: number | null;
  /** Episodios no banco. */
  readonly episodes: number | null;
  readonly imdbId: string | null;
}

/** O estado da cota diaria da OMDb, como o painel o mediu. */
export interface OmdbQuotaState {
  /** Gasto de hoje (UTC). `null` = nao foi possivel medir. */
  readonly spentToday: number | null;
}

/** Uma linha do custo. */
export interface CostLine {
  readonly label: string;
  readonly requests: number;
}

/** Como a acao cabe na cota. */
export type QuotaFit =
  | { readonly kind: "none"; readonly note: string }
  | { readonly kind: "no_daily_limit"; readonly note: string }
  | {
      readonly kind: "daily";
      readonly dailyLimit: number;
      readonly spentToday: number | null;
      readonly remainingAfter: number | null;
      readonly fits: boolean | null;
      readonly note: string;
    };

/** O custo de uma acao. */
export interface CostEstimate {
  readonly provider: "tmdb" | "omdb" | "github" | "tmdb-exports" | null;
  /** Requisicoes estimadas. `null` = nao determinavel antes de rodar. */
  readonly requests: number | null;
  /** `true` quando `requests` e um MINIMO (a cascata pode crescer). */
  readonly lowerBound: boolean;
  readonly lines: readonly CostLine[];
  /** De onde sai a conta. Sempre preenchido. */
  readonly basis: string;
  readonly quota: QuotaFit;
  /** A acao NAO pode ser feita, e o porque. `null` = pode. */
  readonly refusal: string | null;
}

const TMDB_QUOTA_NOTE =
  "O TMDB não tem cota diária; o cliente respeita ~40 requisições por segundo. O custo aqui é tempo de fila, não cota.";

const OMDB_HEADER_NOTE =
  "A OMDb não publica cabeçalho de cota: o gasto é o que NÓS contamos em api_sync_logs, não o que ela conta.";

function sum(lines: readonly CostLine[]): number {
  return lines.reduce((total, line) => total + line.requests, 0);
}

/** A cascata de temporadas de uma serie, com base no que o banco tem. */
function seasonCascade(seasons: number, episodes: number): CostLine[] {
  return [
    { label: "lista de temporadas (sync_seasons)", requests: TMDB_REQUESTS.seasonsList },
    { label: `detalhe de ${String(seasons)} temporada(s) (sync_episodes)`, requests: seasons * TMDB_REQUESTS.seasonDetail },
    { label: `detalhe de ${String(episodes)} episódio(s)`, requests: episodes * TMDB_REQUESTS.episodeDetail },
    { label: `mídia de ${String(seasons)} temporada(s)`, requests: seasons * TMDB_REQUESTS.seasonMedia },
    { label: `mídia de ${String(episodes)} episódio(s)`, requests: episodes * TMDB_REQUESTS.episodeMedia },
  ];
}

/** O encaixe de UMA requisicao da OMDb no dia, como leitor (`on_demand`). */
export function omdbFit(requests: number, state: OmdbQuotaState): QuotaFit {
  if (state.spentToday === null) {
    return {
      kind: "daily",
      dailyLimit: OMDB_DAILY_LIMIT,
      spentToday: null,
      remainingAfter: null,
      fits: null,
      note: `Não foi possível medir o gasto de hoje: não determinado se cabe. ${OMDB_HEADER_NOTE}`,
    };
  }
  const remainingAfter = OMDB_DAILY_LIMIT - state.spentToday - requests;
  return {
    kind: "daily",
    dailyLimit: OMDB_DAILY_LIMIT,
    spentToday: state.spentToday,
    remainingAfter,
    fits: remainingAfter >= 0,
    note:
      `Pedido nominal entra como leitor (on_demand): pode usar a reserva de ${String(ON_DEMAND_RESERVE)} e para no teto do dia. ` +
      OMDB_HEADER_NOTE,
  };
}

/** O custo de uma acao sobre um titulo. */
export function estimateTitleAction(
  action: ForceTitleAction,
  title: TitleShape,
  omdb: OmdbQuotaState,
): CostEstimate {
  const tmdbQuota: QuotaFit = { kind: "no_daily_limit", note: TMDB_QUOTA_NOTE };

  if (action === "midia") {
    const lines = [{ label: "mídia do título (/images + /videos)", requests: TMDB_REQUESTS.media }];
    return {
      provider: "tmdb",
      requests: sum(lines),
      lowerBound: false,
      lines,
      basis: "sync_media: 2 requisições nos endpoints dedicados (catalog-services.ts syncMedia).",
      quota: tmdbQuota,
      refusal: null,
    };
  }

  if (action === "detalhe") {
    const base: CostLine[] = [
      { label: "detalhe com append (sync_details)", requests: TMDB_REQUESTS.detail },
      { label: "mídia do título (cascata)", requests: TMDB_REQUESTS.media },
    ];
    if (title.kind === "movie") {
      return {
        provider: "tmdb",
        requests: sum(base),
        lowerBound: false,
        lines: base,
        basis: "sync_details de filme enfileira só a mídia (sync-details-handler.ts).",
        quota: tmdbQuota,
        refusal: null,
      };
    }
    if (title.seasons === null || title.episodes === null) {
      return {
        provider: "tmdb",
        requests: sum(base) + TMDB_REQUESTS.seasonsList,
        lowerBound: true,
        lines: [...base, { label: "lista de temporadas (sync_seasons)", requests: TMDB_REQUESTS.seasonsList }],
        basis:
          "O banco ainda não tem as temporadas desta série: o custo das temporadas e episódios só se sabe depois da lista. O número é um MÍNIMO.",
        quota: tmdbQuota,
        refusal: null,
      };
    }
    const lines = [...base, ...seasonCascade(title.seasons, title.episodes)];
    return {
      provider: "tmdb",
      requests: sum(lines),
      lowerBound: true,
      lines,
      basis: `Com base em ${String(title.seasons)} temporada(s) e ${String(title.episodes)} episódio(s) que o banco tem hoje; episódio novo no TMDB soma mais.`,
      quota: tmdbQuota,
      refusal: null,
    };
  }

  if (action === "temporadas") {
    if (title.kind === "movie") {
      return {
        provider: null,
        requests: null,
        lowerBound: false,
        lines: [],
        basis: "Filme não tem temporadas.",
        quota: { kind: "none", note: "" },
        refusal: "filme não tem temporadas",
      };
    }
    if (title.seasons === null || title.episodes === null) {
      return {
        provider: "tmdb",
        requests: TMDB_REQUESTS.seasonsList,
        lowerBound: true,
        lines: [{ label: "lista de temporadas (sync_seasons)", requests: TMDB_REQUESTS.seasonsList }],
        basis: "O banco ainda não tem as temporadas desta série. O número é um MÍNIMO.",
        quota: tmdbQuota,
        refusal: null,
      };
    }
    const lines = seasonCascade(title.seasons, title.episodes);
    return {
      provider: "tmdb",
      requests: sum(lines),
      lowerBound: true,
      lines,
      basis: `Com base em ${String(title.seasons)} temporada(s) e ${String(title.episodes)} episódio(s) que o banco tem hoje.`,
      quota: tmdbQuota,
      refusal: null,
    };
  }

  if (action === "nota") {
    if (title.imdbId === null || !/^tt\d{7,10}$/.test(title.imdbId)) {
      return {
        provider: "omdb",
        requests: 0,
        lowerBound: false,
        lines: [],
        basis: "A OMDb consulta por IMDb id; sem ele não há consulta.",
        quota: { kind: "none", note: "" },
        refusal: "título sem imdb_id: a OMDb não alcança este título",
      };
    }
    const lines = [{ label: `consulta da OMDb (${title.imdbId})`, requests: 1 }];
    const quota = omdbFit(1, omdb);
    return {
      provider: "omdb",
      requests: 1,
      lowerBound: false,
      lines,
      basis: "sync-omdb-ratings --id: 1 requisição traz IMDb, Rotten Tomatoes e Metacritic.",
      quota,
      refusal: quota.kind === "daily" && quota.fits === false ? "a cota diária da OMDb acabou hoje" : null,
    };
  }

  return {
    provider: null,
    requests: 0,
    lowerBound: false,
    lines: [],
    basis: "compute-cinerie-score --entity-id: cálculo local sobre as notas já gravadas; nenhuma rede, nenhuma cota.",
    quota: { kind: "none", note: "Sem fornecedor." },
    refusal: null,
  };
}

/** O que o painel sabe da fila para estimar um ciclo forcado. */
export interface QueueCostContext {
  /** Itens elegiveis hoje (universo que a selecao percorre). `null` = nao determinavel. */
  readonly eligible: number | null;
  /** Teto por ciclo vigente. `null` = desconhecido daqui. */
  readonly perCycle: number | null;
  readonly omdb: OmdbQuotaState;
}

/** O custo de UM ciclo forcado de uma fila. */
export function estimateQueueAction(queue: string, context: QueueCostContext): CostEstimate {
  const tmdbQuota: QuotaFit = { kind: "no_daily_limit", note: TMDB_QUOTA_NOTE };
  const nenhum: QuotaFit = { kind: "none", note: "Sem fornecedor: só banco." };
  const itens = (): number | null =>
    context.eligible === null || context.perCycle === null ? null : Math.min(context.eligible, context.perCycle);

  switch (queue) {
    case "deploy_reference":
      return {
        provider: "github",
        requests: 16,
        lowerBound: false,
        lines: [
          { label: "lista de commits do main", requests: 1 },
          { label: "árvores novas (teto por ciclo)", requests: 10 },
          { label: "comparações com a cabeça (teto por ciclo)", requests: 5 },
        ],
        basis: "Pior caso por ciclo; um ciclo sem commit novo custa 1. Limite do GitHub sem token: 60/h.",
        quota: { kind: "none", note: "Repositório público; o limite é por hora, não por dia." },
        refusal: null,
      };
    case "catalog_coverage":
    case "cinerie_score":
    case "search_projection":
      return {
        provider: null,
        requests: 0,
        lowerBound: false,
        lines: [],
        basis: "Fila derivada: lê e grava só o banco.",
        quota: nenhum,
        refusal: null,
      };
    case "trending":
      return {
        provider: "tmdb",
        requests: 4,
        lowerBound: false,
        lines: [{ label: "filme e série × dia e semana", requests: 4 }],
        basis: "4 sync_lists, uma página cada (trending-jobs.ts).",
        quota: tmdbQuota,
        refusal: null,
      };
    case "changes":
      return {
        provider: "tmdb",
        requests: null,
        lowerBound: false,
        lines: [],
        basis: "O custo depende de quantos títulos mudaram na janela do /changes: não determinável antes de rodar.",
        quota: tmdbQuota,
        refusal: null,
      };
    case "discovery":
      return {
        provider: "tmdb-exports",
        requests: null,
        lowerBound: false,
        lines: [{ label: "arquivos do export diário (sem token, sem cota)", requests: 3 }],
        basis:
          "Os 3 downloads não gastam cota; o custo real está nos detalhes que a descoberta enfileira, e depende de quantos ids novos o dia trouxe.",
        quota: { kind: "none", note: "Arquivos públicos em files.tmdb.org." },
        refusal: null,
      };
    case "watch_offers": {
      const n = itens();
      return {
        provider: "tmdb",
        requests: n,
        lowerBound: false,
        lines: n === null ? [] : [{ label: `${String(n)} título(s) × /watch/providers`, requests: n }],
        basis: "1 requisição por título no endpoint dedicado, até o teto do ciclo.",
        quota: tmdbQuota,
        refusal: null,
      };
    }
    case "title_media": {
      const n = itens();
      return {
        provider: "tmdb",
        requests: n === null ? null : n * TMDB_REQUESTS.media,
        lowerBound: false,
        lines: n === null ? [] : [{ label: `${String(n)} título(s) × (/images + /videos)`, requests: n * TMDB_REQUESTS.media }],
        basis: "2 requisições por título, até o teto de 12.000 por ciclo.",
        quota: tmdbQuota,
        refusal: null,
      };
    }
    case "airing_series":
    case "title_detail_active":
    case "title_detail_ended":
    case "people": {
      const n = itens();
      return {
        provider: "tmdb",
        requests: n === null ? null : n * (queue === "people" ? TMDB_REQUESTS.detail : TMDB_REQUESTS.detail + TMDB_REQUESTS.media),
        lowerBound: true,
        lines:
          n === null
            ? []
            : [{ label: `${String(n)} detalhe(s)${queue === "people" ? "" : " + mídia da cascata"}`, requests: n * (queue === "people" ? 1 : 3) }],
        basis:
          "Mínimo: cada detalhe custa 1 e a mídia 2; séries acrescentam a cascata de temporadas. O que já foi enfileirado hoje não duplica (chave do dia).",
        quota: tmdbQuota,
        refusal: null,
      };
    }
    case "ratings_omdb": {
      const spent = context.omdb.spentToday;
      const slots = spent === null ? null : Math.max(0, Math.min(OMDB_BACKGROUND_DAILY_ENVELOPE, OMDB_DAILY_LIMIT - spent - ON_DEMAND_RESERVE));
      return {
        provider: "omdb",
        requests: slots,
        lowerBound: false,
        lines: slots === null ? [] : [{ label: "fatia de fundo disponível hoje", requests: slots }],
        basis: `min(envelope de fundo ${String(OMDB_BACKGROUND_DAILY_ENVELOPE)}, cota ${String(OMDB_DAILY_LIMIT)} − gasto − reserva ${String(ON_DEMAND_RESERVE)}) — quota.ts backgroundOmdbSlots.`,
        quota: {
          kind: "daily",
          dailyLimit: OMDB_DAILY_LIMIT,
          spentToday: spent,
          remainingAfter: spent === null || slots === null ? null : OMDB_DAILY_LIMIT - spent - slots,
          fits: slots === null ? null : slots > 0,
          note: `A fila de fundo nunca entra na reserva do leitor. ${OMDB_HEADER_NOTE}`,
        },
        refusal: slots === 0 ? "a fatia de fundo da OMDb acabou hoje: um ciclo agora não consultaria nada" : null,
      };
    }
    case "awards":
      return {
        provider: "omdb",
        requests: 0,
        lowerBound: false,
        lines: [],
        basis: "Lê os payloads da OMDb já guardados em api_cache; o custo real, se houver, é gravado pela própria CLI.",
        quota: { kind: "none", note: "" },
        refusal: null,
      };
    default:
      return {
        provider: null,
        requests: null,
        lowerBound: false,
        lines: [],
        basis: "Fila desconhecida.",
        quota: { kind: "none", note: "" },
        refusal: `fila desconhecida: ${queue}`,
      };
  }
}
