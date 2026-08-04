/**
 * Testes da higiene de caminho e da config de leitura da midia editorial.
 *
 * Cobrem as duas metades PURAS da rota `/media/editorial/**`: o que vira
 * consulta ao banco e o que decide de onde vem o byte. A parte impura (Prisma +
 * SDK) fica em `src/server/editorial-media.ts` e nao entra aqui.
 */

import { describe, expect, it } from "vitest";

import { resolveEditorialMediaReadConfig } from "../editorial-media-config";
import {
  EDITORIAL_MEDIA_ROUTE_PREFIX,
  editorialMediaLookupPath,
  isSafeStoredObjectKey,
} from "../editorial-media-path";

/** Chave real do asset id 1 de producao, no formato do worker. */
const REAL_HASH = "927ab0a3".padEnd(64, "0");

/**
 * Byte nulo montado em runtime, NUNCA escrito cru no fonte.
 *
 * Um 0x00 literal dentro do arquivo faz o git tratar o `.ts` como BINARIO: o
 * diff some da revisao e o teste passa verde escondendo a regressao. Ja
 * aconteceu neste repositorio, e `tests/governance/no-raw-control-bytes.test.ts`
 * nao pega este caso — ele varre so services/, packages/ e api-clients/.
 */
const NUL = String.fromCharCode(0);

describe("editorialMediaLookupPath", () => {
  it("monta o caminho de lookup exatamente como o worker grava public_path", () => {
    expect(editorialMediaLookupPath(["92", `${REAL_HASH}.jpg`])).toBe(
      `/media/editorial/92/${REAL_HASH}.jpg`,
    );
  });

  it("usa o mesmo prefixo do default de EDITORIAL_MEDIA_PUBLIC_BASE_PATH", () => {
    expect(EDITORIAL_MEDIA_ROUTE_PREFIX).toBe("/media/editorial");
  });

  it("aceita as extensoes de imagem projetaveis", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp", "avif"]) {
      expect(editorialMediaLookupPath(["92", `${REAL_HASH}.${ext}`]), ext).not.toBeNull();
    }
  });

  it("recusa travessia de diretorio", () => {
    expect(editorialMediaLookupPath(["..", "etc", "passwd.png"])).toBeNull();
    expect(editorialMediaLookupPath(["92", ".."])).toBeNull();
    expect(editorialMediaLookupPath([".", "a.png"])).toBeNull();
  });

  it("recusa segmento vazio, barra invertida e byte nulo", () => {
    expect(editorialMediaLookupPath(["", "a.png"])).toBeNull();
    expect(editorialMediaLookupPath(["92", "a\\b.png"])).toBeNull();
    expect(editorialMediaLookupPath(["92", `a${NUL}.png`])).toBeNull();
  });

  it("recusa extensao fora da tabela de MIME projetaveis", () => {
    // SVG/HTML sao recusados na projecao (executam script); nem chegam ao banco.
    expect(editorialMediaLookupPath(["92", `${REAL_HASH}.svg`])).toBeNull();
    expect(editorialMediaLookupPath(["92", `${REAL_HASH}.html`])).toBeNull();
    expect(editorialMediaLookupPath(["92", `${REAL_HASH}.gif`])).toBeNull();
    expect(editorialMediaLookupPath(["92", REAL_HASH])).toBeNull();
  });

  it("recusa ausencia de segmento e excesso de profundidade", () => {
    expect(editorialMediaLookupPath(undefined)).toBeNull();
    expect(editorialMediaLookupPath([])).toBeNull();
    expect(editorialMediaLookupPath(["a", "b", "c", "d", "e.png"])).toBeNull();
  });

  it("recusa caminho acima do teto de tamanho", () => {
    expect(editorialMediaLookupPath(["92", `${"a".repeat(300)}.png`])).toBeNull();
  });

  it("recusa maiuscula (a chave do worker e hex minusculo)", () => {
    expect(editorialMediaLookupPath(["92", `${REAL_HASH.toUpperCase()}.JPG`])).toBeNull();
  });

  it("NAO impoe o formato de 2 niveis: a autoridade e o banco, nao a regex", () => {
    // Se o worker um dia usar tres niveis de balde, a rota continua servindo e o
    // `public_path` inexistente e que produz o 404 — nao um formato hardcoded
    // aqui, que sairia de sincronia sem ninguem perceber.
    expect(editorialMediaLookupPath(["92", "7a", `${REAL_HASH}.jpg`])).toBe(
      `/media/editorial/92/7a/${REAL_HASH}.jpg`,
    );
  });
});

