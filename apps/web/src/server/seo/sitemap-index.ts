/**
 * sitemap-index.ts — Camada SERVER-ONLY do sitemap index + shards, PAGINADO NO
 * PostgreSQL (Fase 3, §11).
 *
 * O runtime NUNCA carrega o catalogo inteiro em memoria:
 *  - `/sitemap.xml` (index) consulta apenas CONTAGENS por (idioma, tipo) e o
 *    `MAX(updated_at)` de cada conjunto, e deriva o numero de shards por
 *    `ceil(total / limit)`. So gera os ENDERECOS dos shards — sem buscar URLs.
 *  - `/sitemaps/{id}.xml` (shard) consulta SOMENTE a sua pagina, de UM tipo, com
 *    `ORDER BY` deterministico + `LIMIT/OFFSET` no banco. Nao busca outras
 *    paginas, nao mistura tipos, nao monta todos os shards para devolver um.
 *
 * Todas as EXCLUSOES acontecem no WHERE (nunca "carregar tudo e filtrar com um
 * Set em memoria"): idioma nao publicado, entidade sem slug canonico/sem titulo,
 * decisao vigente que nao seja `index`, e para noticia licenca/publicacao/
 * atribuicao/linkback ausentes. SQL sempre PARAMETRIZADO (`$queryRaw` tagged
 * template) — a entrada do shard NUNCA e concatenada em SQL.
 *
 * A REGRA DA DECISAO SE INVERTEU (2026-08-27). Antes era `NOT EXISTS (...
 * decision <> 'index')`: linha AUSENTE fazia a URL ENTRAR, e como
 * `page_indexability_decisions` nunca foi escrita, o site indexava por OMISSAO.
 * Agora entra quem TEM decisao vigente `index` — desde que o gate daquele tipo
 * esteja ARMADO. Ver {@link SITEMAP_DECISION_GATE_MIN_ROWS} para o porque do
 * armar e para o que acontece enquanto a tabela nao tiver linhas suficientes.
 *
 * PESSOA tem um gate EXTRA: alem de slug canonico e nome, precisa ter ao menos
 * um credito (elenco ou equipe) em um FILME ou SERIE que ela propria seja
 * publicavel (slug canonico no idioma + decisao coerente com o gate). Sem
 * isso, cada titulo ingerido despejava o elenco inteiro no sitemap — o catalogo
 * observado tinha ~22.400 URLs de pessoa contra ~129 filmes e ~110 series. A
 * regra canonica (e o porque) vive em `@screena/seo` -> `person-eligibility.ts`;
 * aqui esta a sua traducao para SQL. O gate aparece DUAS vezes (contagem e
 * pagina) porque cada tipo repete seu WHERE nos dois lugares; `sitemap-person-
 * eligibility.test.ts` trava que as duas copias continuam identicas — se elas
 * divergirem, o index anuncia N shards que a pagina nao consegue preencher.
 *
 * IMAGEM (compensacao da decisao do dono D1): a URL de filme e de serie leva
 * `<image:image>` com a arte que a FICHA exibe — as mesmas colunas, a mesma
 * licenca (`getImageDisplayAuthorization`, uma leitura por shard) e a mesma lista
 * (`entityPageImageUrls`) do JSON-LD da ficha. A imagem nao entra no WHERE nem
 * nas contagens: index, teto por tipo e numero de shards contam URLs.
 *
 * Invariantes 3/4: zero API externa, zero Gemini; so PostgreSQL local. FAIL-CLOSED
 * em falha de banco. Serializacao XML pura via `@screena/seo`
 * (`renderUrlset`/`renderSitemapIndex`). `planSitemapShards` NAO e o mecanismo de
 * runtime — permanece no pacote SEO apenas para colecoes pequenas/testes puros.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  describeSitemapCeilingVerdict,
  evaluateSitemapCeilings,
  evaluateSitemapTypeCeiling,
  MIN_SEASON_EPISODES_WITH_SYNOPSIS,
  MIN_SYNOPSIS_CHARS,
  renderSitemapIndex,
  renderUrlset,
  SITEMAP_CONTENT_TYPE,
  SITEMAP_URL_LIMIT,
  SYNOPSIS_TRIM_CHARS,
  TMDB_FALLBACK_SLUG_SQL_PATTERN,
  type SitemapCeilingReport,
  type SitemapIndexXmlEntry,
  type SitemapXmlUrl,
} from "@screena/seo";
import type { ImageDisplayAuthorization } from "@screena/public-contracts";

import {
  canonicalPublicUrl,
  episodePath,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  imagesGalleryPath,
  seasonPath,
  videosGalleryPath,
  SERIES_INDEX_PATH,
  SITE_URL,
} from "../../lib/site";
import { evaluateEntityIndexIndexability } from "../../lib/entity-index-presenter";
import { evaluateNewsIndexIndexability, MIN_ARTICLE_BODY_CHARS } from "../../lib/news-presenter";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
} from "../../lib/portal-presenter";
import {
  IMAGES_INDEX_FLOOR,
  VIDEOS_INDEX_FLOOR,
} from "../../lib/gallery-presenter";
import { PUBLISHED_LOCALES } from "../../lib/synopsis-language";
import { entityPageImageUrls } from "../../lib/entity-page-images";
import { selectMovieMedia } from "../../lib/movie-presenter";
import { selectSeriesMedia } from "../../lib/series-presenter";
import {
  ABOUT_PATH,
  ANTICIPATED_PATH,
  AUTHORS_INDEX_PATH,
  CONTACT_PATH,
  EDITORIAL_POLICY_PATH,
  SCORE_METHODOLOGY_PATH,
  WATCH_PATH,
} from "../../lib/routes";
import { anticipatedIndexable, getAnticipatedData } from "../anticipated";
import { getPersonIndexData } from "../entity-indexes";
import { getImageDisplayAuthorization } from "../image-license";
import { getAuthorDirectoryData } from "../news-pages";
import { getWatchBrowseData, watchBrowseIndexable } from "../watch-browse";
import {
  absentDecisionFor,
  isDecisionGateArmed,
  readDecisionCoverage,
  SITEMAP_DECISION_GATE_MIN_ROWS,
  unarmedDecisionEntities,
  type DecisionCoverage,
  type DecisionEntity,
} from "./decision-coverage";

// Reexportados daqui de proposito: a suite de governanca e o validador real ja
// importavam estes nomes deste modulo, e a regra continua sendo uma so.
export { isDecisionGateArmed, SITEMAP_DECISION_GATE_MIN_ROWS };
export type { DecisionCoverage, DecisionEntity };

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Unico idioma com dados publicados no sitemap hoje (dados sob language_code). */
export const SITEMAP_LANGUAGE = "pt-BR";

/** Tipos cuja URL e INDEX + slug canonico proprio. */
export type SimpleSitemapType = "movies" | "series" | "people" | "news";
/** Tipos de entidade paginados (com rota publica real). `static` e a parte fixa. */
export type EntitySitemapType =
  | SimpleSitemapType
  | "seasons"
  | "episodes"
  /**
   * As GALERIAS de imagem e de video, de filme E de serie no mesmo shard.
   *
   * O nome do tipo e o SEGMENTO da rota (`imagens`/`videos`) de proposito: um
   * terceiro vocabulario ("galleries", "media") criaria mais um lugar em que a
   * mesma coisa tem outro nome.
   *
   * O PISO ENTRA NO `WHERE`, e nao em codigo depois da consulta. Uma galeria
   * abaixo do piso recebe `noindex` na propria pagina, e a regra de SEO e clara:
   * pagina `noindex` NUNCA entra no sitemap. Filtrar fora do SQL faria a
   * CONTAGEM do index divergir das URLs do shard — o index prometeria N e o
   * shard entregaria menos, que e a forma mais cara de sitemap errado.
   */
  | "imagens"
  | "videos";
/**
 * Todos os tipos que o codigo SABE montar. Nao e o que o sitemap PUBLICA — ver
 * {@link SUSPENDED_SITEMAP_TYPES} e {@link ENTITY_TYPES}.
 */
const SUPPORTED_ENTITY_TYPES: readonly EntitySitemapType[] = [
  "movies",
  "series",
  "people",
  "news",
  "seasons",
  "episodes",
  "imagens",
  "videos",
];

