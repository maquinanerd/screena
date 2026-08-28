/**
 * route-cache-policy.test.ts — O GUARD DE VAZAMENTO.
 *
 * ============================================================================
 * A REGRA: AUSENCIA E FALHA, NUNCA PERMISSAO
 * ============================================================================
 * Este projeto acabou de gastar duas levas (#241, #242) consertando uma regra
 * que tratava ausencia como permissao: o `NOT EXISTS` do sitemap fazia URL sem
 * decisao entrar por omissao. La o preco era posicao no Google. Aqui o preco
 * seria a pagina de um usuario logado guardada numa CDN e servida para outra
 * pessoa.
 *
 * Por isso o registro (`apps/web/src/lib/route-cache-policy.ts`) e FECHADO nos
 * dois sentidos: rota que existe no app e nao esta la reprova; entrada no
 * registro sem rota correspondente reprova. Nao ha default.
 *
 * ============================================================================
 * COMO ESTE ARQUIVO MEDE — E POR QUE NAO E `grep` NO FONTE
 * ============================================================================
 * A lista de rotas vem do SISTEMA DE ARQUIVOS (`apps/web/app/**`), derivada
 * pelas mesmas regras do App Router. A CLASSE efetiva de cada rota, quando ha
 * build disponivel, vem de `.next/prerender-manifest.json` — a decisao do
 * PROPRIO NEXT, nao do texto do nosso codigo.
 *
 * Isso importa. Um guard que procurasse `export const dynamic` no fonte
 * passaria com o defeito de pe: foi exatamente assim que
 * `export const revalidate = 3600` viveu treze meses nas fichas SEM LIGAR CACHE
 * NENHUM — o texto estava la, a rota era dinamica, e nenhuma varredura textual
 * podia ver a diferenca. Quem viu foi o manifesto do build.
 *
 * Quando nao ha build (`.next` ausente), as provas estruturais continuam
 * valendo e as que dependem do manifesto sao PULADAS COM AVISO — nunca
 * silenciosamente aprovadas.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A UNICA porta pela qual um guard le codigo-fonte
// (`tests/governance/guard-source-reading.test.ts` recusa leitura crua aqui, e
// recusa ate a MENCAO do jeito ingenuo — inclusive em comentario, porque le o
// arquivo cru).
//
// Nao e burocracia: a prova (8) procura um IMPORT de `next/headers`, e este
// mesmo arquivo CITA `next/headers` em prosa varias vezes. Lendo cru, o guard
// casaria com a propria explicacao e ficaria vermelho para sempre — a quinta
// repeticao do defeito que a porta fecha.
import { readSourceWithoutComments } from "../support/source-text.js";

import {
  ROUTE_CACHE_POLICY,
  declaredRoutes,
  isCacheableClass,
  policyFor,
  type RouteCacheClass,
} from "../../apps/web/src/lib/route-cache-policy";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const webDir = path.join(repoRoot, "apps", "web");
const appDir = path.join(webDir, "app");

/**
 * Descobre as rotas do App Router varrendo `app/**` pelas MESMAS regras que o
 * Next usa para nomear uma rota:
 *  - `page.tsx` / `route.ts` definem uma rota;
 *  - `robots.ts` -> `/robots.txt`, `sitemap.ts` -> `/sitemap.xml`;
 *  - segmento entre parenteses e grupo (nao entra na URL);
 *  - `_pasta` e privada (nunca vira rota);
 *  - `__tests__` nao e rota.
 *
 * O `/_not-found` do Next nao tem arquivo neste app: ele e adicionado pelo
 * framework. Entra na lista explicitamente para o registro poder classifica-lo.
 */
function discoverRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("_") || entry === "__tests__") continue;
      const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      out.push(...discoverRoutes(full, `${prefix}${segment}`));
      continue;
    }
    if (entry === "page.tsx" || entry === "page.ts") out.push(prefix === "" ? "/" : prefix);
    else if (entry === "route.ts" || entry === "route.tsx") out.push(prefix === "" ? "/" : prefix);
    else if (entry === "robots.ts") out.push(`${prefix}/robots.txt`);
    else if (entry === "sitemap.ts") out.push(`${prefix}/sitemap.xml`);
  }
  return out;
}

const FRAMEWORK_ROUTES = ["/_not-found"];

function appRoutes(): string[] {
  return [...new Set([...discoverRoutes(appDir), ...FRAMEWORK_ROUTES])].sort();
}

interface PrerenderManifest {
  routes: Record<string, unknown>;
  dynamicRoutes: Record<string, unknown>;
}

function readPrerenderManifest(): PrerenderManifest | null {
  const file = path.join(webDir, ".next", "prerender-manifest.json");
  if (!existsSync(file)) return null;
  // `.json` nao tem comentario: a porta devolve o arquivo intacto.
  return JSON.parse(readSourceWithoutComments(file)) as PrerenderManifest;
}

/**
 * As arvores de rota cuja resposta depende da CREDENCIAL do visitante.
 *
 * Nao e estilo nem convencao: e a lista que decide o lado seguro. Qualquer rota
 * sob elas TEM de ser `private`, e o teste (3) reprova se alguem afrouxar uma.
 */
const CREDENTIAL_ROUTE_TREES = [
  "/api/auth",
  "/api/account",
  "/api/me",
  "/pt/conta",
  "/pt/listas",
  "/pt/minha-lista",
  "/pt/historico",
  "/pt/tracker",
  "/pt/importar",
  "/pt/entrar",
  "/pt/criar-conta",
  "/pt/recuperar-senha",
  "/pt/redefinir-senha",
  "/pt/verificar-email",
];

