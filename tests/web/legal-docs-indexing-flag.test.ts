/**
 * Comportamento de `CINERIE_LEGAL_DOCS_INDEXING_ENABLED`.
 *
 * A pergunta que estes testes respondem e a unica que importa em operacao:
 * "ligar so esta chave indexa Termos e Privacidade sem abrir o catalogo?" — e a
 * gemea dela, "esquecer de liga-la pode DESindexar quando o site inteiro
 * abrir?".
 *
 * O `robots.txt` entra junto porque os dois lados precisam concordar. Meta
 * dizendo `index` com `Disallow: /` no robots.txt nao produz "nao indexado":
 * produz URL no indice sem conteudo, que e pior que qualquer um dos dois
 * estados puros.
 */

import { describe, expect, it } from "vitest";

import { buildRobots } from "../../apps/web/app/robots";
import {
  OFFICIAL_SITE_URL,
  isLegalDocsIndexingEnabled,
  isOfficialLegalDocsIndexableEnvironment,
  legalDocRobots,
  publicRobots,
  type SiteUrlEnv,
} from "../../apps/web/src/lib/site";
import { PRIVACY_PATH, TERMS_PATH } from "../../apps/web/src/lib/routes";

const INDEX: SiteUrlEnv["NODE_ENV"] = "production";

/** Producao oficial com TUDO desligado. */
const CLOSED: SiteUrlEnv = {
  CINERIE_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
  NODE_ENV: INDEX,
};

/** Producao oficial com SO os documentos legais liberados. */
const LEGAL_ONLY: SiteUrlEnv = {
  ...CLOSED,
  CINERIE_LEGAL_DOCS_INDEXING_ENABLED: "true",
};

/** Producao oficial com o site INTEIRO liberado, e a chave legal ausente. */
const SITE_OPEN: SiteUrlEnv = {
  ...CLOSED,
  CINERIE_PUBLIC_INDEXING_ENABLED: "true",
};

function generalRule(result: ReturnType<typeof buildRobots>) {
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
  return rules.find((rule) => rule?.userAgent === "*");
}

describe("legalDocRobots — o caso que motivou a chave", () => {
  it("com TUDO desligado, os documentos legais NAO indexam", () => {
    expect(legalDocRobots(CLOSED)).toEqual({ index: false, follow: false });
  });

  it("so a chave legal ligada JA indexa os documentos legais", () => {
    expect(legalDocRobots(LEGAL_ONLY)).toEqual({ index: true, follow: true });
  });

  it("e o resto do site continua fechado nesse mesmo ambiente", () => {
    // Este e o ponto inteiro da chave. Se este teste ficar verde junto com um
    // `index` aqui, a separacao nao existe.
    expect(publicRobots(true, LEGAL_ONLY)).toEqual({ index: false, follow: false });
  });

  it("site inteiro aberto indexa os legais mesmo SEM a chave legal", () => {
    // OR, nao AND: a chave legal ADICIONA permissao, nunca remove uma que ja
    // existe. Esquecer de liga-la nao pode desindexar a Politica de Privacidade
    // quando o site abrir.
    expect(legalDocRobots(SITE_OPEN)).toEqual({ index: true, follow: true });
  });
});

describe("legalDocRobots — fail-closed", () => {
  it("valor invalido nao liga (so `true`/`1` ligam)", () => {
    for (const raw of ["", " ", "sim", "yes", "0", "false", "TRUE ok"]) {
      expect(
        isLegalDocsIndexingEnabled({ CINERIE_LEGAL_DOCS_INDEXING_ENABLED: raw }),
        `valor ${JSON.stringify(raw)} nao pode ligar`,
      ).toBe(false);
    }
    expect(isLegalDocsIndexingEnabled({})).toBe(false);
    for (const raw of ["true", "TRUE", " 1 ", "1"]) {
      expect(
        isLegalDocsIndexingEnabled({ CINERIE_LEGAL_DOCS_INDEXING_ENABLED: raw }),
        `valor ${JSON.stringify(raw)} deveria ligar`,
      ).toBe(true);
    }
  });

  it("a chave NAO vale fora da producao oficial", () => {
    const cases: ReadonlyArray<readonly [string, SiteUrlEnv]> = [
      ["origem nao oficial", { ...LEGAL_ONLY, CINERIE_PUBLIC_SITE_URL: "https://staging.cinerie.com" }],
      ["origem local", { ...LEGAL_ONLY, CINERIE_PUBLIC_SITE_URL: "http://localhost:3000" }],
      ["NODE_ENV de desenvolvimento", { ...LEGAL_ONLY, NODE_ENV: "development" }],
      ["VERCEL_ENV de preview", { ...LEGAL_ONLY, VERCEL_ENV: "preview" }],
    ];
    for (const [label, env] of cases) {
      expect(isOfficialLegalDocsIndexableEnvironment(env), label).toBe(false);
      expect(legalDocRobots(env), label).toEqual({ index: false, follow: false });
    }
  });
});

describe("robots.txt acompanha a chave", () => {
  it("tudo desligado: Disallow: / e nenhum Allow", () => {
    const rule = generalRule(buildRobots(CLOSED));
    expect(rule?.disallow).toBe("/");
    expect(rule?.allow).toBeUndefined();
  });

  it("so a chave legal: libera os DOIS caminhos e mantem o resto fechado", () => {
    const rule = generalRule(buildRobots(LEGAL_ONLY));
    expect(rule?.disallow).toBe("/");
    expect(rule?.allow).toEqual([TERMS_PATH, PRIVACY_PATH]);
  });

  it("so a chave legal: NAO anuncia sitemap", () => {
    // O sitemap lista o catalogo, que continua noindex. Anuncia-lo convidaria o
    // crawler exatamente ao que esta fechado.
    expect(buildRobots(LEGAL_ONLY).sitemap).toBeUndefined();
  });

  it("os caminhos liberados sao os das rotas reais, nao literais soltos", () => {
    const rule = generalRule(buildRobots(LEGAL_ONLY));
    // Se alguem renomear a rota, o robots.txt acompanha; um literal '/pt/termos/'
    // escrito a mao ficaria apontando para 404 em silencio.
    expect(rule?.allow).toContain("/pt/termos/");
    expect(rule?.allow).toContain("/pt/privacidade/");
  });

  it("site inteiro aberto: volta ao Allow: / normal, sem regra especial", () => {
    const rule = generalRule(buildRobots(SITE_OPEN));
    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toEqual(["/api/", "/dev/", "/admin/"]);
  });
});
