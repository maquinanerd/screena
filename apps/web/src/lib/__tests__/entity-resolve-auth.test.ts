/**
 * entity-resolve-auth.test.ts — credencial e teto da rota interna de resolucao.
 *
 * Duas propriedades sao provadas aqui porque nenhuma das duas aparece num teste
 * de "funciona": a rota NASCE DESLIGADA (sem chave, ninguem entra) e a chamada
 * RECUSADA nao incrementa o contador (senao um cliente em retry se bloqueia
 * sozinho pela janela inteira).
 */

import { describe, expect, it } from "vitest";

import {
  credentialIdFor,
  extractPresentedKey,
  matchResolveCredential,
  readResolveCredentials,
} from "../entity-resolve-auth";
import {
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  RATE_LIMIT_WINDOW_MS,
  consumeRateLimit,
  pruneRateLimitBuckets,
  readRateLimitPerMinute,
  type RateLimitState,
} from "../entity-resolve-rate-limit";

const KEY_A = "chave-de-teste-aaaaaaaaaaaaaaaa";
const KEY_B = "chave-de-teste-bbbbbbbbbbbbbbbb";

describe("a rota nasce desligada", () => {
  it("sem a variavel, nenhuma credencial", () => {
    expect(readResolveCredentials({}).credentials).toHaveLength(0);
    expect(readResolveCredentials({ CINERIE_CATALOG_RESOLVE_API_KEYS: "   " }).credentials).toHaveLength(0);
  });

  it("chave curta demais NAO habilita, e e CONTADA", () => {
    // Ignorar em silencio deixaria o operador achando que configurou. O valor
    // nunca aparece — so a contagem.
    const result = readResolveCredentials({ CINERIE_CATALOG_RESOLVE_API_KEYS: "curta,123" });
    expect(result.credentials).toHaveLength(0);
    expect(result.rejected).toBe(2);
  });

  it("duas chaves convivem — e para isso que a rotacao existe", () => {
    // Publica a nova, o emissor troca, remove a velha: sem janela em que
    // ninguem consegue chamar.
    const result = readResolveCredentials({
      CINERIE_CATALOG_RESOLVE_API_KEYS: `${KEY_A}, ${KEY_B}`,
    });
    expect(result.credentials.map((c) => c.id)).toEqual([
      credentialIdFor(KEY_A),
      credentialIdFor(KEY_B),
    ]);
  });

  it("o id da credencial e um PREFIXO, nunca a chave", () => {
    const id = credentialIdFor(KEY_A);
    expect(id).toHaveLength(8);
    expect(KEY_A.includes(id)).toBe(true);
    expect(id).not.toBe(KEY_A);
  });
});

describe("cabecalho Authorization", () => {
  it("aceita Bearer e API-Key, em qualquer caixa", () => {
    // `Bearer` e o que qualquer cliente HTTP monta sem pensar; `API-Key` e o que
    // o MNScr ja usa com o CMS. Recusar o segundo faria alguem manter duas
    // formas de montar o mesmo cabecalho.
    expect(extractPresentedKey(`Bearer ${KEY_A}`)).toBe(KEY_A);
    expect(extractPresentedKey(`API-Key ${KEY_A}`)).toBe(KEY_A);
    expect(extractPresentedKey(`bearer ${KEY_A}`)).toBe(KEY_A);
  });

  it("cabecalho ausente, vazio ou sem esquema nao vira chave", () => {
    for (const value of [null, "", "   ", KEY_A, "Basic abc", "Bearer "]) {
      expect(extractPresentedKey(value), String(value)).toBeNull();
    }
  });
});

describe("comparacao da chave", () => {
  it("chave certa casa; chave errada do MESMO tamanho nao", () => {
    const wrong = `${KEY_A.slice(0, -1)}z`;
    expect(wrong).toHaveLength(KEY_A.length);
    expect(matchResolveCredential([KEY_A], KEY_A)?.id).toBe(credentialIdFor(KEY_A));
    expect(matchResolveCredential([KEY_A], wrong)).toBeNull();
  });

  it("prefixo, sufixo e vazio nao casam", () => {
    for (const presented of [KEY_A.slice(0, 8), `${KEY_A}x`, "", null]) {
      expect(matchResolveCredential([KEY_A], presented), String(presented)).toBeNull();
    }
  });

  it("qualquer uma das chaves configuradas casa", () => {
    expect(matchResolveCredential([KEY_A, KEY_B], KEY_B)?.id).toBe(credentialIdFor(KEY_B));
  });
});

describe("teto de chamadas", () => {
  it("le o teto do ambiente e cai no default para valor invalido", () => {
    expect(readRateLimitPerMinute({ CINERIE_CATALOG_RESOLVE_RATE_LIMIT_PER_MINUTE: "10" })).toBe(10);
    // Zero seria "rota ligada que recusa tudo" — pior do que rota desligada.
    for (const raw of ["", "0", "-5", "abc", "1.5"]) {
      expect(
        readRateLimitPerMinute({ CINERIE_CATALOG_RESOLVE_RATE_LIMIT_PER_MINUTE: raw }),
        raw,
      ).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
    }
  });

  it("libera ate o teto e recusa a seguinte, com Retry-After", () => {
    const buckets = new Map<string, RateLimitState>();
    for (let i = 0; i < 3; i += 1) {
      expect(consumeRateLimit(buckets, "cred", 3, 1_000).allowed, `chamada ${String(i)}`).toBe(true);
    }
    const denied = consumeRateLimit(buckets, "cred", 3, 1_000);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("a chamada RECUSADA nao incrementa o contador", () => {
    // Incrementar manteria a janela cheia enquanto o cliente insistisse — e um
    // cliente que insiste e o caso normal de retry. O teto viraria um bloqueio
    // que se auto-renova.
    const buckets = new Map<string, RateLimitState>();
    consumeRateLimit(buckets, "cred", 1, 1_000);
    consumeRateLimit(buckets, "cred", 1, 1_000);
    consumeRateLimit(buckets, "cred", 1, 1_000);
    expect(buckets.get("cred")?.count).toBe(1);
  });

  it("a janela vira e o balde recomeca", () => {
    const buckets = new Map<string, RateLimitState>();
    consumeRateLimit(buckets, "cred", 1, 1_000);
    expect(consumeRateLimit(buckets, "cred", 1, 1_000).allowed).toBe(false);
    expect(consumeRateLimit(buckets, "cred", 1, 1_000 + RATE_LIMIT_WINDOW_MS).allowed).toBe(true);
  });

  it("baldes de credenciais diferentes nao se misturam", () => {
    const buckets = new Map<string, RateLimitState>();
    consumeRateLimit(buckets, "a", 1, 1_000);
    expect(consumeRateLimit(buckets, "b", 1, 1_000).allowed).toBe(true);
  });

  it("a limpeza descarta janela vencida — o Map nao cresce indefinidamente", () => {
    const buckets = new Map<string, RateLimitState>();
    consumeRateLimit(buckets, "velha", 5, 1_000);
    consumeRateLimit(buckets, "nova", 5, 1_000 + RATE_LIMIT_WINDOW_MS);
    pruneRateLimitBuckets(buckets, 1_000 + RATE_LIMIT_WINDOW_MS);
    expect(buckets.has("velha")).toBe(false);
    expect(buckets.has("nova")).toBe(true);
  });
});