function isCredentialRoute(route: string): boolean {
  return CREDENTIAL_ROUTE_TREES.some(
    (tree) => route === tree || route.startsWith(`${tree}/`),
  );
}

describe("politica de cache por rota — o registro e FECHADO", () => {
  it("(1) toda rota do app esta classificada — rota nova sem classe REPROVA", () => {
    const naoClassificadas = appRoutes().filter((route) => policyFor(route) === undefined);
    expect(
      naoClassificadas,
      "rota nova precisa entrar em apps/web/src/lib/route-cache-policy.ts com a sua classe e o seu motivo; " +
        "ausencia NUNCA significa 'publica por omissao'",
    ).toEqual([]);
  });

  it("(2) toda entrada do registro corresponde a uma rota que existe", () => {
    const rotas = new Set(appRoutes());
    const orfas = declaredRoutes().filter((route) => !rotas.has(route));
    expect(orfas, "entrada de registro sem rota no app: apague a entrada").toEqual([]);
  });

  it("(3) NENHUMA rota de credencial tem politica publica", () => {
    const vazando = appRoutes()
      .filter(isCredentialRoute)
      .map((route) => [route, policyFor(route)?.cls] as const)
      .filter(([, cls]) => cls !== "private");
    expect(
      vazando,
      "rota que responde por credencial precisa ser `private`: HTML guardado seria servido de um titular para outro",
    ).toEqual([]);
  });

  it("(4) toda entrada tem MOTIVO escrito — classe sem porque nao entra", () => {
    const semMotivo = Object.entries(ROUTE_CACHE_POLICY)
      .filter(([, policy]) => policy.reason.trim().length < 20)
      .map(([route]) => route);
    expect(semMotivo).toEqual([]);
  });

  it("(5) `revalidateSeconds` so existe onde ha algo guardado", () => {
    const incoerentes = Object.entries(ROUTE_CACHE_POLICY)
      .filter(([, policy]) => {
        if (policy.cls === "public-static") {
          // `null` = prerenderizada no build; numero = ISR. Zero ou negativo nao
          // e janela nenhuma.
          return policy.revalidateSeconds !== null && policy.revalidateSeconds <= 0;
        }
        return policy.revalidateSeconds !== null;
      })
      .map(([route]) => route);
    expect(incoerentes).toEqual([]);
  });

  it("(6) so `public-static` e cacheavel — as outras duas nunca", () => {
    const classes: RouteCacheClass[] = ["private", "public-static", "public-dynamic"];
    expect(classes.filter(isCacheableClass)).toEqual(["public-static"]);
  });

  /**
   * ESTA E A PROVA QUE NAO PODE SER FALSIFICADA POR COMENTARIO. O manifesto do
   * build e a decisao do Next: se a rota esta em `routes`/`dynamicRoutes`, o
   * HTML dela SERA guardado; se nao esta, sera renderizado a cada requisicao.
   */
  it("(7) o BUILD concorda com o registro — intencao declarada vs. decisao do Next", () => {
    const manifest = readPrerenderManifest();
    if (manifest === null) {
      console.warn(
        "[route-cache-policy] .next/prerender-manifest.json ausente — prova (7) PULADA. " +
          "Rode `pnpm build` para exercita-la.",
      );
      return;
    }
    const guardadas = new Set([
      ...Object.keys(manifest.routes),
      ...Object.keys(manifest.dynamicRoutes),
    ]);

    const divergentes: string[] = [];
    for (const route of appRoutes()) {
      const policy = policyFor(route);
      if (policy === undefined) continue; // ja reprovado em (1)
      const noBuild = guardadas.has(route);
      const deveriaGuardar = policy.cls === "public-static";
      if (noBuild !== deveriaGuardar) {
        divergentes.push(
          `${route}: registro diz ${policy.cls}, build diz ${noBuild ? "guardada" : "dinamica"}`,
        );
      }
    }
    expect(
      divergentes,
      "o build e a autoridade. `public-static` que o Next nao guarda tem a intencao sem o cache " +
        "(foi o que aconteceu com `revalidate = 3600` sem `generateStaticParams`); " +
        "e o inverso e uma rota guardada que ninguem classificou como guardavel.",
    ).toEqual([]);
  });

  /**
   * A classe "publica mas PERSONALIZADA no servidor" nao existe hoje porque
   * nenhum server component consegue ler cookie: `next/headers` nao e importado
   * em lugar nenhum de `apps/web`. Se isso mudar, a classificacao inteira
   * precisa ser refeita ANTES de qualquer cache — e este teste e o alarme.
   */
  it("(8) nenhum server component de apps/web le sessao (`next/headers`)", () => {
    const encontrados: string[] = [];
    const varrer = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === ".next") continue;
          varrer(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const source = readSourceWithoutComments(full);
        if (/from\s+["']next\/headers["']/.test(source)) {
          encontrados.push(path.relative(webDir, full));
        }
      }
    };
    for (const sub of ["app", "src", "components", "lib"]) {
      const dir = path.join(webDir, sub);
      if (existsSync(dir)) varrer(dir);
    }
    expect(
      encontrados,
      "`next/headers` no app publico significa HTML do servidor que pode variar por sessao. " +
        "Antes de introduzir isso, reclassifique a rota em route-cache-policy.ts: " +
        "pagina publica personalizada NAO pode ter cache de rota.",
    ).toEqual([]);
  });
});
