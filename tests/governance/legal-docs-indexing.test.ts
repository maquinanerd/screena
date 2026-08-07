/**
 * Governanca: os documentos legais tem chave PROPRIA de indexacao.
 *
 * `/pt/termos/` e `/pt/privacidade/` ficam prontos ANTES do catalogo — o aceite
 * obrigatorio do cadastro aponta para as duas, e o texto final do controlador ja
 * entrou (#127 + #133). Enquanto elas usarem o helper generico do site, a unica
 * forma de indexa-las e ligar `CINERIE_PUBLIC_INDEXING_ENABLED`, que abre o site
 * INTEIRO, com o catalogo incompleto.
 *
 * O risco concreto que este teste existe para impedir e uma REGRESSAO POR
 * SIMPATIA: alguem uniformizando as paginas publicas troca `legalDocRobots()`
 * por `publicRobots(true)` "para ficar igual as outras". O codigo continua
 * compilando, os testes de conteudo continuam verdes, e a chave
 * `CINERIE_LEGAL_DOCS_INDEXING_ENABLED` vira uma variavel de ambiente que nao
 * faz nada — sem nenhum sintoma, porque o valor "certo" e o mesmo enquanto o
 * gate global estiver desligado. Por isso a trava e SINTATICA, no arquivo.
 *
 * Cobre tambem o par que torna o gate util: o `<meta robots>` e o `robots.txt`
 * precisam concordar. Meta dizendo `index` com `Disallow: /` no robots.txt nao
 * resulta em "nao indexado" — resulta em URL no indice SEM conteudo, que e pior
 * que os dois estados puros.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const LEGAL_PAGES = [
  path.join(repoRoot, "apps", "web", "app", "pt", "termos", "page.tsx"),
  path.join(repoRoot, "apps", "web", "app", "pt", "privacidade", "page.tsx"),
];

const robotsRoute = path.join(repoRoot, "apps", "web", "app", "robots.ts");
const siteLib = path.join(repoRoot, "apps", "web", "src", "lib", "site.ts");

function read(file: string): string {
  return readFileSync(file, "utf-8");
}

describe("governanca: chave propria de indexacao dos documentos legais", () => {
  it("CONTROLE: os dois arquivos existem e foram lidos", () => {
    for (const file of LEGAL_PAGES) {
      expect(read(file).length, path.relative(repoRoot, file)).toBeGreaterThan(500);
    }
  });

  it("nenhuma das duas paginas legais usa o helper generico do site", () => {
    const offenders: string[] = [];
    for (const file of LEGAL_PAGES) {
      // Sem `stripComments` de proposito: citar o nome do helper generico num
      // COMENTARIO destas duas paginas tambem e proibido. O motivo e pratico —
      // a proxima pessoa que ler o comentario tende a "corrigir" o codigo para
      // bater com ele. A regra so vale para estes dois arquivos, nao para o
      // resto do app.
      if (/\bpublicRobots\b/.test(read(file))) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
    expect(
      offenders,
      "estes documentos legais voltaram a depender do kill switch global " +
        "(CINERIE_PUBLIC_INDEXING_ENABLED) e a chave propria " +
        "CINERIE_LEGAL_DOCS_INDEXING_ENABLED deixou de ter efeito: " +
        offenders.join(", "),
    ).toEqual([]);
  });

  it("as duas paginas emitem robots por legalDocRobots()", () => {
    for (const file of LEGAL_PAGES) {
      expect(read(file), path.relative(repoRoot, file)).toContain(
        "robots: legalDocRobots(),",
      );
    }
  });

  it("o robots.txt acompanha a chave — senao o gate seria inerte", () => {
    const source = read(robotsRoute);
    // Sem este ramo, `<meta robots>` diria `index` e o `Disallow: /` impediria
    // o crawler de chegar a ler o meta.
    expect(source).toContain("isOfficialLegalDocsIndexableEnvironment");
    expect(source).toContain("allow: [TERMS_PATH, PRIVACY_PATH]");
  });

  it("a chave e fail-closed e independente do kill switch global", () => {
    const source = read(siteLib);
    expect(source).toContain("CINERIE_LEGAL_DOCS_INDEXING_ENABLED");
    // Mesmo parser fail-closed das demais flags: ausente/vazio/invalido desliga.
    expect(source).toContain(
      "return parseBooleanEnvFlag(env.CINERIE_LEGAL_DOCS_INDEXING_ENABLED);",
    );
  });
});
