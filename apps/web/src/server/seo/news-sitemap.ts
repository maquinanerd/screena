/**
 * news-sitemap.ts — Monta o Google News sitemap a partir do PostgreSQL local.
 *
 * A DECISAO nao mora aqui: janela de 48h, teto de 1.000 e ordenacao vivem em
 * `@screena/seo` (`planNewsSitemap`), que e puro e testado. Este modulo so
 * BUSCA os candidatos e serializa.
 *
 * Zero API externa (invariante 3): le apenas o banco local.
 *
 * O predicado de publicabilidade e o MESMO do shard de noticias do sitemap
 * comum. Duplicar a regra com uma variacao qualquer faria as duas superficies
 * discordarem sobre quais materias sao publicas — e a divergencia so apareceria
 * no indice.
 */

import {
  NEWS_SITEMAP_WINDOW_MS,
  planNewsSitemap,
  renderNewsSitemap,
  SITEMAP_CONTENT_TYPE,
  type NewsSitemapCandidate,
} from "@screena/seo";

import { getPrismaClient } from "@screena/db/server";
import { MIN_ARTICLE_BODY_CHARS } from "../../lib/news-presenter";
import { NEWS_INDEX_PATH, SITE_URL, isOfficialIndexableEnvironment } from "../../lib/site";

const LANGUAGE_CODE = "pt-BR";
const PUBLICATION_NAME = "Cinerie";

interface NewsRow {
  slug: string;
  title: string;
  published_at: Date | null;
}

/**
 * Serve o Google News sitemap.
 *
 * `nowIso` e INJETADO para o teste conseguir fixar a janela. Em producao vem do
 * relogio do servidor, uma unica vez por request — chamar `Date.now()` dentro
 * do laco faria a fronteira dos 48h se mover no meio da montagem.
 */
export async function getNewsSitemapXml(
  nowIso: string = new Date().toISOString(),
): Promise<{ xml: string; contentType: string }> {
  // Ambiente nao indexavel (preview, staging) NAO publica sitemap de noticias.
  // Um arquivo vazio e a resposta honesta: existe, e valido, e nao anuncia nada.
  if (!isOfficialIndexableEnvironment(process.env)) {
    return { xml: renderNewsSitemap([], PUBLICATION_NAME), contentType: SITEMAP_CONTENT_TYPE };
  }

  let rows: NewsRow[] = [];
  try {
    const prisma = getPrismaClient();
    const since = new Date(Date.parse(nowIso) - NEWS_SITEMAP_WINDOW_MS);

    // A janela tambem entra no SQL. Nao e redundancia com `planNewsSitemap`: sem
    // ela a consulta varreria o arquivo inteiro de materias para descartar quase
    // tudo em memoria. O plano continua sendo a autoridade da regra.
    rows = await prisma.$queryRaw<NewsRow[]>`
      SELECT at.slug, at.title, COALESCE(at.published_at, a.published_at) AS published_at
      FROM article_translations at JOIN articles a ON a.id = at.article_id
      WHERE at.language_code = ${LANGUAGE_CODE}
        AND at.review_status IN ('human_reviewed','published')
        AND a.license_status IN ('official','licensed','third_party')
        AND a.display_allowed = true
        AND BTRIM(at.slug) <> '' AND BTRIM(at.title) <> ''
        AND COALESCE(at.published_at, a.published_at) <= (NOW() AT TIME ZONE 'UTC')
        AND COALESCE(at.published_at, a.published_at) >= ${since}
        AND at.index_status = 'index'
        AND LENGTH(BTRIM(COALESCE(at.body, ''))) >= ${MIN_ARTICLE_BODY_CHARS}
        AND (a.requires_attribution = false OR BTRIM(COALESCE(a.source_name, '')) <> '')
        AND (a.requires_linkback = false OR BTRIM(COALESCE(a.source_url, '')) <> '')
      ORDER BY COALESCE(at.published_at, a.published_at) DESC
      LIMIT 1000`;
  } catch {
    // FAIL-CLOSED. Banco indisponivel devolve sitemap VAZIO, nunca erro 500 nem
    // lista parcial: anunciar meia lista ao Google News e pior que nao anunciar
    // nada, porque as ausencias parecem despublicacao.
    return { xml: renderNewsSitemap([], PUBLICATION_NAME), contentType: SITEMAP_CONTENT_TYPE };
  }

  const candidates: NewsSitemapCandidate[] = rows
    .filter((row) => row.published_at !== null)
    .map((row) => ({
      loc: `${SITE_URL}${NEWS_INDEX_PATH}${row.slug}/`,
      title: row.title,
      publishedAtIso: (row.published_at as Date).toISOString(),
      language: LANGUAGE_CODE,
      // A consulta ja filtrou por `index_status = 'index'` e por todo o gate de
      // publicabilidade; o plano revalida a janela e o teto.
      decision: "index",
    }));

  const plan = planNewsSitemap(candidates, nowIso);
  return {
    xml: renderNewsSitemap(plan.entries, PUBLICATION_NAME),
    contentType: SITEMAP_CONTENT_TYPE,
  };
}
