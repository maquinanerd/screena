/**
 * validate-supersede-carries-rows.ts — Prova, em PostgreSQL 16 REAL e efemero,
 * que um `supersede` de licenca NAO apaga a coluna direita do site.
 *
 * O DEFEITO QUE ELE TRAVA (producao, 2026-08-20):
 *
 *   legal sources apply --confirm  ->  licencas: supersede=72
 *   antes:  AVALIACOES · IMDb 8,4   ONDE ASSISTIR · HBO Max   (453 notas, 874 ofertas)
 *   depois: coluna direita VAZIA — com `display_allowed` inalterado no banco.
 *
 * A causa nao era a coluna: `external_ratings.data_usage_decision_id` e
 * `watch_availability.data_usage_decision_id` guardam o id de uma LINHA de
 * `data_usage_decisions`. O supersede desativava essa linha e criava outra, com
 * id novo, sem repontuar o dado. Os gates de leitura
 * (`apps/web/src/server/entity-ratings.ts`, `.../entity-watch.ts`) exigem
 * `is_current` na decisao E na licenca-mae — as duas viraram false.
 *
 * POR QUE UM VALIDADOR NOVO, E NAO MAIS UM CHECK NO DE SUPERSEDE. O ponto cego
 * era a ORDEM DA FIXTURE, nao a falta de fixture. Aquele validador promove as
 * notas DEPOIS de aplicar a leva nova (checks 13-14) — ou seja, num estado onde
 * a orfandade nao pode acontecer, porque o dado ja nasce ligado a decisao
 * vigente. Aqui o dado e promovido ANTES, que e a situacao de producao: banco
 * com notas e ofertas na tela, e so entao a leva chega.
 *
 * O QUE ELE PROVA:
 *   1. dado promovido ANTES da leva continua exibivel DEPOIS (o carregamento);
 *   2. o ponteiro migrou de fato para a decisao nova (nao ficou no id morto);
 *   3. licenca mais restritiva OCULTA — e o `review` disse quantas linhas antes;
 *   4. CONTROLE NEGATIVO: desligar o carregamento a mao reproduz a orfandade;
 *   5. `sources rebind` conserta o estado orfao do item 4, sem tocar
 *      `display_allowed`, e e idempotente na segunda passada.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL — nunca em produto/render/producao.
 * Motor: embedded-postgres (PostgreSQL 16 real, efemero), devDependency-only.
 * Seguranca: nenhum segredo; DATABASE_URL so em memoria, mascarado; PG derrubado
 * no finally.
 *
 * Uso (a partir da raiz): pnpm validate:supersede-carries-rows
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

import { applyAuthorizationWithin, readDecisionBindings, readStaleApprovals } from "../src/apply.js";
import {
  STATIC_AUTHORIZATION,
  streamingProviderEntries,
  AUTHORIZATION_REASON,
  DECIDED_BY,
  type AuthorizationEntry,
} from "../src/authorization-spec.js";
import { planAuthorizationImpact } from "../src/impact.js";
import { planAuthorization } from "../src/plan.js";
import { applyRebindWithin, readRebindPlan } from "../src/rebind.js";
import { renderImpact } from "../src/report.js";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");

interface CheckResult { n: number; name: string; ok: boolean; detail: string }
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n}. ${name} — ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      if (port <= 0) {
        srv.close(() => reject(new Error("nao foi possivel reservar uma porta TCP valida")));
        return;
      }
      srv.close(() => resolve(port));
    });
  });
}

function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  if (rel === undefined) throw new Error("prisma/package.json sem entrada bin.prisma");
  return path.join(path.dirname(pkgPath), rel);
}

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/**
 * Recorte enxuto: a licença de rating do IMDb + a do agregador de streaming.
 * As demais fontes não acrescentam nada à propriedade sob teste e só alongam o
 * plano.
 */
function subset(entries: readonly AuthorizationEntry[]): readonly AuthorizationEntry[] {
  return entries.filter(
    (e) =>
      (e.license.contentType === "rating" && e.license.sourceKey === "imdb") ||
      e.license.contentType === "watch_availability",
  );
}

/** O provedor canônico usado pela oferta do teste (existe na allowlist de marca). */
const PROVIDER_SLUG = "netflix";
const PROVIDER_NAME = "Netflix";
/** Fornecedor TÉCNICO da oferta (nunca o provedor; invariante 2). */
const OFFER_PROVIDER_API = "streaming_availability";
const OFFER_EXTERNAL_KEY = "netflix";

