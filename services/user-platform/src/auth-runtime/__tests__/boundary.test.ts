/**
 * FRONTEIRA das camadas novas de C7C, provada por varredura da FONTE REAL.
 *
 * O que estas guardas travam:
 *  - o dominio puro e a persistencia NAO conhecem a Brevo;
 *  - o provedor NAO conhece Prisma, banco nem HTTP da aplicacao;
 *  - a chave da Brevo so existe no provedor e no composition root;
 *  - `process.env` so e lido no composition root;
 *  - o fornecedor NUNCA e chamado de dentro de uma transacao;
 *  - o evento de log e um tipo FECHADO, sem campo livre por onde PII escape;
 *  - nada no repositorio usa endpoint de campanha, `listIds` ou o SDK antigo;
 *  - nenhum codigo de cliente do app publico alcanca o runtime.
 *
 * TODA guarda tem CONTROLE NEGATIVO: uma fonte sintetica que ela PRECISA
 * acusar. Sem isso, "nenhum infrator" e indistinguivel de uma varredura
 * quebrada — foi exatamente assim que uma guarda de C7B2 ficou verde por
 * vacuidade.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = process.cwd();
const SRC = path.join(REPO, "services", "user-platform", "src");

interface SourceFile {
  readonly file: string;
  readonly content: string;
}

const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".next", ".turbo"]);

function filesUnder(dir: string, root: string): SourceFile[] {
  const out: SourceFile[] = [];
  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        if (IGNORED_DIRS.has(entry)) continue;
        walk(full);
      } else if (/\.(m|c)?(t|j)sx?$/.test(entry)) {
        out.push({
          file: path.relative(root, full).split(path.sep).join("/"),
          content: readFileSync(full, "utf8"),
        });
      }
    }
  }
  walk(dir);
  return out;
}

function stripComments(content: string): string {
  const noBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 && line[i - 1] !== ":" ? line.slice(0, i) : line;
    })
    .join("\n");
}

function matching(files: readonly SourceFile[], forbidden: RegExp): string[] {
  return files.filter((f) => forbidden.test(stripComments(f.content))).map((f) => f.file);
}

/** Fonte sintetica para os controles negativos. */
const fake = (content: string): SourceFile[] => [{ file: "fake.ts", content }];

const ALL = filesUnder(SRC, SRC).filter((f) => !f.file.split("/").includes("__tests__"));

const DOMAIN_DIRS = [
  "core",
  "auth",
  "contracts",
  "email",
  "privacy",
  "lists",
  "stats",
  "tracking",
  "ratings",
  "reviews",
  "recommendations",
];

const DOMAIN_FILES = ALL.filter((f) => DOMAIN_DIRS.includes(f.file.split("/")[0] ?? ""));
const PERSISTENCE_FILES = ALL.filter((f) => f.file.startsWith("persistence/"));
const PROVIDER_FILES = ALL.filter((f) => f.file.startsWith("providers/"));
const HTTP_FILES = ALL.filter((f) => f.file.startsWith("http/"));
const RUNTIME_FILES = ALL.filter((f) => f.file.startsWith("auth-runtime/"));

// ---------------------------------------------------------------------------
// Regras nomeadas (para poderem ser aplicadas TAMBEM ao controle negativo)
// ---------------------------------------------------------------------------

