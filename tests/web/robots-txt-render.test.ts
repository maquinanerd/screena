/**
 * Testes do TEXTO do robots.txt (apps/web/src/lib/robots-txt.ts — funcao PURA).
 *
 * `tests/web/robots.test.ts` prova as REGRAS (o objeto). Este prova o arquivo
 * que vai ao ar, byte a byte, porque agora ha conteudo que o objeto nao carrega:
 * a diretiva `Content-Signal` e o grupo dos crawlers de treino (D7, decisao do
 * dono de 11/09/2026).
 *
 * POR QUE ISTO EXISTE (medido em 22/09/2026): o `robots.txt` de producao tinha
 * 161 B e UM grupo `User-agent: *`, sem `Content-Signal` e sem bloqueio de
 * treino — o bloco gerenciado da Cloudflare deixou de ser servido e levou a D7
 * junto. A auditoria registrou o achado; a saida estavel e o app emitir a
 * declaracao, que ninguem desliga por engano num painel.
 */

import { describe, expect, it } from "vitest";

import {
  AI_TRAINING_USER_AGENTS,
  CONTENT_SIGNAL,
  renderRobotsTxt,
} from "../../apps/web/src/lib/robots-txt";
import { OFFICIAL_SITE_URL, type SiteUrlEnv } from "../../apps/web/src/lib/site";

const OFFICIAL_PRODUCTION_ENV: SiteUrlEnv = {
  THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
  THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
  NODE_ENV: "production",
};

const BLOCKED_ENV: SiteUrlEnv = {
  THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
  THE_SCREEN_PUBLIC_INDEXING_ENABLED: "0",
  NODE_ENV: "production",
};

const LEGAL_DOCS_ENV: SiteUrlEnv = {
  ...BLOCKED_ENV,
  CINERIE_LEGAL_DOCS_INDEXING_ENABLED: "1",
};

/** Um grupo de robots.txt termina na primeira linha em branco (RFC 9309 §2.2). */
function groupFor(text: string, userAgent: string): string | undefined {
  const needle = `User-Agent: ${userAgent}`;
  return text
    .split(/\n\s*\n/)
    .find((block) => block.split("\n").some((line) => line.trim() === needle));
}

describe("robots.txt renderizado — producao oficial", () => {
  const text = renderRobotsTxt(OFFICIAL_PRODUCTION_ENV);

  it("mantem o grupo geral que ja existia, com as mesmas regras", () => {
    const general = groupFor(text, "*");
    expect(general).toBeDefined()
    expect(general).toContain("Allow: /")
    for (const path of ["/api/", "/dev/", "/admin/"]) {
      expect(general, `Disallow ${path}`).toContain(`Disallow: ${path}`)
    }
    // O `*` e o grupo do site inteiro — e onde a declaracao vale.
    expect(general).toContain(`Content-Signal: ${CONTENT_SIGNAL}`)
    expect(CONTENT_SIGNAL).toContain("ai-train=no")
    expect(CONTENT_SIGNAL).toContain("search=yes")
  })

  it("anuncia os dois sitemaps, sempre na origem oficial", () => {
    expect(text).toContain(`Sitemap: ${OFFICIAL_SITE_URL}/sitemap.xml`)
    expect(text).toContain(`Sitemap: ${OFFICIAL_SITE_URL}/news-sitemap.xml`)
    expect(text).not.toMatch(/localhost|screen-staging|screena\.media|thescreen\.media/i)
  })

  it("bloqueia TODO crawler de treino da D7, num grupo so e sem linha em branco no meio", () => {
    const training = groupFor(text, AI_TRAINING_USER_AGENTS[0] as string)
    expect(training).toBeDefined()
    for (const agent of AI_TRAINING_USER_AGENTS) {
      expect(training, `${agent} no grupo de treino`).toContain(`User-Agent: ${agent}`)
    }
    // Uma linha em branco antes do `Disallow` encerraria o grupo e o bloqueio
    // viraria um grupo vazio — o defeito mais silencioso que este arquivo tem.
    expect(training?.trimEnd().endsWith("Disallow: /")).toBe(true)
  })

  it("NAO cria grupo proprio para crawler de busca ou de resposta ao vivo", () => {
    // Um grupo proprio os tiraria do `*` — e, com isso, do `Disallow: /api/`,
    // `/dev/` e `/admin/`, porque o crawler obedece a um grupo so.
    for (const agent of [
      "Googlebot",
      "Googlebot-News",
      "Bingbot",
      "Applebot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
    ]) {
      expect(groupFor(text, agent), `${agent} nao tem grupo proprio`).toBeUndefined()
    }
  })

  it("nao confunde o token de treino com o de busca da mesma marca", () => {
    // O casamento e por TOKEN (RFC 9309 §2.2.1). Bloquear `Applebot-Extended`
    // nao pode significar bloquear `Applebot`, nem `ClaudeBot` pegar `Claude-User`.
    expect(AI_TRAINING_USER_AGENTS).toContain("Applebot-Extended")
    expect(AI_TRAINING_USER_AGENTS).not.toContain("Applebot")
    expect(AI_TRAINING_USER_AGENTS).toContain("ClaudeBot")
    expect(AI_TRAINING_USER_AGENTS).not.toContain("Claude-User")
    expect(AI_TRAINING_USER_AGENTS).toContain("Google-Extended")
    expect(AI_TRAINING_USER_AGENTS).not.toContain("Googlebot")
  })

  it("termina em quebra de linha e nao tem grupo vazio", () => {
    expect(text.endsWith("\n")).toBe(true)
    for (const block of text.split(/\n\s*\n/)) {
      const directives = block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
      if (directives.some((line) => line.startsWith("User-Agent:"))) {
        expect(
          directives.some((line) => line.startsWith("Allow:") || line.startsWith("Disallow:")),
          `grupo sem Allow/Disallow: ${block}`,
        ).toBe(true)
      }
    }
  })
})

describe("robots.txt renderizado — ambiente fechado", () => {
  it("bloqueia tudo e nao emite nada da D7 (o `*` ja cobre todo crawler)", () => {
    const text = renderRobotsTxt(BLOCKED_ENV)
    expect(groupFor(text, "*")).toContain("Disallow: /")
    expect(text).not.toContain("Sitemap:")
    expect(text).not.toContain("Content-Signal")
    for (const agent of AI_TRAINING_USER_AGENTS) {
      expect(text, `${agent} nao precisa de grupo quando tudo esta fechado`).not.toContain(
        `User-Agent: ${agent}`,
      )
    }
  })

  it("documentos legais liberados continuam liberados, e so eles", () => {
    const text = renderRobotsTxt(LEGAL_DOCS_ENV)
    const general = groupFor(text, "*")
    expect(general).toContain("Allow: /pt/termos/")
    expect(general).toContain("Allow: /pt/privacidade/")
    expect(general).toContain("Disallow: /")
    expect(text).not.toContain("Sitemap:")
  })
})