/** A leva ANTERIOR: mesma forma, versão de política recuada => força supersede. */
function previousLeva(entries: readonly AuthorizationEntry[]): readonly AuthorizationEntry[] {
  return entries.map((entry) => ({
    ...entry,
    license: { ...entry.license, policyVersion: "cinerie-source-auth/2026-07-v0" },
    decisions: entry.decisions.map((d) => ({ ...d, policyVersion: "cinerie-source-auth/2026-07-v0" })),
  }));
}

/**
 * Leva mais RESTRITIVA: a licença de rating deixa de permitir exibição.
 *
 * A entrada de rating fica com UMA decisão: `rating_display` rebaixada. As
 * demais decisões daquela licença são REMOVIDAS, não rebaixadas — o guard
 * `data_usage_decision_guard` proíbe uma decisão conceder `display_allowed`
 * além da licença-mãe, e `assertNoBlockedGrants` exige que
 * `cinerie_score_display`, SE existir, esteja na forma exata que o proprietário
 * autorizou. Uma licença que não exibe não carrega decisão de exibição.
 */
function restrictiveLeva(entries: readonly AuthorizationEntry[]): readonly AuthorizationEntry[] {
  return entries.map((entry) => {
    if (entry.license.contentType !== "rating") return entry;
    return {
      ...entry,
      license: { ...entry.license, displayAllowed: false, policyVersion: "cinerie-source-auth/2026-09-v3" },
      decisions: entry.decisions
        .filter((d) => (d.useCase as string) === "rating_display")
        .map((d) => ({
          ...d,
          displayAllowed: false,
          stage: "approved_for_internal_use" as const,
          policyVersion: "cinerie-source-auth/2026-09-v3",
        })),
    };
  });
}

