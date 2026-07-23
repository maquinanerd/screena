/**
 * Configuracao server-only: falha CEDO, falha FECHADO e nunca ecoa valor.
 */

import { describe, expect, it } from "vitest";

import {
  AUTH_EMAIL_ENV_KEYS,
  loadAuthEmailConfig,
  MAX_EXPIRATION_MINUTES,
  MIN_IP_HASH_SALT_LENGTH,
} from "../config.js";

const CHAVE_FICTICIA = "xkeysib-CHAVE-FICTICIA-DE-TESTE";

const VALIDO: Readonly<Record<string, string>> = {
  BREVO_API_KEY: CHAVE_FICTICIA,
  BREVO_SENDER_NAME: "Cinerie",
  BREVO_SENDER_EMAIL: "conta@cinerie.com",
  PUBLIC_APP_URL: "https://cinerie.com",
  PASSWORD_RESET_EXPIRATION_MINUTES: "30",
  EMAIL_VERIFICATION_EXPIRATION_MINUTES: "1440",
};

function carregar(
  overrides: Readonly<Record<string, string | undefined>> = {},
  production = true,
) {
  return loadAuthEmailConfig({ env: { ...VALIDO, ...overrides }, production });
}

function erros(result: ReturnType<typeof carregar>): readonly string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : (result.error.details ?? []);
}

