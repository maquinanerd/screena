/**
 * Testes de governanca — Backend C (user product platform), privacidade.
 *
 * Garantem tres travas:
 *  1. Defaults seguros no schema: TODA superficie de usuario nasce privada
 *     (visibility=private), review de usuario nasce pending, snapshot de
 *     recomendacao nasce is_current=false (fail-closed).
 *  2. A user platform NAO entra no caminho de render publico: nenhum arquivo
 *     de apps/web ou apps/admin importa @screena/user-platform (superficies
 *     de usuario sao fase futura, noindex por construcao — invariante 5,
 *     caso tecnico).
 *  3. Nada de usuario vaza para o sitemap: o codigo de sitemap (packages/seo
 *     + rotas de sitemap do web) nao referencia tabelas user_*.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(ROOT, "packages", "db", "prisma", "schema.prisma");
const schema = readFileSync(SCHEMA_PATH, "utf8");

/** Extrai o corpo de um modelo (da declaracao ate seu @@map("<table>")). */
function modelBlock(tableName: string): string {
  const idx = schema.indexOf(`@@map("${tableName}")`);
  if (idx < 0) {
    return "";
  }
  const start = schema.lastIndexOf("\nmodel ", idx);
  return schema.slice(start, idx);
}

/** Verdadeiro se o corpo contem `<field> ... @default(<value>)`. */
function hasDefault(body: string, field: string, value: string): boolean {
  const re = new RegExp(
    `${field}\\b[^\\n]*@default\\(${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`,
  );
  return re.test(body);
}

function collectCodeFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (["node_modules", ".next", "dist", "build", "coverage"].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectCodeFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("user platform: defaults seguros no schema (tudo nasce privado)", () => {
  it("(1) as tabelas user_* existem no schema", () => {
    for (const t of [
      "users",
      "user_profiles",
      "user_watch_states",
      "user_lists",
      "user_reviews",
      "user_ratings",
      "user_recommendation_snapshots",
    ]) {
      expect(modelBlock(t), `tabela ${t} ausente do schema`).not.toBe("");
    }
  });

  it("(2) perfil nasce privado", () => {
    expect(hasDefault(modelBlock("user_profiles"), "visibility", "private")).toBe(true);
  });

  it("(3) watch state nasce privado", () => {
    expect(hasDefault(modelBlock("user_watch_states"), "visibility", "private")).toBe(true);
  });

  it("(4) listas nascem privadas", () => {
    expect(hasDefault(modelBlock("user_lists"), "visibility", "private")).toBe(true);
  });

  it("(5) review de usuario nasce pending + privada (fail-closed)", () => {
    const body = modelBlock("user_reviews");
    expect(hasDefault(body, "status", "pending")).toBe(true);
    expect(hasDefault(body, "visibility", "private")).toBe(true);
  });

  it("(6) snapshot de recomendacao nasce is_current=false (servico promove)", () => {
    expect(hasDefault(modelBlock("user_recommendation_snapshots"), "isCurrent", "false")).toBe(
      true,
    );
  });

  it("(7) user_ratings nao referencia rating_sources/external_ratings (invariantes 1/2)", () => {
    const body = modelBlock("user_ratings");
    expect(body).not.toBe("");
    expect(body.includes("RatingSource")).toBe(false);
    expect(body.includes("ExternalRating")).toBe(false);
    expect(body.includes("provider_api")).toBe(false);
  });
});

describe("user platform: fora do caminho de render publico (invariante 5, caso tecnico)", () => {
  /**
   * A regra original proibia QUALQUER arquivo de apps/* de tocar a user platform.
   * Isso estava certo enquanto a plataforma nao tinha borda: sem endpoint, todo
   * import cairia necessariamente no caminho de render.
   *
   * C7C criou a primeira superficie legitima e NAO-render: quatro mutacoes `POST`
   * sob `/api/auth/**` (bloqueadas no robots por `Disallow: /api/`), mais a ponte
   * server-only que as compoe. A regra nao foi afrouxada — foi PARTIDA EM DUAS,
   * e cada metade ficou mais estrita do que a original:
   *
   *  - no caminho de RENDER (pagina, layout, client component) a proibicao passa
   *    a ser verificada explicitamente por natureza do arquivo, e nao por
   *    ausencia acidental de import;
   *  - fora dele, so uma ALLOWLIST fechada pode importar, e o teste trava
   *    exatamente quais caminhos sao — se um quinto arquivo aparecer, isto falha.
   */
  const AUTH_RUNTIME_ALLOWLIST: readonly string[] = [
    "apps/web/next.config.ts",
    "apps/web/src/server/auth/runtime.ts",
    "apps/web/app/api/auth/email-verification/confirm/route.ts",
    "apps/web/app/api/auth/email-verification/request/route.ts",
    "apps/web/app/api/auth/password-reset/confirm/route.ts",
    "apps/web/app/api/auth/password-reset/request/route.ts",
  ];

  const PAGE_FILE_NAMES = new Set([
    "page.tsx",
    "page.ts",
    "layout.tsx",
    "layout.ts",
    "template.tsx",
    "template.ts",
    "default.tsx",
    "default.ts",
  ]);

  /** "use client" precisa ser a primeira instrucao nao vazia/nao comentada. */
  function hasUseClient(content: string): boolean {
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "") continue;
      if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
      return /^['"]use client['"];?$/.test(line);
    }
    return false;
  }

  /**
   * Detecta alcance a user platform — inclusive INDIRETO.
   *
   * A ponte `apps/web/src/server/auth/**` importa `@screena/user-platform` e,
   * por tabela, o composition root (chave da Brevo + Prisma Client). Um client
   * component que escrevesse `import { runAuthEndpoint } from
   * '../../src/server/auth/runtime'` NAO citaria nenhum dos dois primeiros
   * padroes e escaparia inteiro da guarda — arrastando segredo de servidor para
   * o bundle do navegador. O caminho da ponte entra na deteccao por isso.
   */
  function touchesUserPlatform(content: string): boolean {
    return (
      content.includes("@screena/user-platform") ||
      content.includes("services/user-platform") ||
      /["'][^"']*src\/server\/auth\//.test(content)
    );
  }

  function relative(file: string): string {
    return path.relative(ROOT, file).split(path.sep).join("/");
  }

  it("(8) a user platform NUNCA entra no caminho de render nem no admin", () => {
    const web = collectCodeFiles(path.join(ROOT, "apps", "web"));
    const admin = collectCodeFiles(path.join(ROOT, "apps", "admin"));
    expect(web.length).toBeGreaterThan(0);

    const offenders: string[] = [];

    // apps/admin continua com a proibicao TOTAL: nao ha borda de autenticacao la.
    for (const file of admin) {
      if (touchesUserPlatform(readFileSync(file, "utf8"))) {
        offenders.push(`${relative(file)} (admin)`);
      }
    }

    for (const file of web) {
      const content = readFileSync(file, "utf8");
      if (!touchesUserPlatform(content)) continue;
      const rel = relative(file);
      const base = rel.split("/").pop() ?? rel;
      // Pagina/layout e client component: proibicao ABSOLUTA, mesmo que alguem
      // acrescente o caminho a allowlist por engano.
      if (PAGE_FILE_NAMES.has(base)) offenders.push(`${rel} (arquivo de pagina)`);
      if (hasUseClient(content)) offenders.push(`${rel} (client component)`);
      if (!AUTH_RUNTIME_ALLOWLIST.includes(rel)) offenders.push(`${rel} (fora da allowlist)`);
    }

    expect(offenders).toEqual([]);
  });

  it("(8b) a allowlist e exatamente a borda /api/auth + a ponte server-only", () => {
    // Anti-vacuidade nos DOIS sentidos: os arquivos autorizados existem de fato,
    // e nenhum outro passou a importar. Sem isto, a allowlist poderia crescer em
    // silencio ou apontar para arquivos que nem existem mais.
    const web = collectCodeFiles(path.join(ROOT, "apps", "web"));
    const importadores = web
      .filter((file) => touchesUserPlatform(readFileSync(file, "utf8")))
      .map(relative)
      .sort();
    expect(importadores).toEqual([...AUTH_RUNTIME_ALLOWLIST].sort());
  });

  it("(8d) a deteccao pega tambem o alcance INDIRETO pela ponte (controle negativo)", () => {
    // Sem isto, a guarda seria falsificavel por um import relativo: o caminho
    // mais provavel de um client component alcancar Prisma e a chave da Brevo.
    expect(touchesUserPlatform(`import x from "@screena/user-platform/auth-runtime"`)).toBe(true);
    expect(touchesUserPlatform(`import x from "../../services/user-platform/src/http"`)).toBe(true);
    expect(touchesUserPlatform(`import { runAuthEndpoint } from "../../src/server/auth/runtime"`)).toBe(
      true,
    );
    expect(touchesUserPlatform(`import x from './src/server/auth/runtime'`)).toBe(true);
    // Controles POSITIVOS: server-only vizinhos que nao alcancam a plataforma.
    expect(touchesUserPlatform(`import x from "../../src/server/seo/redirect-lookup"`)).toBe(false);
    expect(touchesUserPlatform(`import x from "../../src/lib/site"`)).toBe(false);
  });

  it("(8c) as rotas /api/auth so DELEGAM: nenhuma regra de dominio nelas", () => {
    const rotas = AUTH_RUNTIME_ALLOWLIST.filter((f) => f.endsWith("route.ts"));
    expect(rotas.length).toBe(4);
    for (const rota of rotas) {
      const content = readFileSync(path.join(ROOT, rota), "utf8");
      // Sem politica, sem banco, sem fornecedor, sem segredo.
      for (const proibido of [
        /prisma/i,
        /@screena\/db/,
        /brevo/i,
        /BREVO_/,
        /process\s*\.\s*env/,
        /accountCanHoldSession|evaluateThrottle|applyPasswordReset|applyEmailVerification/,
      ]) {
        expect(proibido.test(content), `${rota}: ${proibido}`).toBe(false);
      }
      // E aceitam SOMENTE POST.
      expect(/export\s+async\s+function\s+POST/.test(content), rota).toBe(true);
      expect(/export\s+async\s+function\s+(GET|PUT|DELETE|PATCH)/.test(content), rota).toBe(false);
    }
  });

  it("(9) codigo de sitemap nao referencia tabela user_* (privado nunca entra em sitemap)", () => {
    const sitemapFiles = [
      ...collectCodeFiles(path.join(ROOT, "packages", "seo", "src")),
      ...collectCodeFiles(path.join(ROOT, "apps", "web", "app", "sitemap.xml")),
      ...collectCodeFiles(path.join(ROOT, "apps", "web", "app", "sitemaps")),
      ...collectCodeFiles(path.join(ROOT, "apps", "web", "src", "server", "seo")),
    ];
    expect(sitemapFiles.length).toBeGreaterThan(0);
    const forbidden =
      /user_lists|user_reviews|user_watch_states|user_profiles|user_ratings|userList|userReview|userWatchState|userRating/;
    const offenders = sitemapFiles.filter((file) => forbidden.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