const IDENTITY = { reviewer: DECIDED_BY, reason: AUTHORIZATION_REASON };

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const q = async <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = async (sql: string): Promise<void> => {
    await prisma.$executeRawUnsafe(sql);
  };
  const count = async (tail: string): Promise<number> =>
    Number((await q<{ n: bigint }>(`SELECT count(*)::int AS n ${tail}`))[0]!.n);

  /**
   * A pergunta que a PÁGINA faz — espelho do gate de leitura, não do de escrita.
   * É esta contagem que caiu para zero em produção, com `display_allowed` intacto.
   */
  const NA_TELA_NOTAS = `FROM external_ratings r
      JOIN data_usage_decisions d ON d.id = r.data_usage_decision_id
      JOIN source_licenses l ON l.id = d.source_license_id
     WHERE r.display_allowed AND d.is_current AND d.stage='approved_for_display' AND d.display_allowed
       AND l.is_current AND l.content_type='rating' AND l.rating_source_key = r.rating_source
       AND l.display_allowed AND l.score_allowed
       AND l.license_status IN ('official','licensed','third_party')`;
  const NA_TELA_OFERTAS = `FROM watch_availability w
      JOIN data_usage_decisions d ON d.id = w.data_usage_decision_id
      JOIN source_licenses l ON l.id = d.source_license_id
     WHERE w.display_allowed AND d.is_current AND d.stage='approved_for_display' AND d.display_allowed
       AND l.is_current AND l.content_type='watch_availability' AND l.display_allowed
       AND l.license_status IN ('official','licensed','third_party')`;

  try {
    // ============ 0. PROVEDOR CANONICO: a oferta precisa de um ============
    //
    // A licenca de streaming nasce POR PROVEDOR (`streamingProviderEntries`), e o
    // guard da oferta exige `l.source_key = p.slug` via alias. Sem registrar o
    // provedor, a superficie de ofertas nao seria exercitada — e ela e METADE do
    // que sumiu da tela em producao.
    await exec(
      `INSERT INTO watch_providers (canonical_name, slug, homepage_url, updated_at)
       VALUES ('${PROVIDER_NAME}','${PROVIDER_SLUG}','https://www.netflix.com', now())`,
    );
    const providerId = Number(
      (await q<{ id: bigint }>(`SELECT id FROM watch_providers WHERE slug='${PROVIDER_SLUG}'`))[0]!.id,
    );
    await exec(
      `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at)
       VALUES (${providerId},'${OFFER_PROVIDER_API}','${OFFER_EXTERNAL_KEY}','${PROVIDER_NAME}', now())`,
    );

    const entries = [
      ...subset(STATIC_AUTHORIZATION),
      ...streamingProviderEntries([{ slug: PROVIDER_SLUG, canonicalName: PROVIDER_NAME }]),
    ];

    // ============ 1. ESTADO DE PRODUCAO: leva anterior JA aplicada ============
    await prisma.$transaction(async (tx) => {
      await applyAuthorizationWithin(tx, previousLeva(entries), IDENTITY);
    });
    const licVigentes = await count(`FROM source_licenses WHERE is_current`);
    const decVigentes = await count(`FROM data_usage_decisions WHERE is_current`);
    record(1, "leva ANTERIOR aplicada (licencas e decisoes vigentes)",
      licVigentes > 0 && decVigentes > 0, `licencas=${licVigentes} decisoes=${decVigentes}`);

    // ============ 2. DADO NA TELA — promovido ANTES da leva nova ============
    //
    // Esta e a ORDEM que faltava. Em producao o banco ja tinha 453 notas e 874
    // ofertas exibindo quando o apply chegou. O validador anterior promovia
    // DEPOIS, e por isso a orfandade era literalmente impossivel na fixture.
    const movieId = Number(
      (await q<{ id: bigint }>(
        `INSERT INTO movies (tmdb_id, title_original, updated_at)
         VALUES (930001,'Filme com Nota e Oferta',now()) RETURNING id`,
      ))[0]!.id,
    );

    await exec(
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type,
         rating_value, rating_scale, rating_url, provider_api, license_status, requires_attribution,
         requires_linkback, attribution_text, attribution_url, fetched_at, updated_at)
       VALUES ('movie',${movieId},'imdb','IMDb','audience','audience',8.4,10,
         'https://www.imdb.com/title/tt0111161/','omdb','third_party',true,true,
         'Nota fornecida por IMDb','https://www.imdb.com/title/tt0111161/', now(), now())`,
    );
    await exec(
      `UPDATE external_ratings r SET display_allowed=true, reviewed_at=now(), reviewed_by='ana@cinerie',
         data_usage_decision_id=(SELECT d.id FROM data_usage_decisions d JOIN source_licenses l ON l.id=d.source_license_id
           WHERE d.use_case='rating_display' AND d.is_current AND d.stage='approved_for_display'
             AND l.rating_source_key='imdb' AND l.is_current AND l.content_type='rating'
             AND (d.territory IS NULL OR d.territory='BR') ORDER BY (d.territory IS NOT NULL) DESC LIMIT 1),
         approved_payload_hash=external_rating_payload_fingerprint_v1(r.entity_type,r.entity_id,r.rating_source,r.metric,
           r.score_type,r.rating_label,r.rating_value,r.rating_scale,r.rating_count,r.rating_url,r.provider_api,
           r.license_status,r.requires_attribution,r.requires_linkback,r.attribution_text,r.attribution_url)
       WHERE r.entity_id=${movieId}`,
    );

    await exec(
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_key, provider_name,
         offer_type, deep_link, web_url, provider_api, license_status, requires_attribution, requires_linkback,
         attribution_text, attribution_url, fetched_at, updated_at)
       VALUES ('movie',${movieId},'BR','${OFFER_EXTERNAL_KEY}','${PROVIDER_NAME}','subscription',
         'https://www.netflix.com/title/70000','https://www.netflix.com/title/70000','${OFFER_PROVIDER_API}',
         'third_party',true,true,'Disponibilidade fornecida por Movie of the Night',
         'https://www.movieofthenight.com/', now(), now())`,
    );
    await exec(
      `UPDATE watch_availability w SET display_allowed=true, reviewed_at=now(), reviewed_by='ana@cinerie',
         watch_provider_id=(SELECT a.provider_id FROM watch_provider_aliases a
           WHERE a.provider_api=w.provider_api AND a.external_key=w.provider_key),
         data_usage_decision_id=(SELECT d.id FROM data_usage_decisions d
           JOIN source_licenses l ON l.id=d.source_license_id
           JOIN watch_provider_aliases a ON a.provider_api=w.provider_api AND a.external_key=w.provider_key
           JOIN watch_providers p ON p.id=a.provider_id
           WHERE d.use_case='watch_offer_display' AND d.is_current AND d.stage='approved_for_display'
             AND d.display_allowed AND l.is_current AND l.content_type='watch_availability'
             AND l.source_key=p.slug AND l.provider_key=w.provider_api AND l.display_allowed
             AND (d.territory IS NULL OR d.territory=w.country_code)
           ORDER BY (d.territory IS NOT NULL) DESC, d.id DESC LIMIT 1),
         approved_payload_hash=watch_offer_payload_fingerprint_v1(w.provider_api,w.external_offer_id,w.entity_type,
           w.entity_id,w.country_code,w.offer_type,w.provider_key,w.provider_name,w.package,w.quality,w.price,
           w.currency,w.deep_link,w.web_url,w.available_from,w.available_until,w.license_status,
           w.requires_attribution,w.requires_linkback,w.attribution_text,w.attribution_url)
       WHERE w.entity_id=${movieId}`,
    );

    const notasAntes = await count(NA_TELA_NOTAS);
    const ofertasAntes = await count(NA_TELA_OFERTAS);
    record(2, "ANTES da leva nova: nota E oferta na tela",
      notasAntes === 1 && ofertasAntes === 1, `notas=${notasAntes} ofertas=${ofertasAntes}`);

    // ============ 3. O REVIEW DIZ O QUE VAI ACONTECER, ANTES ============
    const estadoAntes = await readCurrent(prisma);
    const planNovo = planAuthorization(entries, estadoAntes.licenses, estadoAntes.decisions);
    const impactoCarrega = planAuthorizationImpact(planNovo, await readDecisionBindings(prisma));
    record(3, "review da leva COMPATIVEL anuncia CARREGAR, e ocultar ZERO",
      planNovo.summary.licensesSupersede > 0 &&
        impactoCarrega.summary.hiddenRatings === 0 &&
        impactoCarrega.summary.hiddenOffers === 0 &&
        impactoCarrega.summary.carriedRatings === notasAntes &&
        impactoCarrega.summary.carriedOffers === ofertasAntes,
      `supersede=${planNovo.summary.licensesSupersede} carrega=${impactoCarrega.summary.carriedRatings}n/${impactoCarrega.summary.carriedOffers}o oculta=${impactoCarrega.summary.hiddenRatings}n/${impactoCarrega.summary.hiddenOffers}o`);

    const decNotaAntes = Number(
      (await q<{ id: bigint }>(`SELECT data_usage_decision_id AS id FROM external_ratings WHERE entity_id=${movieId}`))[0]!.id,
    );
    const decOfertaAntes = Number(
      (await q<{ id: bigint }>(`SELECT data_usage_decision_id AS id FROM watch_availability WHERE entity_id=${movieId}`))[0]!.id,
    );

    // ============ 4-6. O APPLY: supersede COM dado no banco ============
    await prisma.$transaction(async (tx) => {
      await applyAuthorizationWithin(tx, entries, IDENTITY);
    });
    const notasDepois = await count(NA_TELA_NOTAS);
    const ofertasDepois = await count(NA_TELA_OFERTAS);
    record(4, "DEPOIS do supersede: a nota E a oferta CONTINUAM na tela",
      notasDepois === notasAntes && ofertasDepois === ofertasAntes,
      `notas ${notasAntes}->${notasDepois}, ofertas ${ofertasAntes}->${ofertasDepois}`);

    const decNotaDepois = Number(
      (await q<{ id: bigint }>(`SELECT data_usage_decision_id AS id FROM external_ratings WHERE entity_id=${movieId}`))[0]!.id,
    );
    const decOfertaDepois = Number(
      (await q<{ id: bigint }>(`SELECT data_usage_decision_id AS id FROM watch_availability WHERE entity_id=${movieId}`))[0]!.id,
    );
    const vigente = async (id: number): Promise<boolean> =>
      (await count(`FROM data_usage_decisions WHERE id=${id} AND is_current`)) === 1;
    record(5, "os PONTEIROS migraram para as decisoes novas (nao ficaram no id morto)",
      decNotaDepois !== decNotaAntes && decOfertaDepois !== decOfertaAntes &&
        (await vigente(decNotaDepois)) && (await vigente(decOfertaDepois)),
      `nota ${decNotaAntes}->${decNotaDepois} · oferta ${decOfertaAntes}->${decOfertaDepois} (ambas vigentes)`);

    record(6, "display_allowed NAO foi tocado pelo carregamento",
      (await count(`FROM external_ratings WHERE display_allowed`)) === 1 &&
        (await count(`FROM watch_availability WHERE display_allowed`)) === 1,
      "1 nota e 1 oferta seguem com display_allowed=true");

    // ============ 7-9. CONTROLE NEGATIVO: a orfandade, reproduzida ============
    //
    // Refaz o que o apply fazia ANTES da correcao: desativa a decisao SEM
    // repontuar a linha. Se isto NAO derrubar a nota, o gate de leitura afrouxou
    // e a prova acima nao vale nada.
    await exec(`UPDATE data_usage_decisions SET is_current=false WHERE id IN (${decNotaDepois}, ${decOfertaDepois})`);
    const notasOrfas = await count(NA_TELA_NOTAS);
    const ofertasOrfas = await count(NA_TELA_OFERTAS);
    record(7, "controle negativo: sem repontuar, nota e oferta SOMEM da tela",
      notasOrfas === 0 && ofertasOrfas === 0,
      `na tela com a decisao desativada: ${notasOrfas} nota(s), ${ofertasOrfas} oferta(s) (esperado 0 e 0)`);
    record(8, "controle negativo: e display_allowed continua true (a coluna nunca foi o portao)",
      (await count(`FROM external_ratings WHERE display_allowed`)) === 1 &&
        (await count(`FROM watch_availability WHERE display_allowed`)) === 1,
      "display_allowed=true intacto — exatamente o que producao mediu (453/874)");

    /**
     * O estado orfao NAO e alcancavel por UPDATE direto: o guard de escrita
     * recusa apontar uma linha exibivel para uma decisao morta. Ele so surge por
     * BAIXO — quando a decisao que a linha JA apontava sai de cena. Isso e um
     * fato operacional que importa: o unico caminho que produzia a orfandade era
     * o apply.
     */
    let recusa = "";
    try {
      await exec(`UPDATE external_ratings SET data_usage_decision_id=${decNotaAntes} WHERE entity_id=${movieId}`);
    } catch (e) {
      recusa = (e as Error).message.replace(/\s+/g, " ").trim();
    }
    record(9, "o guard recusa APONTAR para decisao morta (a orfandade so vem por baixo)",
      recusa.toLowerCase().includes("nao e a vigente"),
      recusa === "" ? "PASSOU: o guard aceitou um ponteiro morto" : recusa.slice(0, 110));

    // ============ 10-12. O CONSERTO: sources rebind ============
    //
    // Recria o estado EXATO de producao: decisao nova vigente existe, e a linha
    // continua apontando para a antiga (morta). Clonar a decisao morta sob a
    // MESMA licenca vigente e a forma mais fiel de chegar la sem reimplementar o
    // apply defeituoso.
    for (const dead of [decNotaDepois, decOfertaDepois]) {
      await exec(
        `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed,
           storage_allowed, derivative_allowed, attribution_required, linkback_required, valid_from,
           policy_version, decided_by, reason, is_current, supersedes_id, updated_at)
         SELECT d.source_license_id, d.use_case, d.territory, d.stage, d.display_allowed, d.storage_allowed,
                d.derivative_allowed, d.attribution_required, d.linkback_required, now(), d.policy_version,
                d.decided_by, d.reason, true, d.id, now()
           FROM data_usage_decisions d WHERE d.id = ${dead}`,
      );
    }
    const naTelaAntesDoRebind = (await count(NA_TELA_NOTAS)) + (await count(NA_TELA_OFERTAS));
    const planoRebind = await readRebindPlan(prisma);
    record(10, "rebind DIAGNOSTICA a orfandade sem escrever nada",
      naTelaAntesDoRebind === 0 &&
        planoRebind.ratings.orphaned === 1 && planoRebind.ratings.recoverable === 1 &&
        planoRebind.offers.orphaned === 1 && planoRebind.offers.recoverable === 1,
      `na tela=${naTelaAntesDoRebind} · notas orfas=${planoRebind.ratings.orphaned}/recup=${planoRebind.ratings.recoverable}` +
        ` · ofertas orfas=${planoRebind.offers.orphaned}/recup=${planoRebind.offers.recoverable}`);

    const feito = await prisma.$transaction(async (tx) => applyRebindWithin(tx));
    const notasRestauradas = await count(NA_TELA_NOTAS);
    const ofertasRestauradas = await count(NA_TELA_OFERTAS);
    record(11, "rebind DEVOLVE nota e oferta para a tela, sem tocar display_allowed",
      feito.ratings === 1 && feito.offers === 1 &&
        notasRestauradas === 1 && ofertasRestauradas === 1 &&
        (await count(`FROM external_ratings WHERE display_allowed`)) === 1,
      `repontuadas=${feito.ratings}n/${feito.offers}o · na tela=${notasRestauradas}n/${ofertasRestauradas}o`);

    const feitoDeNovo = await prisma.$transaction(async (tx) => applyRebindWithin(tx));
    record(12, "rebind e IDEMPOTENTE (segunda passada nao toca em nada)",
      feitoDeNovo.ratings === 0 && feitoDeNovo.offers === 0,
      `segunda passada: ${feitoDeNovo.ratings} nota(s), ${feitoDeNovo.offers} oferta(s)`);

    // ============ 13-15. LEVA RESTRITIVA: oculta, mas AVISA antes ============
    const estado = await readCurrent(prisma);
    const planoRestritivo = planAuthorization(restrictiveLeva(entries), estado.licenses, estado.decisions);
    const impactoOculta = planAuthorizationImpact(planoRestritivo, await readDecisionBindings(prisma));
    const stale = await readStaleApprovals(prisma);
    console.log("\n--- o que o review imprime ANTES de escrever ---");
    console.log(renderImpact(impactoOculta, stale));
    console.log("---\n");
    record(13, "review da leva RESTRITIVA anuncia a contagem que vai OCULTAR",
      impactoOculta.summary.hiddenRatings === 1 &&
        impactoOculta.summary.hiddenOffers === 0 &&
        impactoOculta.hidden.length === 1 &&
        impactoOculta.hidden[0]!.reason !== "",
      `oculta=${impactoOculta.summary.hiddenRatings} nota(s)/${impactoOculta.summary.hiddenOffers} oferta(s) · motivo="${impactoOculta.hidden[0]?.reason ?? ""}"`);

    await prisma.$transaction(async (tx) => {
      await applyAuthorizationWithin(tx, restrictiveLeva(entries), IDENTITY);
    });
    const notasFinal = await count(NA_TELA_NOTAS);
    const ofertasFinal = await count(NA_TELA_OFERTAS);
    record(14, "leva RESTRITIVA oculta a nota e PRESERVA a oferta (so o que mudou muda)",
      notasFinal === 0 && ofertasFinal === 1,
      `notas=${notasFinal} (esperado 0 — licenca nova nao permite exibir) · ofertas=${ofertasFinal} (esperado 1)`);

    record(15, "e o rebind NAO 'conserta' o que foi ocultado por decisao de licenca",
      (await readRebindPlan(prisma)).ratings.recoverable === 0,
      "sem decisao vigente que assuma: a nota fica fora, como a licenca manda");
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.replace(/\s+/g, " ").trim().slice(0, 300));
  } finally {
    await prisma.$disconnect();
  }
}

