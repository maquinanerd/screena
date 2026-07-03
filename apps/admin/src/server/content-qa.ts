/**
 * content-qa.ts — Camada de dados do QA editorial. SERVER-ONLY, SOMENTE LEITURA.
 *
 * Le apenas o PostgreSQL local via @screena/db (Prisma): `count` + `findMany` +
 * `groupBy`, todos limitados e com ordenacao determinista. NUNCA escreve, NUNCA
 * publica, NUNCA chama API externa. A avaliacao usa os helpers PUROS de
 * `../lib/content-qa`. O resultado e seguro (categorias/severidades/score),
 * nunca o corpo/conteudo completo nem segredo.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  DEFAULT_STALE_DAYS,
  evaluateArticleQa,
  evaluateContentBlockQa,
  summarizeQaIssues,
  type QaCategory,
  type QaIssue,
  type QaSeverity,
} from "../lib/content-qa";
import { articleReadinessLabel, readinessBadgeVariant } from "../lib/public-readiness";

/** Janela de itens lida para avaliar QA (bounded). */
export const QA_WINDOW = 100;
/** Maximo de itens por lista exibida. */
export const QA_LIST_LIMIT = 25;

export interface QaArticleRow {
  id: string;
  label: string;
  score: number;
  severity: QaSeverity;
  readinessLabel: string;
  badgeVariant: string;
  primaryIssue: string | null;
  href: string;
}

export interface QaBlockRow {
  id: string;
  label: string;
  score: number;
  severity: QaSeverity;
  primaryIssue: string | null;
  href: string;
}

export interface QaDuplicateSlug {
  slug: string;
  count: number;
}

export interface QaTypeSummary {
  total: number;
  evaluated: number;
  bySeverity: Record<QaSeverity, number>;
}

export interface ContentQaData {
  overallScore: number;
  articles: QaTypeSummary;
  blocks: QaTypeSummary;
  issueCounts: Partial<Record<QaCategory, number>>;
  criticalArticles: QaArticleRow[];
  visibleNoindexArticles: QaArticleRow[];
  indexReadyArticles: QaArticleRow[];
  problemBlocks: QaBlockRow[];
  duplicateSlugs: QaDuplicateSlug[];
  window: number;
  limit: number;
}

const ORDER = [{ updatedAt: "desc" as const }, { id: "desc" as const }];

function emptySeverity(): Record<QaSeverity, number> {
  return { critical: 0, warning: 0, info: 0, success: 0 };
}

function articleLabel(title: string, id: string): string {
  const t = title.trim();
  return t !== "" ? t : `artigo #${id}`;
}

/** Chaves `${type}:${id}` das entidades que EXISTEM, entre as referenciadas. */
async function existingEntityKeys(
  prisma: ReturnType<typeof getPrismaClient>,
  blocks: ReadonlyArray<{ entityType: unknown; entityId: bigint }>,
): Promise<Set<string>> {
  const movieIds: bigint[] = [];
  const tvIds: bigint[] = [];
  const seasonIds: bigint[] = [];
  const episodeIds: bigint[] = [];
  const personIds: bigint[] = [];
  for (const b of blocks) {
    const t = String(b.entityType);
    if (t === "movie") movieIds.push(b.entityId);
    else if (t === "tv") tvIds.push(b.entityId);
    else if (t === "season") seasonIds.push(b.entityId);
    else if (t === "episode") episodeIds.push(b.entityId);
    else if (t === "person") personIds.push(b.entityId);
  }

  const [movies, shows, seasons, episodes, people] = await Promise.all([
    movieIds.length ? prisma.movie.findMany({ where: { id: { in: movieIds } }, select: { id: true } }) : Promise.resolve([]),
    tvIds.length ? prisma.tvShow.findMany({ where: { id: { in: tvIds } }, select: { id: true } }) : Promise.resolve([]),
    seasonIds.length ? prisma.season.findMany({ where: { id: { in: seasonIds } }, select: { id: true } }) : Promise.resolve([]),
    episodeIds.length ? prisma.episode.findMany({ where: { id: { in: episodeIds } }, select: { id: true } }) : Promise.resolve([]),
    personIds.length ? prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true } }) : Promise.resolve([]),
  ]);

  const keys = new Set<string>();
  for (const m of movies) keys.add(`movie:${m.id.toString()}`);
  for (const s of shows) keys.add(`tv:${s.id.toString()}`);
  for (const s of seasons) keys.add(`season:${s.id.toString()}`);
  for (const e of episodes) keys.add(`episode:${e.id.toString()}`);
  for (const p of people) keys.add(`person:${p.id.toString()}`);
  return keys;
}

