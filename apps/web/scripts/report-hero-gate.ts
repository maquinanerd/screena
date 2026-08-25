/**
 * report-hero-gate.ts — QUANTOS titulos do catalogo passam no portao do hero.
 *
 * POR QUE ESTE RELATORIO EXISTE
 * -----------------------------
 * O portao do hero (`src/lib/home-hero-eligibility.ts`) tem teste unitario com
 * controle negativo e positivo, e isso prova que a REGRA esta certa. Nao prova o
 * que o dono precisa saber antes de implantar: quantos titulos do catalogo REAL
 * sobrevivem a ela. Um portao correto que aprova zero titulos deixa a home sem
 * destaque — e a decisao (afrouxar `vote_count`? esperar ingestao de arte?)
 * depende do numero e, principalmente, do MOTIVO das recusas.
 *
 * Por isso a saida nao e um total: e a contagem por motivo. "37 passam" nao diz
 * o que fazer; "412 recusados por sem_backdrop" diz.
 *
 * USA A MESMA FUNCAO DO RENDER. `heroRejectionReason` e importada, nao
 * reescrita em SQL: um portao de mentira no relatorio daria um numero que a home
 * nao honraria.
 *
 * SOMENTE LEITURA. Apenas SELECT — nenhum INSERT/UPDATE/DELETE. E seguro rodar
 * contra producao, e e onde ele tem serventia (o catalogo de verdade). Nao roda
 * em render nem em build; zero rede, zero TMDB, zero Gemini.
 *
 * Uso:
 *   pnpm --filter @screena/web report:hero-gate
 *   pnpm --filter @screena/web report:hero-gate -- --limit 20   # amostra dos aprovados
 */

import { getPrismaClient } from "@screena/db/server";

import {
  HERO_MIN_VOTE_COUNT,
  heroRejectionReason,
  type HeroCandidateFacts,
  type HeroRejectionReason,
} from "../src/lib/home-hero-eligibility";

const LANGUAGE_CODE = "pt-BR";

/** Quantos aprovados listar por vertical na amostra. */
function parseLimit(argv: readonly string[]): number {
  const flag = argv.findIndex((a) => a === "--limit" || a.startsWith("--limit="));
  if (flag === -1) return 10;
  const raw = argv[flag]?.startsWith("--limit=")
    ? argv[flag]!.slice("--limit=".length)
    : argv[flag + 1];
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

interface Linha {
  readonly titulo: string;
  readonly facts: HeroCandidateFacts;
  readonly voteCount: number | null;
}

async function coletar(
  prisma: ReturnType<typeof getPrismaClient>,
  entityType: "movie" | "tv",
): Promise<Linha[]> {
  // O pool e o MESMO do hero: so entidade com slug canonico pt-BR.
  const slugs = await prisma.slug.findMany({
    where: { entityType, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { entityId: true },
  });
  const ids = slugs.map((s) => s.entityId);
  if (ids.length === 0) return [];

  const traducoes = await prisma.entityTranslation.findMany({
    where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
    select: { entityId: true, title: true, summary: true },
  });
  const porId = new Map(traducoes.map((t) => [t.entityId.toString(), t] as const));

  if (entityType === "movie") {
    const linhas = await prisma.movie.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        titleOriginal: true,
        releaseDate: true,
        voteCountTmdb: true,
        status: true,
        backdropPath: true,
        posterPath: true,
      },
    });
    return linhas.map((row) => {
      const t = porId.get(row.id.toString());
      return {
        titulo: t?.title ?? row.titleOriginal,
        voteCount: row.voteCountTmdb,
        facts: {
          kind: "movie" as const,
          backdropPath: row.backdropPath,
          posterPath: row.posterPath,
          voteCount: row.voteCountTmdb,
          summary: t?.summary ?? null,
          releaseDate: row.releaseDate,
          status: row.status,
        },
      };
    });
  }

  const linhas = await prisma.tvShow.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      nameOriginal: true,
      firstAirDate: true,
      voteCountTmdb: true,
      status: true,
      backdropPath: true,
      posterPath: true,
    },
  });
  return linhas.map((row) => {
    const t = porId.get(row.id.toString());
    return {
      titulo: t?.title ?? row.nameOriginal,
      voteCount: row.voteCountTmdb,
      facts: {
        kind: "series" as const,
        backdropPath: row.backdropPath,
        posterPath: row.posterPath,
        voteCount: row.voteCountTmdb,
        summary: t?.summary ?? null,
        releaseDate: row.firstAirDate,
        status: row.status,
      },
    };
  });
}

function relatar(rotulo: string, linhas: readonly Linha[], now: Date, limite: number): number {
  const aprovados: Linha[] = [];
  const porMotivo = new Map<HeroRejectionReason, number>();
  for (const linha of linhas) {
    const motivo = heroRejectionReason(linha.facts, now);
    if (motivo === null) aprovados.push(linha);
    else porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1);
  }

  process.stdout.write(`\n=== ${rotulo} ===\n`);
  process.stdout.write(`candidatos (com slug canonico pt-BR): ${linhas.length}\n`);
  process.stdout.write(`APROVADOS no portao: ${aprovados.length}\n`);

  if (porMotivo.size > 0) {
    process.stdout.write("recusados, por motivo (o primeiro que falhou):\n");
    for (const [motivo, quantos] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${motivo.padEnd(22)} ${quantos}\n`);
    }
  }

  if (aprovados.length > 0) {
    const amostra = [...aprovados]
      .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0))
      .slice(0, limite);
    process.stdout.write(`os ${amostra.length} mais votados (candidatos a destaque):\n`);
    for (const item of amostra) {
      process.stdout.write(`  ${String(item.voteCount ?? 0).padStart(7)} votos  ${item.titulo}\n`);
    }
  }
  return aprovados.length;
}

async function main(): Promise<void> {
  const limite = parseLimit(process.argv.slice(2));
  const now = new Date();
  const prisma = getPrismaClient();

  process.stdout.write(
    `portao do hero — piso de votos: ${HERO_MIN_VOTE_COUNT} · relogio: ${now.toISOString()}\n`,
  );

  const [filmes, series] = await Promise.all([coletar(prisma, "movie"), coletar(prisma, "tv")]);
  const aprovadosFilme = relatar("FILMES", filmes, now, limite);
  const aprovadosSerie = relatar("SERIES", series, now, limite);

  process.stdout.write(`\n=== TOTAL ===\n`);
  process.stdout.write(`aprovados: ${aprovadosFilme} filmes + ${aprovadosSerie} series\n`);
  // O hero exibe ate 5 slides. Menos que isso e um fato acionavel, nao um erro.
  if (aprovadosFilme + aprovadosSerie < 5) {
    process.stdout.write(
      "ATENCAO: menos de 5 aprovados no total — o carousel vai render incompleto.\n",
    );
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    // `getPrismaClient()` e memoizado no processo: esta e a MESMA instancia que
    // `main` usou, nao uma conexao nova aberta so para ser fechada.
    void getPrismaClient().$disconnect();
  });