/** Estado vigente projetado para o planejador (usa o leitor canonico do apply). */
async function readCurrent(prisma: PrismaClient): Promise<Awaited<ReturnType<typeof import("../src/apply.js").readCurrentState>>> {
  const { readCurrentState } = await import("../src/apply.js");
  return readCurrentState(prisma);
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-legal-carry-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: false });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_legal?schema=public`;
  console.log(`\n=== supersede CARREGA as linhas — PostgreSQL efemero :${port} (postgres:****) ===\n`);

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_legal");
    const env = { ...process.env, DATABASE_URL: url };
    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(-1, "migrate deploy", true, "ok");
    console.log("--- db seed ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(-2, "db seed", true, "ok");
    await runChecks(url);
  } catch (e) {
    record(0, "boot", false, (e as Error).message.replace(/\s+/g, " ").trim().slice(0, 300));
  } finally {
    if (started) {
      try { await pg.stop(); } catch { /* best-effort */ }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado ===");
  }

  const failed = results.filter((r) => !r.ok);
  const total = results.filter((r) => r.n > 0).length;
  console.log(`\nRESUMO (supersede carrega as linhas): ${total - failed.filter((f) => f.n > 0).length}/${total} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Supersede com dado no banco nao apaga a tela; leva restritiva oculta avisando antes; rebind recupera o orfao.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
