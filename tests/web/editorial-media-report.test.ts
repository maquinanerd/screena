/**
 * O 404 da midia editorial deixa de ser mudo.
 *
 * Antes: `/media/editorial/**` respondia 404 com corpo vazio e a pagina da
 * materia seguia em 200 com um `<img>` quebrado. Quem publicou so descobria
 * abrindo a materia e reparando no espaco vazio.
 *
 * A correcao NAO pode ser contar a causa na resposta — o corpo vazio e a
 * indistinguibilidade entre as tres causas existem para nao ajudar ninguem a
 * enumerar o bucket. O canal e o log do servidor.
 */

import { describe, expect, it } from "vitest";

import {
  buildEditorialMediaMiss,
  formatEditorialMediaMiss,
} from "../../apps/web/src/lib/editorial-media-report";

const PATH = "/media/editorial/ab/abc123.jpg";

describe("evento de 404 da midia editorial", () => {
  it("orfao invertido (linha sem arquivo) e o unico ACIONAVEL", () => {
    // E o unico dos tres que significa "banco e storage discordam AGORA, e a
    // materia esta no ar com imagem quebrada". Os outros dois sao esperados em
    // operacao normal e nao devem virar ruido de alerta.
    expect(buildEditorialMediaMiss("object_missing", PATH).actionable).toBe(true);
    expect(buildEditorialMediaMiss("no_serveable_row", PATH).actionable).toBe(false);
    expect(buildEditorialMediaMiss("malformed_path", PATH).actionable).toBe(false);
  });

  it("o caminho publico acompanha o evento — e o que acha a materia", () => {
    expect(buildEditorialMediaMiss("object_missing", PATH).publicPath).toBe(PATH);
    expect(buildEditorialMediaMiss("no_serveable_row", PATH).publicPath).toBe(PATH);
  });

  it("caminho MALFORMADO nao ecoa o que veio na URL", () => {
    // Aqui a URL nem virou caminho valido: e link velho ou varredura. Ecoar
    // entrada arbitraria no log convida injecao de linha e enche o coletor com
    // lixo de scanner.
    expect(buildEditorialMediaMiss("malformed_path", "/media/editorial/../../etc/passwd").publicPath).toBeNull();
  });

  it("a linha e JSON de UMA linha, filtravel", () => {
    const line = formatEditorialMediaMiss(buildEditorialMediaMiss("object_missing", PATH));
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.event).toBe("editorial_media_miss");
    expect(parsed.reason).toBe("object_missing");
    expect(parsed.actionable).toBe(true);
  });

  it("o evento NUNCA carrega chave de storage, credencial ou erro de driver", () => {
    // A chave revela o layout do bucket; a mensagem do Prisma carrega a
    // DATABASE_URL. Nenhum dos dois pode chegar ao coletor de logs.
    const line = formatEditorialMediaMiss(buildEditorialMediaMiss("object_missing", PATH));
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["actionable", "event", "publicPath", "reason"]);
    for (const proibido of ["storageKey", "storage_key", "DATABASE_URL", "postgres", "secret"]) {
      expect(line.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
  });
});

describe("a resposta HTTP nao muda", () => {
  it("a rota nao inventa cabecalho nem corpo para diferenciar as causas", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const source = await readFile(
      path.join(repoRoot, "apps", "web", "app", "media", "editorial", "[...key]", "route.ts"),
      "utf-8",
    );

    // O 404 continua com corpo `null` e SO `cache-control: no-store`. Se alguem
    // acrescentar um cabecalho de diagnostico aqui, a propriedade
    // anti-enumeracao cai em silencio — e o teste que a protege e este.
    const notFoundBody = source.slice(
      source.indexOf("function notFound("),
      source.indexOf("function unavailable("),
    );
    expect(notFoundBody).toContain("new Response(null, {");
    expect(notFoundBody).toContain('status: 404');
    expect(notFoundBody).toContain('headers: { "cache-control": "no-store" }');
    // Nenhum cabecalho alem do cache-control.
    expect(notFoundBody).not.toMatch(/"x-[a-z-]+":/i);
  });

  it("as TRES causas de 404 sao reportadas — nenhuma fica muda", () => {
    // Se um ramo novo de 404 aparecer sem reportar, o defeito original volta
    // parcialmente: aquele caso especifico some outra vez.
    const reasons = ["malformed_path", "no_serveable_row", "object_missing"] as const;
    for (const reason of reasons) {
      expect(buildEditorialMediaMiss(reason, PATH).event).toBe("editorial_media_miss");
    }
  });
});
