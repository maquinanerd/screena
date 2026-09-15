/**
 * ops-noindex.test.ts — O painel fica FORA do indice e FORA do alcance sem credencial.
 *
 * Tres camadas de noindex (meta no HTML, cabecalho em TODA resposta, robots.txt
 * com Disallow) e nenhum sitemap. O cabecalho e testado nas DUAS saidas do
 * middleware — liberada e 401 — porque o 401 nao tem HTML para carregar meta.
 *
 * A prova por requisicao HTTP contra o Next de verdade (sem credencial = 401) fica
 * no validador do painel; aqui e a funcao do middleware, sem servidor.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "../../apps/admin/app/robots";
import { middleware } from "../../apps/admin/middleware";
import { readSourceWithoutComments, REPO_ROOT } from "../support/source-text";

type MiddlewareRequest = Parameters<typeof middleware>[0];

function pedido(credencial?: string): MiddlewareRequest {
  const headers = new Headers();
  if (credencial !== undefined) headers.set("authorization", credencial);
  return { headers } as unknown as MiddlewareRequest;
}

function basic(usuario: string, senha: string): string {
  return `Basic ${Buffer.from(`${usuario}:${senha}`).toString("base64")}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("robots e sitemap", () => {
  it("robots.txt do painel recusa tudo, para todo robo", () => {
    expect(robots().rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });

  it("o painel nao tem sitemap", () => {
    for (const nome of ["sitemap.ts", "sitemap.xml", "sitemap.tsx"]) {
      expect(existsSync(path.join(REPO_ROOT, "apps", "admin", "app", nome)), nome).toBe(false);
    }
  });

  it("o sitemap do site publico nao cita o painel", () => {
    const fonte = readSourceWithoutComments("apps/web/app/sitemap.xml/route.ts");
    expect(fonte).not.toMatch(/["'`]\/admin|admin\.cinerie|\/filas|\/cotas|\/usuarios/);
  });

  it("o layout declara noindex, nofollow", () => {
    const layout = readSourceWithoutComments("apps/admin/app/layout.tsx");
    expect(layout).toMatch(/index:\s*false/);
    expect(layout).toMatch(/follow:\s*false/);
  });
});

describe("middleware: acesso e noindex por requisicao", () => {
  it("producao SEM credencial configurada: 401, e com X-Robots-Tag noindex", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "");
    const resposta = middleware(pedido(basic("qualquer", "coisa")));
    expect(resposta.status).toBe(401);
    expect(resposta.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("producao com credencial e SEM cabecalho: 401 com desafio e noindex", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "dono");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "senha-de-teste-123");
    const resposta = middleware(pedido());
    expect(resposta.status).toBe(401);
    expect(resposta.headers.get("www-authenticate")).toContain("Basic");
    expect(resposta.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("CONTROLE NEGATIVO: senha errada nao passa", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "dono");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "senha-de-teste-123");
    expect(middleware(pedido(basic("dono", "outra-senha"))).status).toBe(401);
  });

  it("CONTROLE POSITIVO: credencial certa passa — e a resposta liberada TAMBEM leva noindex", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "dono");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "senha-de-teste-123");
    const resposta = middleware(pedido(basic("dono", "senha-de-teste-123")));
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("x-robots-tag")).toContain("noindex");
  });
});
