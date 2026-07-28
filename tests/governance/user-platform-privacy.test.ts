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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
   * C7C criou a primeira superficie legitima e NAO-render sob `/api/auth/**`; o
   * C7D a estendeu com a camada de SESSAO e PRIVACIDADE — cadastro, login,
   * logout, troca de senha e as rotas `/api/account/**`. Todas sao handlers
   * `POST`/`GET` sob `/api/` (bloqueadas no robots por `Disallow: /api/`), fora
   * do caminho de render indexavel, e todas delegam para a ponte server-only.
   *
   * A regra nao foi afrouxada — foi PARTIDA EM DUAS, e cada metade ficou mais
   * estrita do que a original:
   *
   *  - no caminho de RENDER (pagina, layout, client component) a proibicao passa
   *    a ser verificada explicitamente por natureza do arquivo, e nao por
   *    ausencia acidental de import. Nenhuma pagina/client component desta
   *    unidade importa a plataforma: as telas de conta falam com a borda por
   *    `fetch`, e o cookie de CSRF e lido por um helper que NAO toca a
   *    plataforma (`src/lib/csrf-client.ts`);
   *  - fora dele, so uma ALLOWLIST fechada pode importar, e o teste trava
   *    exatamente quais caminhos sao — se um arquivo novo aparecer, isto falha.
   */
  const AUTH_RUNTIME_ALLOWLIST: readonly string[] = [
    "apps/web/next.config.ts",
    "apps/web/src/server/auth/runtime.ts",
    // C7C — verificacao de e-mail e recuperacao de senha (publicos).
    "apps/web/app/api/auth/email-verification/confirm/route.ts",
    "apps/web/app/api/auth/email-verification/request/route.ts",
    "apps/web/app/api/auth/password-reset/confirm/route.ts",
    "apps/web/app/api/auth/password-reset/request/route.ts",
    // C7D — cadastro, login e ciclo de vida da sessao.
    "apps/web/app/api/auth/signup/route.ts",
    "apps/web/app/api/auth/login/route.ts",
    "apps/web/app/api/auth/logout/route.ts",
    "apps/web/app/api/auth/logout-all/route.ts",
    "apps/web/app/api/auth/session/route.ts",
    "apps/web/app/api/auth/password-change/route.ts",
    // C7D — conta e privacidade (autenticadas).
    "apps/web/app/api/account/profile/route.ts",
    "apps/web/app/api/account/privacy/route.ts",
    "apps/web/app/api/account/consent/route.ts",
    "apps/web/app/api/account/export/route.ts",
    "apps/web/app/api/account/close/route.ts",
    // C8 — biblioteca pessoal: watchlist, tracker, listas, notas e importacao.
    // Todas sob `/api/` (bloqueadas no robots), todas delegando a mesma ponte
    // server-only, todas com ownership pelo contexto autenticado.
    "apps/web/app/api/me/library/route.ts",
    "apps/web/app/api/me/watch-state/route.ts",
    "apps/web/app/api/me/history/route.ts",
    "apps/web/app/api/me/episodes/route.ts",
    "apps/web/app/api/me/episodes/bulk/route.ts",
    "apps/web/app/api/me/series-progress/[id]/route.ts",
    "apps/web/app/api/me/lists/route.ts",
    "apps/web/app/api/me/lists/[id]/route.ts",
    "apps/web/app/api/me/lists/[id]/items/route.ts",
    "apps/web/app/api/me/lists/[id]/reorder/route.ts",
    "apps/web/app/api/me/ratings/route.ts",
    "apps/web/app/api/me/imports/route.ts",
    "apps/web/app/api/me/imports/[id]/route.ts",
    "apps/web/app/api/me/imports/[id]/apply/route.ts",
    "apps/web/app/api/me/imports/[id]/cancel/route.ts",
    // Remocoes por POST (nao DELETE): `readJsonBody` aceita SOMENTE POST, entao
    // um handler DELETE responderia 405 em toda chamada. A guarda (8c) abaixo
    // e quem obrigou a descobrir isso antes de a rota ir para producao.
    "apps/web/app/api/me/watch-state/remove/route.ts",
    "apps/web/app/api/me/ratings/remove/route.ts",
    "apps/web/app/api/me/lists/[id]/delete/route.ts",
    "apps/web/app/api/me/lists/[id]/items/[itemId]/remove/route.ts",
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

  it("(8c) as rotas /api so DELEGAM: nenhuma regra de dominio nelas", () => {
    const rotas = AUTH_RUNTIME_ALLOWLIST.filter((f) => f.endsWith("route.ts"));
    // C7C tinha 4; C7D somou 11 (6 auth + 5 account); C8 somou 16 (biblioteca,
    // tracker, listas, notas e importacao). O total exato tambem e travado por
    // (8b) contra a allowlist inteira.
    expect(rotas.length).toBe(34);
    for (const rota of rotas) {
      const content = readFileSync(path.join(ROOT, rota), "utf8");
      // Sem politica, sem banco, sem fornecedor, sem segredo — a regra vive na
      // plataforma testada, nunca no delegador.
      for (const proibido of [
        /prisma/i,
        /@screena\/db/,
        /brevo/i,
        /BREVO_/,
        /process\s*\.\s*env/,
        /accountCanHoldSession|evaluateThrottle|applyPasswordReset|applyEmailVerification|decideLogin|decideSignup|buildSessionCreation/,
        // C8: o dominio da biblioteca tambem nao pode vazar para a rota.
        /applyWatchStateChange|applyEpisodeProgress|planReorder|validateListCreate|classifyMatch|buildImportPlan|parseCsv/,
      ]) {
        expect(proibido.test(content), `${rota}: ${proibido}`).toBe(false);
      }
      // Cada rota exporta SO metodos HTTP que delegam, e SO GET/POST: nenhuma
      // mutacao aceita PUT/DELETE/PATCH (o handler recusa qualquer outro metodo
      // com 405, mas o proprio modulo nao os declara).
      expect(
        /export\s+async\s+function\s+(GET|POST)/.test(content),
        `${rota}: precisa exportar GET ou POST`,
      ).toBe(true);
      expect(
        /export\s+async\s+function\s+(PUT|DELETE|PATCH)/.test(content),
        `${rota}: nao pode exportar PUT/DELETE/PATCH`,
      ).toBe(false);
      // Corpo do handler e uma unica delegacao ao runtime da ponte.
      // As TRES portas da ponte server-only: e-mail (C7C), autenticada (C7D) e
      // biblioteca (C8). Uma rota que nao chame nenhuma delas nao esta
      // delegando — esta implementando.
      expect(
        /run(AuthEndpoint|AuthenticatedEndpoint|LibraryEndpoint)/.test(content),
        `${rota}: deve apenas delegar a ponte`,
      ).toBe(true);
    }
  });

  it("(8e) NENHUMA pagina/client component de conta importa a plataforma (render puro)", () => {
    // Controle POSITIVO explicito das telas de C7D: elas existem e NAO tocam a
    // plataforma — falam com a borda por fetch, e o CSRF vem de um helper que
    // le so o cookie. Sem isto, uma regressao que importasse o runtime numa
    // pagina passaria despercebida ate (8) — este teste a localiza pelo nome.
    const telas = [
      "apps/web/app/pt/entrar/page.tsx",
      "apps/web/app/pt/entrar/login-form.tsx",
      "apps/web/app/pt/criar-conta/signup-form.tsx",
      "apps/web/app/pt/conta/settings-panel.tsx",
      "apps/web/app/pt/conta/privacidade/privacy-panel.tsx",
      "apps/web/src/lib/csrf-client.ts",
    ];
    for (const tela of telas) {
      const abs = path.join(ROOT, tela);
      expect(existsSync(abs), `${tela} deveria existir (guarda nao vacua)`).toBe(true);
      expect(touchesUserPlatform(readFileSync(abs, "utf8")), tela).toBe(false);
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