const KNOWS_BREVO = /brevo|api\.brevo\.com|["']api-key["']|xkeysib/i;
const KNOWS_PRISMA = /@prisma\/client|PrismaClient|@screena\/db|\$transaction/;
const READS_ENV = /process\s*\.\s*env/;
const CAMPAIGN_API = /emailCampaigns|\blistIds\b|sib-api-v3-sdk|CreateEmailCampaign|EmailCampaignsApi/;

describe("(0) a varredura enxerga codigo de verdade (anti-vacuidade)", () => {
  it("cada camada tem arquivos", () => {
    expect(DOMAIN_FILES.length).toBeGreaterThan(20);
    expect(PERSISTENCE_FILES.length).toBeGreaterThan(5);
    expect(PROVIDER_FILES.length).toBe(2);
    // C7D acrescentou cookies.ts e authenticated-handlers.ts a http/, e
    // account.ts, privacy-services.ts e identity-read.ts a auth-runtime/. A
    // guarda continua sendo anti-vacua (piso >), nao um contador fragil.
    expect(HTTP_FILES.length).toBeGreaterThan(4);
    expect(RUNTIME_FILES.length).toBeGreaterThan(7);
  });

  it("os arquivos esperados de C7C existem com os nomes esperados", () => {
    const nomes = new Set(ALL.map((f) => f.file));
    for (const esperado of [
      "email/types.ts",
      "email/links.ts",
      "email/templates.ts",
      "providers/brevo/transactional-email.ts",
      "auth-runtime/composition.ts",
      "auth-runtime/config.ts",
      "auth-runtime/dispatch.ts",
      "auth-runtime/throttle.ts",
      "http/handlers.ts",
      "persistence/prisma/auth-throttle-store.ts",
    ]) {
      expect(nomes.has(esperado), esperado).toBe(true);
    }
  });
});

describe("(1) o dominio e a persistencia NAO conhecem a Brevo", () => {
  it("nenhum dominio puro cita Brevo, endpoint ou header de chave", () => {
    expect(matching(DOMAIN_FILES, KNOWS_BREVO)).toEqual([]);
  });

  it("a persistencia tambem nao", () => {
    expect(matching(PERSISTENCE_FILES, KNOWS_BREVO)).toEqual([]);
  });

  it("nenhum dominio nem persistencia importa `providers/`", () => {
    const importaProvider = /from\s+["'][^"']*providers\//;
    expect(matching(DOMAIN_FILES, importaProvider)).toEqual([]);
    expect(matching(PERSISTENCE_FILES, importaProvider)).toEqual([]);
  });

  it("controle negativo: a guarda acusa fonte que cita a Brevo", () => {
    expect(matching(fake('const u = "https://api.brevo.com/v3/smtp/email";'), KNOWS_BREVO)).toEqual([
      "fake.ts",
    ]);
    expect(matching(fake('headers: { "api-key": k }'), KNOWS_BREVO)).toEqual(["fake.ts"]);
    expect(matching(fake('import { x } from "../providers/brevo/index.js";'), /providers\//)).toEqual(
      ["fake.ts"],
    );
    // Controle POSITIVO: o port agnostico nao pode ser acusado.
    expect(matching(fake("interface TransactionalEmailProvider {}"), KNOWS_BREVO)).toEqual([]);
  });
});

describe("(2) o provedor NAO conhece Prisma, banco nem persistencia", () => {
  it("nenhum arquivo de providers/ toca driver ou transacao", () => {
    expect(matching(PROVIDER_FILES, KNOWS_PRISMA)).toEqual([]);
  });

  it("providers/ so importa o port de e-mail e vizinhos locais", () => {
    const permitido = /^(\.\/[\w.-]+\.js|\.\.\/\.\.\/email\/[\w.-]+\.js)$/;
    const infratores: string[] = [];
    for (const f of PROVIDER_FILES) {
      for (const m of stripComments(f.content).matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1] ?? "";
        if (!permitido.test(spec)) infratores.push(`${f.file}: ${spec}`);
      }
    }
    expect(infratores).toEqual([]);
  });

  it("o provedor nao le `process.env` (a chave chega por parametro)", () => {
    expect(matching(PROVIDER_FILES, READS_ENV)).toEqual([]);
  });

  it("o provedor nao escreve em log", () => {
    expect(matching(PROVIDER_FILES, /console\.\w+\s*\(|\blogger\b|process\.stdout/)).toEqual([]);
  });

  it("controle negativo: a guarda acusa provider que toca Prisma ou env", () => {
    expect(matching(fake('import { PrismaClient } from "@prisma/client";'), KNOWS_PRISMA)).toEqual([
      "fake.ts",
    ]);
    expect(matching(fake("const k = process.env.BREVO_API_KEY;"), READS_ENV)).toEqual(["fake.ts"]);
    expect(matching(fake("console.error(resposta);"), /console\.\w+\s*\(/)).toEqual(["fake.ts"]);
  });
});

describe("(3) `process.env` so no composition root", () => {
  it("nenhum arquivo alem de auth-runtime/composition.ts le o ambiente", () => {
    const leitores = matching(ALL, READS_ENV);
    expect(leitores).toEqual(["auth-runtime/composition.ts"]);
  });

  it("a config recebe o ambiente por PARAMETRO (nao o le)", () => {
    const config = ALL.find((f) => f.file === "auth-runtime/config.ts");
    expect(config, "config.ts nao encontrado (guarda nao vacua)").toBeDefined();
    expect(READS_ENV.test(stripComments(config!.content))).toBe(false);
    expect(config!.content).toContain("EnvSource");
  });
});

describe("(4) a chave da Brevo tem alcance minimo", () => {
  it("`apiKey`/BREVO_API_KEY so aparecem no provedor, na config e na composicao", () => {
    const portadores = matching(ALL, /\bapiKey\b|BREVO_API_KEY|brevoApiKey/);
    expect(portadores.sort()).toEqual([
      "auth-runtime/composition.ts",
      "auth-runtime/config.ts",
      "providers/brevo/transactional-email.ts",
    ]);
  });

  it("nenhuma variavel de ambiente do fluxo usa prefixo NEXT_PUBLIC_", () => {
    expect(matching(ALL, /NEXT_PUBLIC_/)).toEqual([]);
  });
});

describe("(5) a Brevo NUNCA e chamada de dentro de uma transacao", () => {
  /** Corpo do callback de `runInTransaction`, por contagem de chaves. */
  function corposDeTransacao(source: string): string[] {
    const out: string[] = [];
    const re = /runInTransaction\s*(?:<[^>]*>)?\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out.push(source.slice(m.index, i + 1));
    }
    return out;
  }

  const CHAMA_FORNECEDOR = /dispatchAuthEmail|emailProvider|sendEmailVerification|sendPasswordReset/;

  it("os servicos de aplicacao chamam o fornecedor FORA do bloco transacional", () => {
    const servicos = RUNTIME_FILES.filter(
      (f) => f.file.endsWith("email-verification.ts") || f.file.endsWith("password-recovery.ts"),
    );
    expect(servicos).toHaveLength(2);

    const infratores: string[] = [];
    for (const f of servicos) {
      const corpos = corposDeTransacao(stripComments(f.content));
      // Cada servico tem exatamente dois blocos transacionais (pedido e confirmacao).
      expect(corpos.length, `${f.file}: blocos transacionais`).toBe(2);
      for (const corpo of corpos) {
        if (CHAMA_FORNECEDOR.test(corpo)) infratores.push(f.file);
      }
    }
    expect(infratores).toEqual([]);
  });

  it("so a composicao abre transacao; os servicos nunca chamam o driver", () => {
    // A guarda acima e ancorada no literal `runInTransaction(`. Um servico que
    // chamasse `prisma.$transaction` direto (ou guardasse o runner num alias)
    // escaparia dela — e poderia abrir uma transacao com o envio dentro. Aqui a
    // regra e complementar e independente: fora da composicao, NINGUEM alcanca o
    // driver.
    const foraDaComposicao = [...RUNTIME_FILES, ...HTTP_FILES].filter(
      (f) => f.file !== "auth-runtime/composition.ts",
    );
    expect(foraDaComposicao.length).toBeGreaterThan(8);
    expect(matching(foraDaComposicao, KNOWS_PRISMA)).toEqual([]);
  });

  it("o modulo que fala com o fornecedor nao conhece persistencia", () => {
    const dispatch = ALL.find((f) => f.file === "auth-runtime/dispatch.ts");
    expect(dispatch, "dispatch.ts nao encontrado (guarda nao vacua)").toBeDefined();
    const code = stripComments(dispatch!.content);
    expect(/from\s+["'][^"']*persistence/.test(code)).toBe(false);
    expect(KNOWS_PRISMA.test(code)).toBe(false);
  });

  it("controle negativo: o extrator acusa envio DENTRO da transacao", () => {
    const ruim = [
      "const r = await deps.runInTransaction(async (scope, stores) => {",
      "  const t = await stores.authTokens.issue(scope, record);",
      "  await dispatchAuthEmail({ provider: deps.emailProvider });",
      "  return t;",
      "});",
    ].join("\n");
    const corpos = corposDeTransacao(ruim);
    expect(corpos).toHaveLength(1);
    expect(CHAMA_FORNECEDOR.test(corpos[0]!)).toBe(true);

    // Controle POSITIVO: envio depois do bloco nao e acusado.
    const bom = [
      "const r = await deps.runInTransaction(async (scope, stores) => {",
      "  return stores.authTokens.issue(scope, record);",
      "});",
      "await dispatchAuthEmail({ provider: deps.emailProvider });",
    ].join("\n");
    expect(CHAMA_FORNECEDOR.test(corposDeTransacao(bom)[0]!)).toBe(false);
  });
});

describe("(6) o evento de log e um tipo FECHADO", () => {
  it("nao ha campo de texto livre nem PII declarada no evento", () => {
    const obs = ALL.find((f) => f.file === "auth-runtime/observability.ts");
    expect(obs, "observability.ts nao encontrado (guarda nao vacua)").toBeDefined();
    const inicio = obs!.content.indexOf("export interface AuthEmailLogEvent");
    expect(inicio).toBeGreaterThan(-1);
    const bloco = stripComments(obs!.content.slice(inicio, obs!.content.indexOf("\n}", inicio)));

    const campos = [...bloco.matchAll(/readonly\s+(\w+)\s*:/g)].map((m) => m[1] ?? "");
    expect(campos.sort()).toEqual(
      [
        "correlationId",
        "durationMs",
        "failureCategory",
        "internalReason",
        "outcome",
        "provider",
        "providerMessageId",
        "purpose",
      ].sort(),
    );
    // Nenhum campo capaz de carregar segredo ou PII.
    for (const proibido of [
      /\bemail\b/i,
      /\btoken\b/i,
      /\bhash\b/i,
      /\bpassword\b/i,
      /\bip\b/i,
      /\buserId\b/i,
      /\bdetail\b/i,
      /\bmessage\b/i,
      /\bmetadata\b/i,
    ]) {
      expect(proibido.test(campos.join(" ")), String(proibido)).toBe(false);
    }
  });

  it("nenhum modulo de runtime ou HTTP escreve direto em console", () => {
    expect(matching([...RUNTIME_FILES, ...HTTP_FILES], /console\.\w+\s*\(/)).toEqual([]);
  });
});

describe("(7) a borda HTTP nao contem politica de dominio", () => {
  it("handlers nao importam persistencia, Prisma nem o provedor concreto", () => {
    const code = HTTP_FILES.map((f) => stripComments(f.content)).join("\n");
    expect(/from\s+["'][^"']*persistence\/prisma/.test(code)).toBe(false);
    expect(/from\s+["'][^"']*providers\//.test(code)).toBe(false);
    expect(KNOWS_PRISMA.test(code)).toBe(false);
    expect(KNOWS_BREVO.test(code)).toBe(false);
  });

  it("handlers nao decidem elegibilidade nem throttle", () => {
    // As decisoes vivem no dominio e no runtime; a borda so traduz.
    const code = HTTP_FILES.map((f) => stripComments(f.content)).join("\n");
    for (const politica of [
      /accountCanHoldSession/,
      /evaluateThrottle/,
      /registerFailure/,
      /evaluatePasswordResetRequest/,
      /evaluateVerificationResend/,
      /applyEmailVerification/,
      /applyPasswordReset/,
    ]) {
      expect(politica.test(code), String(politica)).toBe(false);
    }
  });
});

describe("(8) NADA no repositorio usa campanha, listIds ou SDK antigo", () => {
  const RAIZES = ["services", "packages", "api-clients", "apps", "scripts", "tests"];

  /**
   * Os termos proibidos aparecem legitimamente em UM lugar: dentro de uma
   * assercao que prova a AUSENCIA deles. Por isso a varredura de producao ignora
   * `__tests__` — e o teste seguinte trava exatamente QUAIS suites podem cita-los,
   * para que a excecao nao cresca em silencio.
   */
  function citamCampanha(raizes: readonly string[], emTestes: boolean): string[] {
    const infratores: string[] = [];
    for (const raiz of raizes) {
      for (const f of filesUnder(path.join(REPO, raiz), REPO)) {
        const eTeste = f.file.split("/").includes("__tests__");
        if (eTeste !== emTestes) continue;
        if (CAMPAIGN_API.test(stripComments(f.content))) infratores.push(f.file);
      }
    }
    return infratores.sort();
  }

  it("NENHUM codigo de producao cita endpoint de campanha ou o SDK legado", () => {
    expect(citamCampanha(RAIZES, false)).toEqual([]);
  });

  it("so as duas suites de controle negativo podem nomear os termos proibidos", () => {
    // Se uma suite nova passar a citar `emailCampaigns`/`listIds`, esta lista
    // muda e o teste falha — o que forca a revisao a olhar o caso, em vez de a
    // excecao virar um buraco permanente.
    expect(citamCampanha(RAIZES, true)).toEqual([
      "services/user-platform/src/auth-runtime/__tests__/boundary.test.ts",
      "services/user-platform/src/providers/brevo/__tests__/transactional-email.test.ts",
    ]);
  });

  it("o lockfile nao ganhou o SDK da Brevo", () => {
    const lock = readFileSync(path.join(REPO, "pnpm-lock.yaml"), "utf8");
    expect(lock).not.toContain("sib-api-v3-sdk");
    expect(lock).not.toContain("@getbrevo/brevo");
  });

  it("controle negativo: a guarda acusa campanha e listIds", () => {
    expect(matching(fake('await fetch("https://api.brevo.com/v3/emailCampaigns");'), CAMPAIGN_API)).toEqual(
      ["fake.ts"],
    );
    expect(matching(fake("const body = { listIds: [2] };"), CAMPAIGN_API)).toEqual(["fake.ts"]);
    expect(matching(fake('import Sib from "sib-api-v3-sdk";'), CAMPAIGN_API)).toEqual(["fake.ts"]);
    // Controle POSITIVO: o endpoint transacional nao e acusado.
    expect(matching(fake('const u = "https://api.brevo.com/v3/smtp/email";'), CAMPAIGN_API)).toEqual(
      [],
    );
  });
});

describe("(9) nenhum codigo de CLIENTE alcanca o runtime", () => {
  const WEB = path.join(REPO, "apps", "web");

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

  const webFiles = filesUnder(WEB, REPO);

  it("ha arquivos do app publico para varrer (guarda nao vacua)", () => {
    expect(webFiles.length).toBeGreaterThan(10);
  });

  it("nenhum client component importa o runtime, o provedor ou a chave", () => {
    const infratores: string[] = [];
    for (const f of webFiles) {
      if (!hasUseClient(f.content)) continue;
      const code = stripComments(f.content);
      if (/@screena\/user-platform|user-platform\/src|providers\/brevo/.test(code)) {
        infratores.push(`${f.file}: importa runtime`);
      }
      if (KNOWS_BREVO.test(code) || /BREVO_/.test(code)) {
        infratores.push(`${f.file}: cita Brevo`);
      }
    }
    expect(infratores).toEqual([]);
  });

  it("nenhum arquivo do app publico cita variavel BREVO_", () => {
    const infratores = webFiles
      .filter((f) => /BREVO_/.test(stripComments(f.content)))
      .map((f) => f.file);
    expect(infratores).toEqual([]);
  });
});