/**
 * VALVULA DE EMERGENCIA — 2026-08-27, por decisao do dono.
 *
 * O QUE FOI MEDIDO (sitemap de producao, shard a shard, 2026-08-27):
 *
 *   episodes  3.793.672 URLs  (78 shards)  93,22%
 *   seasons     127.870 URLs  ( 3 shards)   3,14%
 *   people       43.975 URLs                1,08%
 *   imagens      41.230 URLs                1,01%
 *   series       31.596 URLs                0,78%
 *   movies       30.948 URLs                0,76%
 *   videos          140 · news 7 · static 6
 *   ------------------------------------------------
 *   TOTAL     4.069.444 URLs   contra 53.054 em 2026-08-22 (77x em cinco dias)
 *
 * Temporada e episodio somam 96,36% do volume. A pagina de episodio rende ~108
 * palavras dentro de `<main>` — numero, data e a sinopse quando existe. Nao ha
 * elenco, direcao nem imagem propria. Declarar 3,9 milhoes dessas como validas
 * gasta orcamento de rastreio do dominio inteiro para publicar casca.
 *
 * POR QUE UMA LISTA, E NAO UM GATE POR DADO: o gate por dado e a Fase 3
 * (`page_indexability_decisions`, com "sem linha = nao indexa"), e ele depende
 * de um produtor rodar contra o banco de producao. Esta valvula nao depende de
 * nada alem do deploy — e por isso ela existe: para parar a sangria HOJE.
 *
 * COMO ELA MORRE: quando a Fase 3 estiver aplicada, o gate volta a perguntar
 * pelo DADO (episodio COM sinopse indexa; sem sinopse nao) e esta lista volta a
 * ser vazia. `sitemap-emergency-valve.test.ts` documenta a saida.
 *
 * MORREU EM 22/09/2026, a pedido do dono. Temporada e episodio voltam ao
 * sitemap pelo portao de CONTEUDO (`evaluateSeasonQualityGate` e
 * `evaluateEpisodeQualityGate`, em `@screena/seo`), com o mesmo texto nas
 * consultas abaixo. Medido em producao no mesmo dia: de 112 episodios
 * sorteados, 18 tinham sinopse de verdade (todos com imagem propria); das 40
 * temporadas, uma tinha sinopse propria. Estimativa ponderada pelo tamanho de
 * cada serie: ~109 mil episodios e ~6,6 mil temporadas passam — contra os
 * 3.921.542 que a valvula tirou. A lista fica, vazia, como ferramenta de
 * emergencia: o par da pagina (`suspended-pages.ts`) continua ligado a ela.
 *
 * O par obrigatorio: sair do sitemap NAO desindexa o que o Google ja pegou.
 * Estes mesmos tipos passam a emitir `noindex, follow` na propria pagina — ver
 * `apps/web/src/server/seo/suspended-pages.ts`. As duas coisas, ou nenhuma
 * resolve.
 */
export const SUSPENDED_SITEMAP_TYPES: readonly EntitySitemapType[] = [];

/**
 * FORA DO SITEMAP POR DECISAO DO DONO — D1, 2026-09-11
 * (`docs/seo/DECISOES-DO-DONO-2026-09-11.md`).
 *
 * Nao e valvula: a valvula acima e temporaria e morre quando a politica por dado
 * chegar. Esta lista e uma DECISAO — galeria nao indexa como pagina propria.
 * Medido na auditoria de SEO: 69.016 URLs de galeria, 42,7% do sitemap, com 0
 * palavras de conteudo principal e sem `<main>`. Elas nao usavam extensao de
 * sitemap de imagem nem de video: so pediam rastreio, sem alimentar Google
 * Imagens ou Videos.
 *
 * O par, como na valvula: a pagina de galeria passa a emitir `noindex, follow`
 * pelo portao `evaluateGalleryGate` (`@screena/seo`). As duas coisas, ou
 * nenhuma. E o shard antigo (`sitemap-pt-BR-imagens-1.xml`) responde 404, pelo
 * mesmo mecanismo do tipo suspenso.
 */
export const OWNER_EXCLUDED_SITEMAP_TYPES: readonly EntitySitemapType[] = ["imagens", "videos"];

/** O que o sitemap PUBLICA hoje: o suportado, menos o suspenso, menos o excluido por decisao. */
const ENTITY_TYPES: readonly EntitySitemapType[] = SUPPORTED_ENTITY_TYPES.filter(
  (type) => !SUSPENDED_SITEMAP_TYPES.includes(type) && !OWNER_EXCLUDED_SITEMAP_TYPES.includes(type),
);

/**
 * Os locales que a PAGINA considera publicados (`synopsis-language.ts`), como
 * parametro de SQL. O portao de localizacao do sitemap le exatamente as mesmas
 * linhas de traducao que a pagina le para titulo e meta — outro conjunto aqui e
 * sitemap e meta robots discordando de novo.
 */
const PUBLISHED_LOCALE_CODES: string[] = [...PUBLISHED_LOCALES];

/**
 * Tipos aceitos por `parseShardId`. Tipo suspenso NAO entra: o shard antigo
 * (`sitemap-pt-BR-episodes-42.xml`) precisa responder 404, e nao continuar
 * servindo 50.000 URLs para quem guardou o endereco.
 */
const ALL_TYPES: readonly string[] = [...ENTITY_TYPES, "static"];

/**
 * TETO DECLARADO DE URLs DO SITEMAP — HISTORICO DO TETO GLOBAL.
 *
 * POR QUE ISTO EXISTE. Em 2026-08-22 o sitemap tinha 53.054 URLs. Em 2026-08-27
 * tinha 4.069.444 — 77x em cinco dias — e NENHUM alarme disparou. Nao disparou
 * porque nada nunca comparou o total a coisa nenhuma: `SITEMAP_URL_LIMIT`
 * pagina o shard (50.000 por arquivo na epoca; 10.000 desde 21/09/2026) e nao
 * conhece o total, e as duas rotas do
 * sitemap sao `force-dynamic` — elas nao sao geradas no build, sao montadas a
 * cada requisicao direto do PostgreSQL. Nao houve deploy, nao houve mudanca de
 * codigo e nao houve linha de log: o catalogo cresceu e o sitemap cresceu junto,
 * calado. Sem um teto, a proxima vez tambem passaria em silencio.
 *
 * ESTE BLOCO E HISTORICO: descreve o teto GLOBAL, vigente de 2026-08-27 a
 * 2026-09-11. Ele fica porque explica por que existe teto — e por que ele deixou
 * de ser global. A regra VIGENTE e `SITEMAP_TYPE_URL_CEILING`, logo abaixo.
 *
 * O teto ERA sobre o TOTAL PUBLICADO (a soma das contagens de `ENTITY_TYPES`),
 * nao sobre o shard. Ele nao substitui a politica por dado da Fase 3 — e o
 * detector de fumaca que avisa quando a politica falhou.
 *
 * ESTOURAR O TETO E FAIL-CLOSED: o index sai VAZIO e o erro vai para o log, do
 * mesmo jeito que uma falha de banco. Publicar milhoes de URLs por engano e
 * mais caro do que publicar nenhuma por um ciclo. Subir este numero e uma
 * mudanca de codigo revisada — que e exatamente o controle que faltava.
 *
 * Calibragem MEDIDA em producao (2026-08-27, depois do deploy da valvula, shard
 * a shard, so respostas 200):
 *
 *   imagens 43.155 · movies 34.799 · series 32.392 · videos 140 · news 7 ·
 *   static 5 · people 0 (shard 404: o gate de bio+foto nao deixa passar ninguem)
 *   ------------------------------------------------------------------------
 *   TOTAL 110.498 URLs em 6 shards, contra 4.069.444 em 88 shards antes.
 *
 * O teto a 300.000 tolera 2,7x sobre esse total e ainda pega um evento de ordem
 * de grandeza. Ele NAO foi recalibrado para 2x nesta leva de proposito: o total
 * legitimo DEPOIS do gate por decisao so existe quando o produtor tiver rodado
 * contra producao, e apertar o teto contra um numero que ainda vai cair
 * transformaria o detector de fumaca em alarme falso.
 *
 * ESTE TETO E UM PRAZO, NAO UMA FOLGA. Medido no mesmo dia, em quatro leituras
 * do shard de filmes ao longo de 84 minutos: 30.948 -> 32.050 -> 33.720 ->
 * 34.735. Sao ~2.700 filmes por hora, ~65.000 por dia — a ingestao cria slug
 * para todo titulo descoberto, e o sitemap publica todo slug. Nesse ritmo o
 * teto e cruzado em cerca de tres dias, e ai o index sai vazio.
 *
 * Isso e o teto FUNCIONANDO: o problema nao e o numero aqui, e um catalogo que
 * cresce 65.000 fichas por dia sem que nenhuma delas precise ter sinopse ou
 * poster para entrar. Quem segura essa linha e a Fase 3 (gate por DADO), nao um
 * numero maior escrito aqui. Subir este valor sem ligar o gate por dado so
 * troca a data do estouro.
 */
/**
 * TETO VIGENTE: POR TIPO (desde 2026-09-11).
 *
 * O teto global descrito acima tinha um defeito que a auditoria de SEO mediu com
 * data: um tipo so empurrava a soma, e o corte apagava junto os tipos que nao
 * tinham nada com isso. Em 11/09 as galerias eram 42,7% do sitemap, e a projecao
 * linear punha o estouro entre ~21/10 e ~06/11/2026 — levando filmes, series e
 * noticias para fora do indice por causa delas.
 *
 * Agora cada tipo e avaliado SOZINHO (`evaluateSitemapCeilings`, em
 * `@screena/seo`): estourar o teto tira do sitemap SO aquele tipo, e o aviso
 * chega antes do corte, em 80%, 90% e 95%. Continua fail-closed — por tipo. Um
 * tipo acima do teto NAO e cortado nas primeiras N URLs: publicar um recorte que
 * ninguem escolheu seria pior do que nao publicar o tipo.
 *
 * Filme e serie ficam em ~4x o volume medido em 2026-08-27 (34.799 e 32.392) — a
 * mesma ordem de folga do teto global, agora sem que o crescimento de um tipo
 * consuma a folga do outro. Pessoa tem o teto de filme de proposito: o portao de
 * pessoa (decisao do dono D2) vai abrir, e o 0 medido nao e um volume.
 *
 * Tipos suspensos (temporada, episodio) e tipos fora do sitemap por decisao do
 * dono tambem tem teto declarado: se voltarem a publicar, voltam com o detector
 * ligado. Contra o evento de 2026-08-27, o teto de episodio reprovaria as
 * 3.793.672 URLs medidas por 25x.
 *
 * Subir um teto continua sendo mudanca de codigo revisada. O que segura o
 * crescimento e a politica por DADO de cada tipo, nao um numero maior aqui.
 */