export const getContentQaData = cache(async (): Promise<ContentQaData> => {
  const prisma = getPrismaClient();
  const nowIso = new Date().toISOString();

  const [articleTotal, blockTotal, articleRows, blockRows, dupGroups] = await Promise.all([
    prisma.articleTranslation.count(),
    prisma.contentBlock.count(),
    prisma.articleTranslation.findMany({
      take: QA_WINDOW,
      orderBy: ORDER,
      select: {
        id: true,
        languageCode: true,
        slug: true,
        title: true,
        body: true,
        reviewStatus: true,
        indexStatus: true,
        publishedAt: true,
        updatedAt: true,
        article: { select: { licenseStatus: true, displayAllowed: true, publishedAt: true } },
      },
    }),
    prisma.contentBlock.findMany({
      take: QA_WINDOW,
      orderBy: ORDER,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        languageCode: true,
        blockType: true,
        reviewStatus: true,
        content: true,
      },
    }),
    prisma.articleTranslation.groupBy({
      by: ["slug"],
      _count: { slug: true },
      having: { slug: { _count: { gt: 1 } } },
      orderBy: { slug: "asc" },
      take: QA_LIST_LIMIT,
    }),
  ]);

  /* ---- Artigos ---- */
  const articleSeverity = emptySeverity();
  const allIssues: QaIssue[] = [];
  const scores: number[] = [];
  const criticalArticles: QaArticleRow[] = [];
  const visibleNoindexArticles: QaArticleRow[] = [];
  const indexReadyArticles: QaArticleRow[] = [];

  for (const row of articleRows) {
    const publishedAtIso = (row.publishedAt ?? row.article.publishedAt)?.toISOString() ?? null;
    const qa = evaluateArticleQa(
      {
        reviewStatus: String(row.reviewStatus),
        licenseStatus: String(row.article.licenseStatus),
        displayAllowed: row.article.displayAllowed,
        slug: row.slug,
        title: row.title,
        publishedAtIso,
        bodyChars: (row.body ?? "").trim().length,
        indexStatus: String(row.indexStatus),
        languageCode: row.languageCode,
        updatedAtIso: row.updatedAt?.toISOString() ?? null,
      },
      { nowIso, staleDays: DEFAULT_STALE_DAYS },
    );
    const id = row.id.toString();
    const item: QaArticleRow = {
      id,
      label: articleLabel(row.title, id),
      score: qa.score,
      severity: qa.severity,
      readinessLabel: articleReadinessLabel(qa.readinessLevel),
      badgeVariant: readinessBadgeVariant(qa.readinessLevel),
      primaryIssue: qa.issues[0]?.message ?? null,
      href: `/articles/${id}`,
    };
    articleSeverity[qa.severity] += 1;
    allIssues.push(...qa.issues);
    scores.push(qa.score);
    if (qa.severity === "critical" && criticalArticles.length < QA_LIST_LIMIT) {
      criticalArticles.push(item);
    }
    if (qa.readinessLevel === "visible_noindex" && visibleNoindexArticles.length < QA_LIST_LIMIT) {
      visibleNoindexArticles.push(item);
    }
    if (qa.readinessLevel === "index_ready" && indexReadyArticles.length < QA_LIST_LIMIT) {
      indexReadyArticles.push(item);
    }
  }

  /* ---- Content blocks ---- */
  const existing = await existingEntityKeys(prisma, blockRows);
  const blockSeverity = emptySeverity();
  const problemBlocks: QaBlockRow[] = [];

  for (const row of blockRows) {
    const type = String(row.entityType);
    const entityMissing = !existing.has(`${type}:${row.entityId.toString()}`);
    const qa = evaluateContentBlockQa({
      reviewStatus: String(row.reviewStatus),
      contentChars: (row.content ?? "").length,
      languageCode: row.languageCode,
      entityMissing,
    });
    const id = row.id.toString();
    blockSeverity[qa.severity] += 1;
    allIssues.push(...qa.issues);
    scores.push(qa.score);
    if ((qa.severity === "critical" || qa.severity === "warning") && problemBlocks.length < QA_LIST_LIMIT) {
      problemBlocks.push({
        id,
        label: `${type}:${row.entityId.toString()} · ${String(row.blockType)}`,
        score: qa.score,
        severity: qa.severity,
        primaryIssue: qa.issues[0]?.message ?? null,
        href: `/content-blocks/${id}`,
      });
    }
  }

  const summary = summarizeQaIssues(allIssues);
  const overallScore =
    scores.length === 0
      ? 100
      : Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);

  const duplicateSlugs: QaDuplicateSlug[] = dupGroups.map(
    (group: { slug: string; _count: { slug: number } }) => ({
      slug: group.slug,
      count: group._count.slug,
    }),
  );

  return {
    overallScore,
    articles: { total: articleTotal, evaluated: articleRows.length, bySeverity: articleSeverity },
    blocks: { total: blockTotal, evaluated: blockRows.length, bySeverity: blockSeverity },
    issueCounts: summary.byCategory,
    criticalArticles,
    visibleNoindexArticles,
    indexReadyArticles,
    problemBlocks,
    duplicateSlugs,
    window: QA_WINDOW,
    limit: QA_LIST_LIMIT,
  };
});