describe("isSafeStoredObjectKey", () => {
  it("aceita a chave canonica do worker", () => {
    expect(isSafeStoredObjectKey(`editorial/92/${REAL_HASH}.jpg`)).toBe(true);
  });

  it("recusa chave absoluta, com travessia ou com barra invertida", () => {
    expect(isSafeStoredObjectKey(`/editorial/92/${REAL_HASH}.jpg`)).toBe(false);
    expect(isSafeStoredObjectKey("editorial/../../etc/passwd")).toBe(false);
    expect(isSafeStoredObjectKey("editorial\\92\\a.jpg")).toBe(false);
    expect(isSafeStoredObjectKey(`editorial/92/a${NUL}.jpg`)).toBe(false);
    expect(isSafeStoredObjectKey("")).toBe(false);
  });
});

describe("resolveEditorialMediaReadConfig", () => {
  const S3_ENV = {
    EDITORIAL_MEDIA_STORAGE_DRIVER: "s3",
    EDITORIAL_MEDIA_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    EDITORIAL_MEDIA_S3_BUCKET: "cinerie-editorial",
    EDITORIAL_MEDIA_S3_ACCESS_KEY_ID: "key",
    EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY: "secret",
  };

  it("resolve s3 com os mesmos defaults do worker", () => {
    const result = resolveEditorialMediaReadConfig(S3_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({
      driver: "s3",
      endpoint: "https://account.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "cinerie-editorial",
      accessKeyId: "key",
      secretAccessKey: "secret",
      forcePathStyle: true,
    });
  });

  it("nomeia TODAS as variaveis ausentes de uma vez", () => {
    const result = resolveEditorialMediaReadConfig({ EDITORIAL_MEDIA_STORAGE_DRIVER: "s3" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("EDITORIAL_MEDIA_S3_ENDPOINT");
    expect(result.reason).toContain("EDITORIAL_MEDIA_S3_BUCKET");
    expect(result.reason).toContain("EDITORIAL_MEDIA_S3_ACCESS_KEY_ID");
    expect(result.reason).toContain("EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY");
  });

  it("nunca devolve VALOR de secret na mensagem de erro", () => {
    const result = resolveEditorialMediaReadConfig({
      ...S3_ENV,
      EDITORIAL_MEDIA_S3_ENDPOINT: "nao-e-url",
      EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY: "s3cr3t-que-nao-pode-vazar",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).not.toContain("s3cr3t-que-nao-pode-vazar");
    expect(result.reason).not.toContain("nao-e-url");
  });

  it("recusa driver ausente em producao — ninguem adivinha storage", () => {
    const result = resolveEditorialMediaReadConfig({ NODE_ENV: "production" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("EDITORIAL_MEDIA_STORAGE_DRIVER ausente");
  });

  it("recusa driver desconhecido", () => {
    const result = resolveEditorialMediaReadConfig({ EDITORIAL_MEDIA_STORAGE_DRIVER: "gdrive" });
    expect(result.ok).toBe(false);
  });

  it("fora de producao, cai em local quando ha raiz declarada", () => {
    const result = resolveEditorialMediaReadConfig({
      EDITORIAL_MEDIA_LOCAL_ROOT: "/data/editorial-media",
    });
    expect(result).toEqual({
      ok: true,
      config: { driver: "local", root: "/data/editorial-media" },
    });
  });

  it("ACEITA local em producao — ler de volume montado nao perde midia", () => {
    // O worker recusa `local` em producao porque ESCREVER em disco efemero perde
    // arquivo no proximo deploy (`storage-config.ts:82-91`). Ler nao tem esse
    // risco, e recusar transformaria um volume legitimo em 503.
    const result = resolveEditorialMediaReadConfig({
      NODE_ENV: "production",
      EDITORIAL_MEDIA_STORAGE_DRIVER: "local",
      EDITORIAL_MEDIA_LOCAL_ROOT: "/data/editorial-media",
    });
    expect(result.ok).toBe(true);
  });

  it("respeita forcePathStyle=false quando explicitamente desligado", () => {
    const result = resolveEditorialMediaReadConfig({
      ...S3_ENV,
      EDITORIAL_MEDIA_S3_FORCE_PATH_STYLE: "false",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.config.driver !== "s3") return;
    expect(result.config.forcePathStyle).toBe(false);
  });
});