export const SITEMAP_TYPE_URL_CEILING: Readonly<Record<EntitySitemapType, number>> = Object.freeze({
  movies: 150_000,
  series: 150_000,
  people: 150_000,
  news: 50_000,
  seasons: 150_000,
  // Episodio: ~109 mil estimados em 22/09/2026 (amostra ponderada de 219
  // series), com cauda pesada — serie de milhares de episodios quase nunca cai
  // numa amostra. 400 mil cobre ate ~3,7x a estimativa e ainda reprova o evento
  // de 2026-08-27 (3.793.672) por 9,5x.
  episodes: 400_000,
  imagens: 150_000,
  videos: 150_000,
});

/**
 * Loga o relatorio do teto: corte como ERRO, alerta como AVISO. Tipo `ok` nao
 * gera linha — log que fala a cada requisicao vira ruido e deixa de ser lido.
 */
function logCeilingReport(report: SitemapCeilingReport): void {
  for (const verdict of report.verdicts) {
    if (verdict.excluded) console.error(`[sitemap] ${describeSitemapCeilingVerdict(verdict)}`);
  }
  for (const verdict of report.alerts) {
    console.warn(`[sitemap] ${describeSitemapCeilingVerdict(verdict)}`);
  }
}

/*
 * A REGRA DE COBERTURA - quanto do tipo a politica ja decidiu, e o que a
 * AUSENCIA de decisao vale por causa disso - mora em `decision-coverage.ts` desde
 * 2026-09-11. Ela passou a servir tambem o `<meta robots>` da pagina, e duas
 * copias da mesma regra sao exatamente a divergencia (d) que a auditoria de SEO
 * achou. O porque do piso de 1.000, do armar por tipo e da contagem saturada
 * esta documentado la, junto do codigo.
 */

/**
 * Registra, uma vez por requisicao, quais gates ainda estao DESARMADOS.
 *
 * Sem isto o estado de transicao seria invisivel: o sitemap continuaria
 * publicando por omissao e nada no log diria que a regra nova esta inerte. Foi
 * exatamente assim que 78 shards nasceram sem uma linha de log.
 */
function warnUnarmedGates(coverage: DecisionCoverage): void {
  const unarmed = unarmedDecisionEntities(coverage);
  if (unarmed.length === 0) return;
  console.error(
    "[sitemap] gate de decisao DESARMADO para: " +
      unarmed.map((e) => `${e}=${coverage[e]}`).join(" ") +
      `. Piso: ${SITEMAP_DECISION_GATE_MIN_ROWS} linhas vigentes por tipo. ` +
      "Enquanto desarmado, entidade SEM decisao continua entrando no sitemap " +
      "(comportamento antigo). Arma sozinho quando 'catalog index-decisions " +
      "--apply' rodar contra este banco.",
  );
}

const INDEX_PATH: Readonly<Record<SimpleSitemapType, string>> = {
  movies: MOVIES_INDEX_PATH,
  series: SERIES_INDEX_PATH,
  people: PEOPLE_INDEX_PATH,
  news: NEWS_INDEX_PATH,
};

const ENTITY_CHANGEFREQ: Readonly<Record<EntitySitemapType, string>> = {
  movies: "monthly",
  series: "monthly",
  people: "monthly",
  news: "weekly",
  seasons: "monthly",
  episodes: "monthly",
  // A galeria muda quando a midia do titulo muda, que e o ritmo do `sync_media`
  // (7 dias). "monthly" seria otimista; "weekly" e o que o dado faz.
  imagens: "weekly",
  videos: "weekly",
};
const ENTITY_PRIORITY: Readonly<Record<EntitySitemapType, number>> = {
  movies: 0.5,
  series: 0.5,
  people: 0.5,
  news: 0.6,
  seasons: 0.4,
  episodes: 0.3,
  // Abaixo de temporada: sao sub-paginas de midia, nao a obra.
  imagens: 0.3,
  videos: 0.3,
};

export interface SitemapXmlResponse {
  xml: string;
  contentType: string;
  /**
   * `true` quando o XML e o FAIL-CLOSED de uma falha, e nao a lista do momento.
   * A rota responde igual, mas manda a borda nao guardar (`sitemap-cache-control.ts`).
   */
  degraded?: boolean;
}

export interface SitemapPageOptions {
  /**
   * URLs por shard. Default = `SITEMAP_URL_LIMIT` (producao). Existe para TESTES
   * (limite reduzido) — nunca muda o limite de producao.
   */
  limit?: number;
  /**
   * As decisoes dos hubs que dependem do loader da propria pagina. Default =
   * `defaultStaticHubDecisions` (os MESMOS loaders das paginas). Existe para teste
   * com banco falso — nunca muda a regra de producao.
   */
  staticHubDecisions?: () => Promise<StaticHubDecisions>;
}

interface Aggregate {
  count: number;
  maxLastmod: Date | null;
}

interface PageRow {
  slug: string;
  lastmod: Date | null;
  /**
   * So filme e serie: as colunas de arte da FICHA, lidas na MESMA consulta da
   * pagina do shard — nenhuma consulta por linha. Ausentes nos demais tipos.
   */
  poster_path?: string | null;
  backdrop_path?: string | null;
}

function resolveLimit(opts?: SitemapPageOptions): number {
  const limit = opts?.limit;
  return limit !== undefined && Number.isInteger(limit) && limit > 0
    ? limit
    : SITEMAP_URL_LIMIT;
}

function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// Consultas por tipo: CONTAGEM (+ max lastmod) e PAGINA (LIMIT/OFFSET no banco).
// Exclusoes 100% no WHERE. Idioma/limite/offset sao PARAMETROS ($queryRaw).
// ---------------------------------------------------------------------------