describe("caminho feliz", () => {
  it("(1) aceita a configuracao canonica do EasyPanel", () => {
    const result = carregar();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.brevoApiKey).toBe(CHAVE_FICTICIA);
    expect(result.value.senderName).toBe("Cinerie");
    expect(result.value.senderEmail).toBe("conta@cinerie.com");
    expect(result.value.replyToEmail).toBeNull();
    expect(result.value.publicAppUrl.toString()).toBe("https://cinerie.com/");
    expect(result.value.passwordResetExpirationMinutes).toBe(30);
    expect(result.value.emailVerificationExpirationMinutes).toBe(1440);
    expect(result.value.ipHashSalt).toBeNull();
  });

  it("(2) BREVO_REPLY_TO_EMAIL e opcional, mas validado quando presente", () => {
    const com = carregar({ BREVO_REPLY_TO_EMAIL: "suporte@cinerie.com" });
    expect(com.ok && com.value.replyToEmail).toBe("suporte@cinerie.com");

    expect(erros(carregar({ BREVO_REPLY_TO_EMAIL: "nao-e-email" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.replyToEmail} nao e um e-mail valido`,
    );
  });

  it("(3) fora de producao, http e localhost sao aceitos (dev)", () => {
    const result = carregar({ PUBLIC_APP_URL: "http://localhost:3000" }, false);
    expect(result.ok).toBe(true);
  });
});

describe("ausencia de configuracao obrigatoria", () => {
  it("(4) NAO existe default para a chave da Brevo", () => {
    expect(erros(carregar({ BREVO_API_KEY: undefined }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.brevoApiKey} ausente`,
    );
    // String vazia e espacos tambem sao ausencia — uma chave "presente porem
    // vazia" so falharia no envio, em runtime, sem ninguem perceber.
    expect(erros(carregar({ BREVO_API_KEY: "" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.brevoApiKey} ausente`,
    );
    expect(erros(carregar({ BREVO_API_KEY: "   " }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.brevoApiKey} ausente`,
    );
  });

  it("(5) ambiente COMPLETAMENTE vazio acusa todas as obrigatorias de uma vez", () => {
    const result = loadAuthEmailConfig({ env: {}, production: true });
    const detalhes = erros(result);
    for (const chave of [
      AUTH_EMAIL_ENV_KEYS.brevoApiKey,
      AUTH_EMAIL_ENV_KEYS.senderName,
      AUTH_EMAIL_ENV_KEYS.senderEmail,
      AUTH_EMAIL_ENV_KEYS.publicAppUrl,
      AUTH_EMAIL_ENV_KEYS.passwordResetExpirationMinutes,
      AUTH_EMAIL_ENV_KEYS.emailVerificationExpirationMinutes,
    ]) {
      expect(detalhes.some((d) => d.startsWith(chave)), chave).toBe(true);
    }
  });

  it("(6) remetente invalido e recusado", () => {
    expect(erros(carregar({ BREVO_SENDER_EMAIL: "conta-sem-arroba" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.senderEmail} nao e um e-mail valido`,
    );
  });
});

describe("PUBLIC_APP_URL", () => {
  it("(7) exige https em producao", () => {
    expect(erros(carregar({ PUBLIC_APP_URL: "http://cinerie.com" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.publicAppUrl} deve usar https em producao`,
    );
  });

  it("(8) recusa esquema que nao seja http/https", () => {
    const detalhes = erros(carregar({ PUBLIC_APP_URL: "javascript:alert(1)" }));
    expect(detalhes.some((d) => d.includes("deve usar http ou https"))).toBe(true);
  });

  it("(9) recusa credenciais embutidas", () => {
    expect(erros(carregar({ PUBLIC_APP_URL: "https://user:senha@cinerie.com" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.publicAppUrl} nao pode conter credenciais`,
    );
  });

  it("(10) recusa fragmento e query", () => {
    expect(erros(carregar({ PUBLIC_APP_URL: "https://cinerie.com/#x" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.publicAppUrl} nao pode conter fragmento`,
    );
    expect(erros(carregar({ PUBLIC_APP_URL: "https://cinerie.com/?a=1" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.publicAppUrl} nao pode conter query string`,
    );
  });

  it("(11) recusa PREFIXO DE CAMINHO — ele seria descartado no link", () => {
    // O link usa caminho absoluto ("/pt/..."); com uma base "/app" o prefixo
    // sumiria em silencio e todo e-mail apontaria para o lugar errado.
    expect(erros(carregar({ PUBLIC_APP_URL: "https://cinerie.com/app" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.publicAppUrl} deve apontar para a raiz do site (sem prefixo de caminho)`,
    );
  });

  it("(12) recusa host local em producao", () => {
    for (const host of ["https://localhost", "https://127.0.0.1", "https://0.0.0.0"]) {
      expect(erros(carregar({ PUBLIC_APP_URL: host })), host).toContain(
        `${AUTH_EMAIL_ENV_KEYS.publicAppUrl} nao pode ser um host local em producao`,
      );
    }
  });

  it("(13) recusa URL nao absoluta", () => {
    expect(erros(carregar({ PUBLIC_APP_URL: "cinerie.com" }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.publicAppUrl} nao e uma URL absoluta valida`,
    );
  });
});

describe("prazos", () => {
  it("(14) exige inteiro POSITIVO em minutos", () => {
    for (const invalido of ["0", "-5", "1.5", "abc", "", " ", "1e3", "+30"]) {
      const detalhes = erros(carregar({ PASSWORD_RESET_EXPIRATION_MINUTES: invalido }));
      expect(
        detalhes.some((d) => d.startsWith(AUTH_EMAIL_ENV_KEYS.passwordResetExpirationMinutes)),
        invalido,
      ).toBe(true);
    }
  });

  it("(15) tem teto de sanidade contra erro de digitacao", () => {
    expect(
      erros(carregar({ EMAIL_VERIFICATION_EXPIRATION_MINUTES: String(MAX_EXPIRATION_MINUTES + 1) })),
    ).toContain(
      `${AUTH_EMAIL_ENV_KEYS.emailVerificationExpirationMinutes} excede o teto de ${MAX_EXPIRATION_MINUTES} minutos`,
    );
    // O proprio teto e aceito (limite inclusivo).
    expect(
      carregar({ EMAIL_VERIFICATION_EXPIRATION_MINUTES: String(MAX_EXPIRATION_MINUTES) }).ok,
    ).toBe(true);
  });
});

describe("sal de hash de IP", () => {
  it("(16) e opcional, mas exige tamanho minimo quando presente", () => {
    const curto = "x".repeat(MIN_IP_HASH_SALT_LENGTH - 1);
    expect(erros(carregar({ CINERIE_IP_HASH_SALT: curto }))).toContain(
      `${AUTH_EMAIL_ENV_KEYS.ipHashSalt} deve ter no minimo ${MIN_IP_HASH_SALT_LENGTH} caracteres`,
    );
    const ok = carregar({ CINERIE_IP_HASH_SALT: "y".repeat(MIN_IP_HASH_SALT_LENGTH) });
    expect(ok.ok && ok.value.ipHashSalt).toBe("y".repeat(MIN_IP_HASH_SALT_LENGTH));
  });
});

describe("as mensagens de erro nunca ecoam VALOR", () => {
  it("(17) nem a chave, nem o remetente, nem a URL aparecem nos detalhes", () => {
    const detalhes = erros(
      carregar({
        BREVO_SENDER_EMAIL: "remetente-secreto-invalido",
        PUBLIC_APP_URL: "https://user:senha-do-servidor@host-interno.local/app?a=1#b",
        PASSWORD_RESET_EXPIRATION_MINUTES: "trinta",
      }),
    );
    const texto = detalhes.join(" | ");
    expect(texto).not.toContain(CHAVE_FICTICIA);
    expect(texto).not.toContain("remetente-secreto-invalido");
    expect(texto).not.toContain("senha-do-servidor");
    expect(texto).not.toContain("host-interno.local");
    expect(texto).not.toContain("trinta");
    // Mas o NOME da variavel esta la — sem ele o operador nao sabe o que corrigir.
    expect(texto).toContain(AUTH_EMAIL_ENV_KEYS.senderEmail);
    expect(texto).toContain(AUTH_EMAIL_ENV_KEYS.publicAppUrl);
  });

  it("(18) nenhuma variavel usa o prefixo NEXT_PUBLIC_", () => {
    for (const nome of Object.values(AUTH_EMAIL_ENV_KEYS)) {
      expect(nome.startsWith("NEXT_PUBLIC_"), nome).toBe(false);
    }
  });
});