async function aggregateEntity(
  prisma: PrismaClient,
  type: EntitySitemapType,
  language: string,
  coverage: DecisionCoverage,
): Promise<Aggregate> {
  const absentMovie = absentDecisionFor(coverage, "movie");
  const absentTv = absentDecisionFor(coverage, "tv");
  const absentPerson = absentDecisionFor(coverage, "person");
  const absentSeason = absentDecisionFor(coverage, "season");
  const absentEpisode = absentDecisionFor(coverage, "episode");
  let rows: { n: number; maxmod: Date | null }[];
  if (type === "movies") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(m.updated_at) AS maxmod
      FROM slugs s JOIN movies m ON m.id = s.entity_id
      WHERE s.entity_type = 'movie' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(m.title_original) <> ''
        -- PORTAO DE LOCALIZACAO (decisao do dono D3, 2026-09-11): ficha com slug de
        -- fallback tmdb-N fica fora enquanto nao tiver titulo PROPRIO nem descricao
        -- no locale publicado. Titulo igual ao original nao abre o portao: a linha
        -- pt-BR costuma trazer o original copiado, e foi por isso que o portao nao
        -- barrou ninguem em producao (medido em 17/09/2026: 11.922 fichas tmdb-N
        -- ainda no sitemap). Mesmo predicado de isLocalizedTitle, que a pagina usa;
        -- contagem e pagina repetem o texto IGUAL.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND NOT (
          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'movie' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(m.title_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'movie' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentMovie}) = 'index'`;
  } else if (type === "series") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(t.updated_at) AS maxmod
      FROM slugs s JOIN tv_shows t ON t.id = s.entity_id
      WHERE s.entity_type = 'tv' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(t.name_original) <> ''
        -- PORTAO DE LOCALIZACAO (decisao do dono D3, 2026-09-11): ficha com slug de
        -- fallback tmdb-N fica fora enquanto nao tiver titulo PROPRIO nem descricao
        -- no locale publicado. Titulo igual ao original nao abre o portao: a linha
        -- pt-BR costuma trazer o original copiado, e foi por isso que o portao nao
        -- barrou ninguem em producao (medido em 17/09/2026: 11.922 fichas tmdb-N
        -- ainda no sitemap). Mesmo predicado de isLocalizedTitle, que a pagina usa;
        -- contagem e pagina repetem o texto IGUAL.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND NOT (
          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'tv' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'tv' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentTv}) = 'index'`;
  } else if (type === "people") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(p.updated_at) AS maxmod
      FROM slugs s JOIN people p ON p.id = s.entity_id
      WHERE s.entity_type = 'person' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(p.name) <> ''
        -- VALVULA 2026-08-27 (ver SUSPENDED_SITEMAP_TYPES): pessoa sem
        -- biografia EXIBIVEL ou sem foto rende uma ficha de ~52 palavras dentro
        -- de <main> — nome, papel e uma lista de links. Medido em 2026-08-27:
        -- 0 de 300 pessoas do sitemap exibiam biografia. Sao os MESMOS
        -- predicados que o produtor da Fase 3 usa para decidir no_biography /
        -- no_image (services/ingestion/src/persistence/indexability-writer.ts),
        -- escritos aqui para nao dependerem de o produtor ja ter rodado.
        -- Texto E licenca: a coluna de governanca nasce unknown, e bio ingerida
        -- sem liberacao nao aparece na tela (invariante 6).
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND BTRIM(COALESCE(p.biography, '')) <> ''
        AND p.biography_source_status::text IN ('official','licensed','third_party')
        AND BTRIM(COALESCE(p.profile_path, '')) <> ''
        AND EXISTS (
          SELECT 1 FROM cast_members cm
          JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
            AND ws.language_code = ${language} AND ws.is_canonical = true
          WHERE cm.person_id = p.id AND cm.entity_type IN ('movie','tv')
            AND COALESCE((SELECT wd.decision::text FROM page_indexability_decisions wd
              WHERE wd.entity_type = cm.entity_type AND wd.entity_id = cm.entity_id
                AND wd.language_code = ${language} AND wd.is_current = true
              LIMIT 1), CASE cm.entity_type::text WHEN 'movie' THEN ${absentMovie} ELSE ${absentTv} END) = 'index'
          UNION ALL
          SELECT 1 FROM crew_members rm
          JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
            AND ws.language_code = ${language} AND ws.is_canonical = true
          WHERE rm.person_id = p.id AND rm.entity_type IN ('movie','tv')
            AND COALESCE((SELECT wd.decision::text FROM page_indexability_decisions wd
              WHERE wd.entity_type = rm.entity_type AND wd.entity_id = rm.entity_id
                AND wd.language_code = ${language} AND wd.is_current = true
              LIMIT 1), CASE rm.entity_type::text WHEN 'movie' THEN ${absentMovie} ELSE ${absentTv} END) = 'index'
        )
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'person' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentPerson}) = 'index'`;
  } else if (type === "news") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(at.updated_at) AS maxmod
      FROM article_translations at JOIN articles a ON a.id = at.article_id
      WHERE at.language_code = ${language}
        AND at.review_status IN ('human_reviewed','published')
        AND a.license_status IN ('official','licensed','third_party')
        AND a.display_allowed = true
        AND BTRIM(at.slug) <> '' AND BTRIM(at.title) <> ''
        AND COALESCE(at.published_at, a.published_at) <= (NOW() AT TIME ZONE 'UTC')
        AND at.index_status = 'index'
        AND LENGTH(BTRIM(COALESCE(at.body, ''))) >= ${MIN_ARTICLE_BODY_CHARS}
        AND (a.requires_attribution = false OR BTRIM(COALESCE(a.source_name, '')) <> '')
        AND (a.requires_linkback = false OR BTRIM(COALESCE(a.source_url, '')) <> '')`;
  } else if (type === "imagens" || type === "videos") {
    rows = await aggregateGallery(prisma, type, language, coverage);
  } else if (type === "seasons") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(se.updated_at) AS maxmod
      FROM seasons se
      JOIN tv_shows t ON t.id = se.tv_show_id
      JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
        AND s.language_code = ${language} AND s.is_canonical = true
      WHERE BTRIM(t.name_original) <> ''
        -- SERIE NO INDICE: a pagina herda a exclusao da serie dona. E o MESMO
        -- predicado do sitemap de series (portao de localizacao D3 e decisao
        -- efetiva da serie); a pagina faz a mesma pergunta em series-in-index.ts.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND NOT (
          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'tv' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT sd.decision::text FROM page_indexability_decisions sd
          WHERE sd.entity_type = 'tv' AND sd.entity_id = s.entity_id
            AND sd.language_code = ${language} AND sd.is_current = true
          LIMIT 1), ${absentTv}) = 'index'
        -- CONTEUDO DA TEMPORADA (saida da valvula de 2026-08-27 por dado, a pedido
        -- do dono em 22/09/2026): sinopse propria, OU um guia de ao menos
        -- MIN_SEASON_EPISODES_WITH_SYNOPSIS episodios com sinopse de verdade. E o
        -- portao da pagina (evaluateSeasonQualityGate). Especiais (temporada 0)
        -- nao tem rota publica.
        AND se.season_number >= 1
        AND (
          char_length(BTRIM(COALESCE(se.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}
          OR (
            SELECT COUNT(*) FROM (
              SELECT 1 FROM episodes ep
              WHERE ep.season_id = se.id
                AND char_length(BTRIM(COALESCE(ep.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}
              LIMIT ${MIN_SEASON_EPISODES_WITH_SYNOPSIS}
            ) guia
          ) >= ${MIN_SEASON_EPISODES_WITH_SYNOPSIS}
        )
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'season' AND d.entity_id = se.id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentSeason}) = 'index'`;
  } else {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(e.updated_at) AS maxmod
      FROM episodes e
      JOIN seasons se ON se.id = e.season_id
      JOIN tv_shows t ON t.id = e.tv_show_id
      JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
        AND s.language_code = ${language} AND s.is_canonical = true
      WHERE BTRIM(t.name_original) <> ''
        -- SERIE NO INDICE: a pagina herda a exclusao da serie dona. E o MESMO
        -- predicado do sitemap de series (portao de localizacao D3 e decisao
        -- efetiva da serie); a pagina faz a mesma pergunta em series-in-index.ts.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND NOT (
          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'tv' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT sd.decision::text FROM page_indexability_decisions sd
          WHERE sd.entity_type = 'tv' AND sd.entity_id = s.entity_id
            AND sd.language_code = ${language} AND sd.is_current = true
          LIMIT 1), ${absentTv}) = 'index'
        -- CONTEUDO DO EPISODIO (saida da valvula de 2026-08-27 por dado, a pedido
        -- do dono em 22/09/2026): sinopse de verdade E imagem propria. E o portao
        -- da pagina (evaluateEpisodeQualityGate).
        AND se.season_number >= 1 AND e.episode_number >= 1
        AND char_length(BTRIM(COALESCE(e.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}
        AND BTRIM(COALESCE(e.still_path, '')) <> ''
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'episode' AND d.entity_id = e.id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentEpisode}) = 'index'`;
  }
  return { count: rows[0]?.n ?? 0, maxLastmod: rows[0]?.maxmod ?? null };
}

// ---------------------------------------------------------------------------
// GALERIAS (/{filmes,series}/{slug}/{imagens,videos}/)
//
// O PISO ENTRA NO `WHERE` (`HAVING COUNT(*) >= piso`), e nao em codigo depois
// da consulta. A pagina abaixo do piso recebe `noindex`, e pagina `noindex`
// nunca entra no sitemap; filtrar fora do SQL faria a CONTAGEM do index
// divergir das URLs do shard.
//
// Os dois pisos vem de `gallery-presenter.ts` — os MESMOS que a pagina usa para
// decidir `robots`. Dois numeros para a mesma decisao divergiriam no primeiro
// ajuste.
// ---------------------------------------------------------------------------

/** Uma galeria elegivel: a vertical, o slug do titulo e o carimbo mais novo. */
interface GalleryRow {
  vertical: string;
  slug: string;
  lastmod: Date | null;
}

/**
 * As galerias elegiveis, de filme E de serie, no MESMO conjunto.
 *
 * `UNION ALL` em vez de duas consultas: a paginacao do shard e sobre o conjunto
 * inteiro, e paginar duas listas separadas exigiria um segundo esquema de
 * offset que divergiria da contagem.
 *
 * A ORDEM e TOTAL (`vertical, slug`): sem ela, `LIMIT/OFFSET` sobre um `UNION`
 * pode devolver a mesma URL em duas paginas e omitir outra — um sitemap com
 * duplicata e buraco, sem nenhum erro visivel.
 */
function gallerySql(type: "imagens" | "videos", language: string, floor: number) {
  const tabela = type === "imagens" ? "tmdb_images" : "tmdb_videos";
  // Video tem gate POR LINHA; imagem e gated pela FONTE (ver `entity-gallery.ts`).
  const gateVideo =
    type === "videos"
      ? "AND mi.display_allowed = true AND mi.license_status NOT IN ('unknown','blocked')"
      : "AND mi.image_type IN ('poster','backdrop','logo','still')";
  return { tabela, gateVideo, language, floor };
}

/**
 * O GATE DE DECISAO DO DONO DA GALERIA.
 *
 * A galeria nao tem decisao propria em `page_indexability_decisions` — ela e uma
 * SUB-PAGINA do filme ou da serie e herda a decisao dele. Ate aqui nao herdava
 * NADA: as duas consultas de galeria eram as unicas do sitemap sem clausula de
 * decisao, e por isso a galeria de um filme `noindex` continuaria anunciada.
 * Com a regra invertida isso ficaria gritante — galeria era o MAIOR tipo do
 * sitemap medido em 2026-08-27 (43.155 URLs, mais que filme ou serie), e ela
 * sobreviveria inteira a um corte que derrubasse os donos.
 *
 * `$1` e sempre o idioma; `$3`/`$4` sao o default de decisao ausente de filme e
 * de serie. As duas consultas de galeria usam a MESMA numeracao de proposito,
 * para o fragmento poder ser um so.
 */
function galleryOwnerGate(vertical: "movie" | "tv"): string {
  const idExpr = vertical === "movie" ? "m.id" : "t.id";
  const param = vertical === "movie" ? "$3" : "$4";
  return `AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = '${vertical}' AND d.entity_id = ${idExpr}
            AND d.language_code = $1 AND d.is_current = true
          LIMIT 1), ${param}) = 'index'`;
}

async function aggregateGallery(
  prisma: PrismaClient,
  type: "imagens" | "videos",
  language: string,
  coverage: DecisionCoverage,
): Promise<{ n: number; maxmod: Date | null }[]> {
  const { tabela, gateVideo, floor } = gallerySql(type, language, galleryFloor(type));
  return prisma.$queryRawUnsafe<{ n: number; maxmod: Date | null }[]>(
    `SELECT COUNT(*)::int AS n, MAX(lastmod) AS maxmod FROM (
       SELECT MAX(mi.updated_at) AS lastmod
         FROM ${tabela} mi
         JOIN movies m ON m.tmdb_id = mi.tmdb_id
         JOIN slugs s ON s.entity_type = 'movie' AND s.entity_id = m.id
           AND s.language_code = $1 AND s.is_canonical = true
        WHERE mi.entity_type = 'movie' ${gateVideo}
        ${galleryOwnerGate("movie")}
        GROUP BY s.slug HAVING COUNT(*) >= $2
       UNION ALL
       SELECT MAX(mi.updated_at) AS lastmod
         FROM ${tabela} mi
         JOIN tv_shows t ON t.tmdb_id = mi.tmdb_id
         JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
           AND s.language_code = $1 AND s.is_canonical = true
        WHERE mi.entity_type = 'tv' ${gateVideo}
        ${galleryOwnerGate("tv")}
        GROUP BY s.slug HAVING COUNT(*) >= $2
     ) AS galerias`,
    language,
    floor,
    absentDecisionFor(coverage, "movie"),
    absentDecisionFor(coverage, "tv"),
  );
}

async function pageGallery(
  prisma: PrismaClient,
  type: "imagens" | "videos",
  language: string,
  limit: number,
  offset: number,
  coverage: DecisionCoverage,
): Promise<SitemapXmlUrl[]> {
  const { tabela, gateVideo, floor } = gallerySql(type, language, galleryFloor(type));
  const rows = await prisma.$queryRawUnsafe<GalleryRow[]>(
    `SELECT vertical, slug, lastmod FROM (
       SELECT 'filmes' AS vertical, s.slug AS slug, MAX(mi.updated_at) AS lastmod
         FROM ${tabela} mi
         JOIN movies m ON m.tmdb_id = mi.tmdb_id
         JOIN slugs s ON s.entity_type = 'movie' AND s.entity_id = m.id
           AND s.language_code = $1 AND s.is_canonical = true
        WHERE mi.entity_type = 'movie' ${gateVideo}
        ${galleryOwnerGate("movie")}
        GROUP BY s.slug HAVING COUNT(*) >= $2
       UNION ALL
       SELECT 'series' AS vertical, s.slug AS slug, MAX(mi.updated_at) AS lastmod
         FROM ${tabela} mi
         JOIN tv_shows t ON t.tmdb_id = mi.tmdb_id
         JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
           AND s.language_code = $1 AND s.is_canonical = true
        WHERE mi.entity_type = 'tv' ${gateVideo}
        ${galleryOwnerGate("tv")}
        GROUP BY s.slug HAVING COUNT(*) >= $2
     ) AS galerias
     ORDER BY vertical ASC, slug ASC LIMIT $5 OFFSET $6`,
    language,
    floor,
    absentDecisionFor(coverage, "movie"),
    absentDecisionFor(coverage, "tv"),
    limit,
    offset,
  );

  return rows
    .map((row) => galleryUrl(type, row))
    .filter((url): url is SitemapXmlUrl => url !== null);
}

/** A URL de UMA galeria, ou `null` quando o slug nao produz caminho valido. */
function galleryUrl(type: "imagens" | "videos", row: GalleryRow): SitemapXmlUrl | null {
  const vertical = row.vertical === "filmes" ? ("filmes" as const) : ("series" as const);
  const caminho =
    type === "imagens"
      ? imagesGalleryPath(vertical, row.slug)
      : videosGalleryPath(vertical, row.slug);
  if (caminho === null) return null;
  const loc = canonicalPublicUrl(caminho);
  if (loc === null) return null;
  return {
    loc,
    lastmod: isoOrNull(row.lastmod),
    changefreq: ENTITY_CHANGEFREQ[type],
    priority: ENTITY_PRIORITY[type],
  };
}

/** O piso do tipo. Vem de `gallery-presenter.ts`; nunca reescrito aqui. */
function galleryFloor(type: "imagens" | "videos"): number {
  return type === "imagens" ? IMAGES_INDEX_FLOOR : VIDEOS_INDEX_FLOOR;
}

async function pageEntity(
  prisma: PrismaClient,
  type: SimpleSitemapType,
  language: string,
  limit: number,
  offset: number,
  coverage: DecisionCoverage,
): Promise<PageRow[]> {
  const absentMovie = absentDecisionFor(coverage, "movie");
  const absentTv = absentDecisionFor(coverage, "tv");
  const absentPerson = absentDecisionFor(coverage, "person");
  if (type === "movies") {
    return prisma.$queryRaw<PageRow[]>`
      SELECT s.slug AS slug, m.updated_at AS lastmod,
        m.poster_path AS poster_path, m.backdrop_path AS backdrop_path
      FROM slugs s JOIN movies m ON m.id = s.entity_id
      WHERE s.entity_type = 'movie' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(m.title_original) <> ''
        -- PORTAO DE LOCALIZACAO (decisao do dono D3, 2026-09-11): ficha com slug de
        -- fallback tmdb-N fica fora enquanto nao tiver titulo PROPRIO nem descricao
        -- no locale publicado. Titulo igual ao original nao abre o portao: a linha
        -- pt-BR costuma trazer o original copiado, e foi por isso que o portao nao
        -- barrou ninguem em producao (medido em 17/09/2026: 11.922 fichas tmdb-N
        -- ainda no sitemap). Mesmo predicado de isLocalizedTitle, que a pagina usa;
        -- contagem e pagina repetem o texto IGUAL.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND NOT (
          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'movie' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(m.title_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'movie' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentMovie}) = 'index'
      ORDER BY s.entity_id ASC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (type === "series") {
    return prisma.$queryRaw<PageRow[]>`
      SELECT s.slug AS slug, t.updated_at AS lastmod,
        t.poster_path AS poster_path, t.backdrop_path AS backdrop_path
      FROM slugs s JOIN tv_shows t ON t.id = s.entity_id
      WHERE s.entity_type = 'tv' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(t.name_original) <> ''
        -- PORTAO DE LOCALIZACAO (decisao do dono D3, 2026-09-11): ficha com slug de
        -- fallback tmdb-N fica fora enquanto nao tiver titulo PROPRIO nem descricao
        -- no locale publicado. Titulo igual ao original nao abre o portao: a linha
        -- pt-BR costuma trazer o original copiado, e foi por isso que o portao nao
        -- barrou ninguem em producao (medido em 17/09/2026: 11.922 fichas tmdb-N
        -- ainda no sitemap). Mesmo predicado de isLocalizedTitle, que a pagina usa;
        -- contagem e pagina repetem o texto IGUAL.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND NOT (
          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'tv' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'tv' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentTv}) = 'index'
      ORDER BY s.entity_id ASC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (type === "people") {
    return prisma.$queryRaw<PageRow[]>`
      SELECT s.slug AS slug, p.updated_at AS lastmod
      FROM slugs s JOIN people p ON p.id = s.entity_id
      WHERE s.entity_type = 'person' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(p.name) <> ''
        -- VALVULA 2026-08-27 (ver SUSPENDED_SITEMAP_TYPES): pessoa sem
        -- biografia EXIBIVEL ou sem foto rende uma ficha de ~52 palavras dentro
        -- de <main> — nome, papel e uma lista de links. Medido em 2026-08-27:
        -- 0 de 300 pessoas do sitemap exibiam biografia. Sao os MESMOS
        -- predicados que o produtor da Fase 3 usa para decidir no_biography /
        -- no_image (services/ingestion/src/persistence/indexability-writer.ts),
        -- escritos aqui para nao dependerem de o produtor ja ter rodado.
        -- Texto E licenca: a coluna de governanca nasce unknown, e bio ingerida
        -- sem liberacao nao aparece na tela (invariante 6).
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND BTRIM(COALESCE(p.biography, '')) <> ''
        AND p.biography_source_status::text IN ('official','licensed','third_party')
        AND BTRIM(COALESCE(p.profile_path, '')) <> ''
        AND EXISTS (
          SELECT 1 FROM cast_members cm
          JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
            AND ws.language_code = ${language} AND ws.is_canonical = true
          WHERE cm.person_id = p.id AND cm.entity_type IN ('movie','tv')
            AND COALESCE((SELECT wd.decision::text FROM page_indexability_decisions wd
              WHERE wd.entity_type = cm.entity_type AND wd.entity_id = cm.entity_id
                AND wd.language_code = ${language} AND wd.is_current = true
              LIMIT 1), CASE cm.entity_type::text WHEN 'movie' THEN ${absentMovie} ELSE ${absentTv} END) = 'index'
          UNION ALL
          SELECT 1 FROM crew_members rm
          JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
            AND ws.language_code = ${language} AND ws.is_canonical = true
          WHERE rm.person_id = p.id AND rm.entity_type IN ('movie','tv')
            AND COALESCE((SELECT wd.decision::text FROM page_indexability_decisions wd
              WHERE wd.entity_type = rm.entity_type AND wd.entity_id = rm.entity_id
                AND wd.language_code = ${language} AND wd.is_current = true
              LIMIT 1), CASE rm.entity_type::text WHEN 'movie' THEN ${absentMovie} ELSE ${absentTv} END) = 'index'
        )
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'person' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentPerson}) = 'index'
      ORDER BY s.entity_id ASC LIMIT ${limit} OFFSET ${offset}`;
  }
  return prisma.$queryRaw<PageRow[]>`
    SELECT at.slug AS slug, at.updated_at AS lastmod
    FROM article_translations at JOIN articles a ON a.id = at.article_id
    WHERE at.language_code = ${language}
      AND at.review_status IN ('human_reviewed','published')
      AND a.license_status IN ('official','licensed','third_party')
      AND a.display_allowed = true
      AND BTRIM(at.slug) <> '' AND BTRIM(at.title) <> ''
      AND COALESCE(at.published_at, a.published_at) <= (NOW() AT TIME ZONE 'UTC')
      AND at.index_status = 'index'
      AND LENGTH(BTRIM(COALESCE(at.body, ''))) >= ${MIN_ARTICLE_BODY_CHARS}
      AND (a.requires_attribution = false OR BTRIM(COALESCE(a.source_name, '')) <> '')
      AND (a.requires_linkback = false OR BTRIM(COALESCE(a.source_url, '')) <> '')
    ORDER BY at.id ASC LIMIT ${limit} OFFSET ${offset}`;
}

function pageRowsToUrls(
  type: SimpleSitemapType,
  rows: PageRow[],
  imageAuthorization: ImageDisplayAuthorization | null,
): SitemapXmlUrl[] {
  const urls: SitemapXmlUrl[] = [];
  for (const row of rows) {
    const slug = row.slug.trim();
    if (slug === "") continue;
    const loc = canonicalPublicUrl(`${INDEX_PATH[type]}${slug}/`);
    if (loc === null) continue;
    urls.push({
      loc,
      lastmod: isoOrNull(row.lastmod),
      changefreq: ENTITY_CHANGEFREQ[type],
      priority: ENTITY_PRIORITY[type],
      images: pageRowImages(type, row, imageAuthorization),
    });
  }
  return urls;
}

/**
 * As `<image:image>` da URL de uma ficha de filme ou de serie: EXATAMENTE a arte
 * que a ficha exibe e declara no JSON-LD. O caminho e o da propria ficha —
 * `selectMovieMedia`/`selectSeriesMedia` sob a autorizacao de
 * `getImageDisplayAuthorization`, e `entityPageImageUrls` para a lista —, e por
 * isso licenca negada, caminho malformado ou coluna vazia tiram a imagem do
 * sitemap pelo mesmo motivo que a tiram da tela.
 *
 * A imagem nao muda CONTAGEM: a URL entra ou sai pelo WHERE, e o index, o teto
 * por tipo e o numero de shards continuam contando URLs.
 */
function pageRowImages(
  type: SimpleSitemapType,
  row: PageRow,
  imageAuthorization: ImageDisplayAuthorization | null,
): SitemapXmlUrl["images"] {
  if (imageAuthorization === null) return null;
  const art = { posterPath: row.poster_path ?? null, backdropPath: row.backdrop_path ?? null };
  const media =
    type === "movies"
      ? selectMovieMedia(art, imageAuthorization)
      : type === "series"
        ? selectSeriesMedia(art, imageAuthorization)
        : null;
  if (media === null) return null;
  return entityPageImageUrls(media, SITE_URL).map((loc) => ({ loc }));
}

/**
 * A licenca de imagem, lida UMA vez por shard e so nos tipos cuja ficha exibe
 * arte (filme e serie). E a mesma leitura da ficha, fail-closed: com o banco
 * negando, a URL continua no shard, sem imagem.
 */
async function imageAuthorizationFor(
  prisma: PrismaClient,
  type: SimpleSitemapType,
): Promise<ImageDisplayAuthorization | null> {
  return type === "movies" || type === "series" ? getImageDisplayAuthorization(prisma) : null;
}

// ---------------------------------------------------------------------------
// Temporadas/episodios: URL composta (slug canonico da SERIE + numeros reais). A
// paginacao continua NO BANCO (LIMIT/OFFSET) e a exclusao no WHERE (idioma,
// serie com slug canonico/nome, decisao vigente != index da temporada/episodio).
// ---------------------------------------------------------------------------

function seasonEpisodeUrl(
  path: string | null,
  lastmod: Date | null,
  type: "seasons" | "episodes",
): SitemapXmlUrl | null {
  if (path === null) return null;
  const loc = canonicalPublicUrl(path);
  if (loc === null) return null;
  return {
    loc,
    lastmod: isoOrNull(lastmod),
    changefreq: ENTITY_CHANGEFREQ[type],
    priority: ENTITY_PRIORITY[type],
  };
}

async function pageSeasonEpisode(
  prisma: PrismaClient,
  type: "seasons" | "episodes",
  language: string,
  limit: number,
  offset: number,
  coverage: DecisionCoverage,
): Promise<SitemapXmlUrl[]> {
  const absentTv = absentDecisionFor(coverage, "tv");
  const absentSeason = absentDecisionFor(coverage, "season");
  const absentEpisode = absentDecisionFor(coverage, "episode");
  if (type === "seasons") {
    const rows = await prisma.$queryRaw<
      { series_slug: string; season_number: number; lastmod: Date | null }[]
    >`
      SELECT s.slug AS series_slug, se.season_number AS season_number, se.updated_at AS lastmod
      FROM seasons se
      JOIN tv_shows t ON t.id = se.tv_show_id
      JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
        AND s.language_code = ${language} AND s.is_canonical = true
      WHERE BTRIM(t.name_original) <> ''
        -- SERIE NO INDICE: a pagina herda a exclusao da serie dona. E o MESMO
        -- predicado do sitemap de series (portao de localizacao D3 e decisao
        -- efetiva da serie); a pagina faz a mesma pergunta em series-in-index.ts.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND NOT (
          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'tv' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT sd.decision::text FROM page_indexability_decisions sd
          WHERE sd.entity_type = 'tv' AND sd.entity_id = s.entity_id
            AND sd.language_code = ${language} AND sd.is_current = true
          LIMIT 1), ${absentTv}) = 'index'
        -- CONTEUDO DA TEMPORADA (saida da valvula de 2026-08-27 por dado, a pedido
        -- do dono em 22/09/2026): sinopse propria, OU um guia de ao menos
        -- MIN_SEASON_EPISODES_WITH_SYNOPSIS episodios com sinopse de verdade. E o
        -- portao da pagina (evaluateSeasonQualityGate). Especiais (temporada 0)
        -- nao tem rota publica.
        AND se.season_number >= 1
        AND (
          char_length(BTRIM(COALESCE(se.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}
          OR (
            SELECT COUNT(*) FROM (
              SELECT 1 FROM episodes ep
              WHERE ep.season_id = se.id
                AND char_length(BTRIM(COALESCE(ep.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}
              LIMIT ${MIN_SEASON_EPISODES_WITH_SYNOPSIS}
            ) guia
          ) >= ${MIN_SEASON_EPISODES_WITH_SYNOPSIS}
        )
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'season' AND d.entity_id = se.id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentSeason}) = 'index'
      ORDER BY se.id ASC LIMIT ${limit} OFFSET ${offset}`;
    return rows
      .map((row) =>
        seasonEpisodeUrl(seasonPath(row.series_slug, row.season_number), row.lastmod, "seasons"),
      )
      .filter((url): url is SitemapXmlUrl => url !== null);
  }
  const rows = await prisma.$queryRaw<
    {
      series_slug: string;
      season_number: number;
      episode_number: number;
      lastmod: Date | null;
    }[]
  >`
      SELECT s.slug AS series_slug, se.season_number AS season_number,
             e.episode_number AS episode_number, e.updated_at AS lastmod
      FROM episodes e
      JOIN seasons se ON se.id = e.season_id
      JOIN tv_shows t ON t.id = e.tv_show_id
      JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
        AND s.language_code = ${language} AND s.is_canonical = true
      WHERE BTRIM(t.name_original) <> ''
        -- SERIE NO INDICE: a pagina herda a exclusao da serie dona. E o MESMO
        -- predicado do sitemap de series (portao de localizacao D3 e decisao
        -- efetiva da serie); a pagina faz a mesma pergunta em series-in-index.ts.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND NOT (
          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'tv' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT sd.decision::text FROM page_indexability_decisions sd
          WHERE sd.entity_type = 'tv' AND sd.entity_id = s.entity_id
            AND sd.language_code = ${language} AND sd.is_current = true
          LIMIT 1), ${absentTv}) = 'index'
        -- CONTEUDO DO EPISODIO (saida da valvula de 2026-08-27 por dado, a pedido
        -- do dono em 22/09/2026): sinopse de verdade E imagem propria. E o portao
        -- da pagina (evaluateEpisodeQualityGate).
        AND se.season_number >= 1 AND e.episode_number >= 1
        AND char_length(BTRIM(COALESCE(e.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}
        AND BTRIM(COALESCE(e.still_path, '')) <> ''
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'episode' AND d.entity_id = e.id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentEpisode}) = 'index'
      ORDER BY e.id ASC LIMIT ${limit} OFFSET ${offset}`;
  return rows
    .map((row) =>
      seasonEpisodeUrl(
        episodePath(row.series_slug, row.season_number, row.episode_number),
        row.lastmod,
        "episodes",
      ),
    )
    .filter((url): url is SitemapXmlUrl => url !== null);
}

// ---------------------------------------------------------------------------
// Rotas estaticas: pequena lista fixa (shard proprio, em memoria). O gate usa os
// MESMOS evaluators das paginas, alimentado pelas CONTAGENS ja calculadas — e,
// para os hubs cuja decisao nao sai dessas contagens, pelo loader da PROPRIA
// pagina (`StaticHubDecisions`).
// ---------------------------------------------------------------------------

/** A decisao de `index` dos hubs que NAO sai das contagens do sitemap. */
export interface StaticHubDecisions {
  /** `/pt/pessoas/`: a listagem decide pela contagem DELA, nao pela do portao D2. */
  readonly people: boolean;
  /** `/pt/onde-assistir/`: indexa quando ha oferta licenciada. */
  readonly watch: boolean;
  /** `/pt/em-breve/`: indexa quando ha estreia anunciada. */
  readonly anticipated: boolean;
  /** A data da oferta mais recente do hub de streaming, quando existe. */
  readonly watchUpdatedAtIso: string | null;
  /**
   * As paginas de autor com materia no ar, com a data da mais recente de cada uma.
   * Vazio = nem `/pt/autores/` entra: a listagem sem autor e `noindex`.
   */
  readonly authors: readonly { readonly path: string; readonly lastmod: string | null }[];
}

/**
 * As MESMAS perguntas que as paginas fazem para decidir o proprio robots.
 *
 * AUDITORIA DE SEO (11/09/2026, secao 3.7): `/pt/pessoas/`, `/pt/onde-assistir/` e
 * `/pt/em-breve/` diziam `index` na pagina e ficavam fora do shard estatico. A de
 * pessoas porque o shard decidia pela contagem do SITEMAP de pessoas (o portao
 * D2), e nao pela da listagem; as outras duas porque nem estavam na lista. Chamar
 * o loader da pagina, e nao reescrever a regra aqui, e o que impede a divergencia
 * de voltar.
 */
export async function defaultStaticHubDecisions(): Promise<StaticHubDecisions> {
  const [people, watch, anticipated, authorDirectory] = await Promise.all([
    getPersonIndexData(),
    getWatchBrowseData(),
    getAnticipatedData(),
    getAuthorDirectoryData(),
  ]);
  return {
    people: people.indexability.decision === "index",
    watch: watchBrowseIndexable(watch),
    anticipated: anticipatedIndexable(anticipated),
    watchUpdatedAtIso: watch.updatedAtIso,
    authors: authorDirectory.authors.map((author) => ({
      path: author.href,
      lastmod: author.latestDateIso,
    })),
  };
}

interface StaticSpec {
  path: string;
  changefreq: string;
  priority: number;
  eligible: boolean;
  /** Data real da ultima mudanca do que o hub lista; `null` quando nao ha uma honesta. */
  lastmod: string | null;
}

/** O ISO mais recente da lista, ou `null`. ISO em UTC compara como texto. */
function latestIso(values: readonly (string | null)[]): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (value !== null && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

/**
 * As rotas estaticas elegiveis, com `lastmod`.
 *
 * Sem `hubs`, os hubs que dependem do loader da pagina (pessoas, onde assistir,
 * em breve, autores) ficam de fora: e o uso do INDEX, que so precisa saber se o
 * shard existe e nao deve pagar essas leituras a cada visita de crawler. O shard
 * passa `hubs` e lista tudo.
 *
 * `lastmod` so com data real (auditoria de SEO: "static-1 sem lastmod"): o hub de
 * filmes muda quando um filme listavel muda; a home, quando qualquer lista dela
 * muda. A listagem de pessoas fica sem data: o maximo que o sitemap conhece e o
 * das pessoas que passam o portao D2, e a listagem mostra todas.
 */
export function eligibleStaticRoutes(
  counts: Record<EntitySitemapType, number>,
  maxLastmod: Record<EntitySitemapType, Date | null>,
  hubs?: StaticHubDecisions,
): SitemapXmlUrl[] {
  const moviesIdx = evaluateEntityIndexIndexability({ itemCount: counts.movies }).decision === "index";
  const seriesIdx = evaluateEntityIndexIndexability({ itemCount: counts.series }).decision === "index";
  const newsIdx = evaluateNewsIndexIndexability({ itemCount: counts.news }).decision === "index";
  const homeIdx =
    evaluatePortalIndexability({
      populatedSectionCount: countPopulatedSections([counts.movies, counts.series, counts.news]),
    }).decision === "index";
  const exploreIdx =
    evaluatePortalIndexability({
      populatedSectionCount: countPopulatedSections([counts.movies, counts.series, counts.people, counts.news]),
    }).decision === "index";

  const movies = isoOrNull(maxLastmod.movies);
  const series = isoOrNull(maxLastmod.series);
  const news = isoOrNull(maxLastmod.news);

  const specs: StaticSpec[] = [
    { path: HOME_PATH, changefreq: "weekly", priority: 0.8, eligible: homeIdx, lastmod: latestIso([movies, series, news]) },
    { path: MOVIES_INDEX_PATH, changefreq: "weekly", priority: 0.7, eligible: moviesIdx, lastmod: movies },
    { path: SERIES_INDEX_PATH, changefreq: "weekly", priority: 0.7, eligible: seriesIdx, lastmod: series },
    { path: PEOPLE_INDEX_PATH, changefreq: "weekly", priority: 0.7, eligible: hubs?.people === true, lastmod: null },
    { path: NEWS_INDEX_PATH, changefreq: "daily", priority: 0.7, eligible: newsIdx, lastmod: news },
    { path: EXPLORE_PATH, changefreq: "weekly", priority: 0.6, eligible: exploreIdx, lastmod: latestIso([movies, series]) },
    {
      path: WATCH_PATH,
      changefreq: "daily",
      priority: 0.6,
      eligible: hubs?.watch === true,
      lastmod: hubs?.watchUpdatedAtIso ?? null,
    },
    { path: ANTICIPATED_PATH, changefreq: "daily", priority: 0.6, eligible: hubs?.anticipated === true, lastmod: null },
  ];

  // Autores: a listagem entra quando ha autor com materia no ar (a MESMA regra do
  // robots dela), e cada pagina de autor entra com a data da materia mais recente.
  const authors = hubs?.authors ?? [];
  specs.push({
    path: AUTHORS_INDEX_PATH,
    changefreq: "weekly",
    priority: 0.4,
    eligible: authors.length > 0,
    lastmod: latestIso(authors.map((author) => author.lastmod)),
  });
  for (const author of authors) {
    specs.push({ path: author.path, changefreq: "weekly", priority: 0.4, eligible: true, lastmod: author.lastmod });
  }

  // Paginas institucionais: texto fixo, sem banco, `index` sempre que o ambiente
  // indexa (o gate de ambiente e o mesmo das demais). Entram so no SHARD, como os
  // hubs acima — o INDEX decide a existencia do shard pelas contagens, e a prova
  // de fail-closed (banco fora = index sem entradas) continua valendo. Sem
  // `lastmod`: um texto sem registro de mudanca nao tem data honesta.
  if (hubs !== undefined) {
    for (const path of [ABOUT_PATH, EDITORIAL_POLICY_PATH, SCORE_METHODOLOGY_PATH, CONTACT_PATH]) {
      specs.push({ path, changefreq: "monthly", priority: 0.3, eligible: true, lastmod: null });
    }
  }

  const urls: SitemapXmlUrl[] = [];
  for (const spec of specs) {
    if (!spec.eligible) continue;
    const loc = canonicalPublicUrl(spec.path);
    if (loc === null) continue;
    urls.push({ loc, lastmod: spec.lastmod, changefreq: spec.changefreq, priority: spec.priority });
  }
  return urls;
}

async function allEntityCounts(
  prisma: PrismaClient,
  language: string,
  coverage: DecisionCoverage,
): Promise<{
  counts: Record<EntitySitemapType, number>;
  maxLastmod: Record<EntitySitemapType, Date | null>;
  /** Tipos cuja contagem FALHOU: saem do index, e so eles. */
  unavailable: EntitySitemapType[];
}> {
  const counts = {} as Record<EntitySitemapType, number>;
  const maxLastmod = {} as Record<EntitySitemapType, Date | null>;
  const unavailable: EntitySitemapType[] = [];
  // Tipo suspenso fica em ZERO, e nao `undefined`: `eligibleStaticRoutes` le
  // este mapa por chave, e um `undefined` tipado como `number` atravessaria o
  // typecheck para explodir so no render.
  for (const type of SUPPORTED_ENTITY_TYPES) {
    counts[type] = 0;
    maxLastmod[type] = null;
  }
  // Uma consulta de CONTAGEM (+max) por tipo PUBLICADO — nunca busca URLs, e
  // nunca conta o que nao vai ao sitemap.
  //
  // Cada tipo no SEU try (2026-09-11). Antes, a excecao de uma unica contagem
  // atravessava ate o catch do index e o sitemap inteiro saia vazio por causa de
  // um tipo. Agora a consulta que falha tira do index SO o seu tipo — e se o
  // banco inteiro caiu, todos falham um a um e o resultado converge para vazio
  // pelo motivo certo.
  for (const type of ENTITY_TYPES) {
    try {
      const agg = await aggregateEntity(prisma, type, language, coverage);
      counts[type] = agg.count;
      maxLastmod[type] = agg.maxLastmod;
    } catch (error) {
      console.error(
        `[sitemap] a contagem do tipo ${type} falhou; SO este tipo sai do index, os demais seguem:`,
        error,
      );
      unavailable.push(type);
    }
  }
  return { counts, maxLastmod, unavailable };
}

function shardId(language: string, type: string, page: number): string {
  return `sitemap-${language}-${type}-${page}`;
}

function shardCountFor(total: number, limit: number): number {
  return total <= 0 ? 0 : Math.ceil(total / limit);
}

// ---------------------------------------------------------------------------
// /sitemap.xml — INDEX (so contagens; gera enderecos de shard, nao busca URLs).
// ---------------------------------------------------------------------------

export async function getSitemapIndexXml(
  opts?: SitemapPageOptions,
  client?: PrismaClient,
): Promise<SitemapXmlResponse> {
  const limit = resolveLimit(opts);
  const language = SITEMAP_LANGUAGE;
  try {
    const prisma = client ?? getPrismaClient();
    // A COBERTURA vem ANTES de qualquer contagem: e ela que decide o que uma
    // decisao ausente significa em todas as consultas seguintes. Se ELA falhar,
    // nenhum tipo pode ser contado com a regra certa — e o unico caso em que o
    // index inteiro ainda sai vazio (catch abaixo).
    const coverage = await readDecisionCoverage(prisma, language);
    warnUnarmedGates(coverage);
    const { counts, maxLastmod, unavailable } = await allEntityCounts(prisma, language, coverage);

    // TETO POR TIPO: antes de anunciar um shard sequer. Ver SITEMAP_TYPE_URL_CEILING.
    // So entra na avaliacao quem conseguiu ser contado; tipo `unavailable` ja
    // ficou fora pelo catch da propria contagem.
    const publishedCounts: Record<string, number> = {};
    for (const type of ENTITY_TYPES) {
      if (!unavailable.includes(type)) publishedCounts[type] = counts[type];
    }
    const ceilingReport = evaluateSitemapCeilings(publishedCounts, SITEMAP_TYPE_URL_CEILING);
    logCeilingReport(ceilingReport);

    const entries: SitemapIndexXmlEntry[] = [];
    for (const type of ENTITY_TYPES) {
      // Fora do index: tipo cuja contagem falhou ou que estourou o SEU teto. Os
      // demais seguem — a correcao de 2026-09-11 inteira mora nesta linha.
      if (!ceilingReport.published.includes(type)) continue;
      const shards = shardCountFor(counts[type], limit);
      const lastmod = isoOrNull(maxLastmod[type]);
      for (let page = 1; page <= shards; page += 1) {
        entries.push({
          loc: `${SITE_URL}/sitemaps/${shardId(language, type, page)}.xml`,
          lastmod,
        });
      }
    }
    // Shard estatico (lista fixa pequena) — um unico shard quando ha rota elegivel.
    // O index decide a EXISTENCIA pelas contagens; os hubs que dependem do loader
    // da propria pagina so sao consultados ao montar o shard.
    const staticRoutes = eligibleStaticRoutes(counts, maxLastmod);
    if (staticRoutes.length > 0) {
      entries.push({
        loc: `${SITE_URL}/sitemaps/${shardId(language, "static", 1)}.xml`,
        lastmod: latestIso(staticRoutes.map((route) => route.lastmod ?? null)),
      });
    }

    return { xml: renderSitemapIndex(entries), contentType: SITEMAP_CONTENT_TYPE };
  } catch (error) {
    // FAIL-CLOSED GLOBAL so para o que afeta TODOS os tipos: o cliente do banco e
    // a cobertura de decisoes. Falha de UM tipo nao chega aqui — ela e isolada em
    // `allEntityCounts`, e teto estourado e isolado pelo relatorio acima.
    console.error("[sitemap] falha ao montar o sitemap index; fail-closed (index vazio):", error);
    return { xml: renderSitemapIndex([]), contentType: SITEMAP_CONTENT_TYPE, degraded: true };
  }
}

// ---------------------------------------------------------------------------
// /sitemaps/{id}.xml — SHARD (uma pagina, um tipo, LIMIT/OFFSET no banco).
// ---------------------------------------------------------------------------

/** Validacao ESTRITA do id do shard. Retorna null (=> 404) para qualquer desvio. */
export function parseShardId(
  raw: string,
): { language: string; type: string; page: number } | null {
  if (!raw.endsWith(".xml")) return null;
  const id = raw.slice(0, -".xml".length);
  const match =
    /^sitemap-(pt-BR)-(movies|series|people|news|seasons|episodes|imagens|videos|static)-(\d+)$/.exec(
      id,
    );
  if (match === null) return null;
  const language = match[1];
  const type = match[2];
  const pageStr = match[3];
  if (language === undefined || type === undefined || pageStr === undefined) return null;
  // Sem zeros a esquerda / texto extra: a forma canonica do numero deve casar.
  if (String(Number(pageStr)) !== pageStr) return null;
  const page = Number(pageStr);
  if (!Number.isInteger(page) || page < 1) return null;
  if (language !== SITEMAP_LANGUAGE) return null; // idioma nao publicado no sitemap
  if (!ALL_TYPES.includes(type)) return null;
  return { language, type, page };
}

export async function getSitemapShardXml(
  rawShardId: string,
  opts?: SitemapPageOptions,
  client?: PrismaClient,
): Promise<SitemapXmlResponse | null> {
  const parsed = parseShardId(rawShardId);
  if (parsed === null) return null; // shard invalido -> 404
  const limit = resolveLimit(opts);
  const { language, type, page } = parsed;

  try {
    const prisma = client ?? getPrismaClient();
    // A MESMA cobertura que o index usa. Se o shard decidisse por conta propria
    // (ou nao decidisse), o index anunciaria N shards que a pagina nao consegue
    // preencher — a forma mais cara de sitemap errado.
    const coverage = await readDecisionCoverage(prisma, language);

    if (type === "static") {
      if (page !== 1) return null; // so existe 1 shard estatico
      const [{ counts, maxLastmod }, hubs] = await Promise.all([
        allEntityCounts(prisma, language, coverage),
        (opts?.staticHubDecisions ?? defaultStaticHubDecisions)(),
      ]);
      const routes = eligibleStaticRoutes(counts, maxLastmod, hubs);
      if (routes.length === 0) return null;
      return { xml: renderUrlset(routes), contentType: SITEMAP_CONTENT_TYPE };
    }

    const entityType = type as EntitySitemapType;
    // Uma contagem (deste tipo) para saber quantos shards existem.
    const { count } = await aggregateEntity(prisma, entityType, language, coverage);
    // O MESMO teto que o index aplica, pela mesma funcao. Se so o index cortasse,
    // o shard de um tipo estourado continuaria servindo URLs para quem guardou o
    // endereco — o index e o shard descreveriam sitemaps diferentes.
    const ceiling = evaluateSitemapTypeCeiling(
      entityType,
      count,
      SITEMAP_TYPE_URL_CEILING[entityType],
    );
    if (ceiling.excluded) {
      console.error(`[sitemap] ${describeSitemapCeilingVerdict(ceiling)}`);
      return null;
    }
    const shards = shardCountFor(count, limit);
    if (page > shards) return null; // pagina acima do total -> 404

    // SO a pagina pedida, deste tipo: LIMIT/OFFSET no banco.
    const offset = (page - 1) * limit;
    const urls =
      entityType === "seasons" || entityType === "episodes"
        ? await pageSeasonEpisode(prisma, entityType, language, limit, offset, coverage)
        : entityType === "imagens" || entityType === "videos"
          ? await pageGallery(prisma, entityType, language, limit, offset, coverage)
          : pageRowsToUrls(
              entityType,
              await pageEntity(prisma, entityType, language, limit, offset, coverage),
              await imageAuthorizationFor(prisma, entityType),
            );
    return { xml: renderUrlset(urls), contentType: SITEMAP_CONTENT_TYPE };
  } catch (error) {
    // FAIL-CLOSED: erro de banco -> nao publica URLs incertas (404).
    console.error(`[sitemap] falha ao montar shard ${rawShardId}; fail-closed (404):`, error);
    return null;
  }
}
