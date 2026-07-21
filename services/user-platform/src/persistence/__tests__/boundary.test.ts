/**
 * Fronteira da camada de PERSISTENCIA (C7A + C7B1). Prova por varredura da FONTE
 * REAL que:
 *
 *  - a RAIZ de `persistence/` tem SOMENTE contratos: nenhum PrismaClient,
 *    nenhum SQL, nenhum IO/rede/HTTP, nenhuma implementacao concreta;
 *  - `persistence/prisma/` — unico lugar autorizado a conhecer o driver — nao
 *    cria client, nao conecta/desconecta, nao abre transacao, nao loga, nao
 *    devolve model do Prisma e nao vaza segredo;
 *  - a direcao da dependencia continua persistence -> dominio.
 *
 * MUDANCA DE ESCOPO EM C7B1: ate C7B0 a varredura era recursiva e uma unica
 * regra ("nao ha implementacao concreta") valia para tudo sob `persistence/`.
 * Isso estava certo enquanto a camada era so contrato, mas proibiria o adapter
 * que o C7B1 existe para criar. A regra NAO foi relaxada — foi PARTIDA EM DUAS,
 * cada metade mais estrita no que lhe cabe: o contrato continua sem qualquer
 * corpo executavel, e o adapter ganha guardas que antes nao existiam.
 *
 * Toda guarda desta suite tem CONTROLE NEGATIVO: uma fonte sintetica defeituosa
 * que a guarda PRECISA acusar. Sem isso, uma varredura que nunca acha nada e
 * indistinguivel de uma varredura quebrada.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "services", "user-platform", "src");
const PERSISTENCE = path.join(SRC, "persistence");

/** Dominios PUROS que jamais podem depender da persistencia. */
const PURE_DOMAINS = [
  "core",
  "auth",
  "contracts",
  "privacy",
  "lists",
  "stats",
  "tracking",
  "ratings",
  "reviews",
  "recommendations",
];

interface SourceFile {
  readonly file: string;
  readonly content: string;
}

function filesUnder(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        // Toda fonte executavel, nao so `.ts`: um adapter em `.mts`/`.cts`/`.tsx`
        // (ou um `.js` solto) rodaria igual e ficaria invisivel para TODAS as
        // guardas se a varredura olhasse uma extensao so.
      } else if (/\.(m|c)?(t|j)sx?$/.test(entry)) {
        // Caminho SEMPRE normalizado com "/" — as comparacoes de escopo abaixo
        // dependem disso e o separador do Windows as quebraria em silencio.
        out.push({
          file: path.relative(SRC, full).split(path.sep).join("/"),
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

/** Arquivos que casam uma regra proibida — a forma testavel de cada guarda. */
function matching(files: readonly SourceFile[], forbidden: RegExp): string[] {
  return files.filter((f) => forbidden.test(stripComments(f.content))).map((f) => f.file);
}

// `__tests__` e comparado como SEGMENTO de caminho, nao como substring: com
// `includes`, uma pasta chamada `__tests__helpers` (ou um arquivo
// `x__tests__.ts`) sairia da varredura sem que ninguem percebesse.
const ALL = filesUnder(PERSISTENCE).filter((f) => !f.file.split("/").includes("__tests__"));

/** RAIZ de persistence/ — so contratos (exatamente 1 nivel abaixo). */
const CONTRACT_FILES = ALL.filter((f) => f.file.split("/").length === 2);

/** persistence/prisma/ — adapters concretos. */
const ADAPTER_FILES = ALL.filter((f) => f.file.startsWith("persistence/prisma/"));

/**
 * Arquivos sob `persistence/` que nao caem em NENHUM dos dois regimes.
 *
 * Partir a varredura em dois conjuntos abriu um buraco que a versao recursiva
 * nao tinha: `persistence/qualquer-outra-pasta/x.ts` escaparia das regras de
 * contrato (nao esta na raiz) E das regras de adapter (nao esta em `prisma/`) —
 * ficando sem NENHUMA guarda, em silencio. A cobertura passa a ser verificada
 * explicitamente: todo arquivo pertence a exatamente um regime.
 */
const UNGOVERNED_FILES = ALL.filter(
  (f) => !CONTRACT_FILES.includes(f) && !ADAPTER_FILES.includes(f),
);

// ---------------------------------------------------------------------------
// Regras proibidas, nomeadas para poderem ser aplicadas TAMBEM ao controle
// negativo. Uma regex que so e usada uma vez, dentro do `it`, nao pode ser
// provada falsificavel.
// ---------------------------------------------------------------------------

const NO_PRISMA = /@prisma\/client|PrismaClient|from\s+["']@?prisma|new\s+PrismaClient/;
const NO_RAW_SQL =
  /\bSELECT\b|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+\w+\s+SET\b|\$queryRaw|\$executeRaw|\$transaction/;
const NO_IO =
  /node:fs|node:net|node:http|\bfetch\s*\(|axios|next[/"']|react["']|\.\.\/\.\.\/\.\.\/apps|express|console\.(log|info|debug|warn|error)/i;
const NO_GENERIC_CRUD =
  /BaseRepository|interface\s+Repository\s*<|class\s+\w*Repository\b|GenericRepository/;
const NO_IMPLEMENTATION = /\bclass\s+\w+|=>\s*\{|\bfunction\s+\w+\s*\(/;
const NO_SESSION_SECRET =
  /\btokenHash\b|\btoken_hash\b|\brawToken\b|\bsecret\b|\bcsrf\b|sessionToken|resetToken|verificationToken|ipHash|ipAddress|reviewBody|moderationNote/i;

describe("cobertura da fronteira: nenhum arquivo sem regime", () => {
  it("(1) todo arquivo sob persistence/ cai em contrato OU adapter", () => {
    // Sem esta assercao, criar `persistence/sessions/store.ts` em C7B2 driblaria
    // as duas suites de uma vez — e o teste ficaria verde.
    expect(UNGOVERNED_FILES.map((f) => f.file)).toEqual([]);
  });

  it("(2) os dois regimes sao disjuntos e cobrem tudo (guarda nao vacua)", () => {
    expect(CONTRACT_FILES.length + ADAPTER_FILES.length).toBe(ALL.length);
    expect(ALL.length).toBeGreaterThan(3);
  });
});

describe("persistence/ (raiz): somente contratos (C7A)", () => {
  const files = CONTRACT_FILES;

  it("(1) ha modulos para varrer (guarda nao vacua)", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    // O escopo e a RAIZ: se um adapter escorregar para ca, as regras abaixo o
    // reprovam — e este teste garante que a lista nao ficou vazia por engano de
    // filtro (o modo silencioso de uma guarda morrer).
    expect(files.map((f) => f.file).sort()).toEqual([
      "persistence/index.ts",
      "persistence/ports.ts",
      "persistence/types.ts",
    ]);
  });

  it("(2) nao importa PrismaClient / @prisma / client concreto", () => {
    expect(matching(files, NO_PRISMA)).toEqual([]);
  });

  it("(3) nao contem SQL cru nem API de transacao concreta", () => {
    expect(matching(files, NO_RAW_SQL)).toEqual([]);
  });

  it("(4) nao importa HTTP/rede/Next/React/apps nem faz IO", () => {
    expect(matching(files, NO_IO)).toEqual([]);
  });

  it("(5) nao ha CRUD generico (BaseRepository / Repository<T>)", () => {
    expect(matching(files, NO_GENERIC_CRUD)).toEqual([]);
  });

  it("(6) nao ha implementacao concreta (so tipos/interfaces)", () => {
    expect(matching(files, NO_IMPLEMENTATION)).toEqual([]);
  });

  // C7B0 substituiu a regex-cobertor por assercoes PRECISAS. A antiga proibia
  // `email` e `credential` em bloco — calibrada para uma camada que so conhecia
  // recomendacoes. Com os contratos de identidade/credencial aprovados, aquela
  // regra passaria a barrar o desenho correto; o que importa provar e mais
  // forte e mais especifico: NENHUMA senha em claro, NENHUM token/segredo, e o
  // hash confinado ao contrato de credencial (jamais na identidade).

  it("(7) nenhum contrato aceita senha em TEXTO CLARO", () => {
    // Regra: QUALQUER campo cujo nome termine em "password" (case-insensitive)
    // e senha em claro. `passwordHash`/`expectedPasswordHash`/`nextPasswordHash`
    // terminam em "Hash" e sao PERMITIDOS (hash opaco, decisao aprovada).
    //
    // A versao anterior ancorava em `\bpassword` e deixava passar exatamente os
    // nomes canonicos do repo (`currentPassword`, `newPassword` em
    // contracts/auth-commands.ts) alem de `password?: string` — justamente o
    // vocabulario da proxima unidade (C7B2, recuperacao/troca).
    expect(plainPasswordFields(files)).toEqual([]);
  });

  it("(8) nenhum token/segredo de sessao, recuperacao ou verificacao nos contratos", () => {
    expect(matching(files, NO_SESSION_SECRET)).toEqual([]);
  });

  it("(9) o hash NUNCA aparece no registro de identidade", () => {
    const source = stripComments(contractTypesSource());
    const start = source.indexOf("export interface IdentityRecord");
    expect(start, "IdentityRecord nao encontrado (guarda nao vacua)").toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("}", start));
    expect(block).not.toMatch(/passwordHash|algorithm|credential/i);
  });

  it("(10) SO CredentialVerificationMaterial carrega o hash (interfaces E type aliases)", () => {
    const source = stripComments(contractTypesSource());
    const blocks = exportedTypeBlocks(source);
    // Guarda nao vacua: precisa enxergar tanto interfaces quanto type aliases.
    expect(blocks.length).toBeGreaterThan(8);
    expect(blocks.some((b) => b.name === "IdentityLookupResult")).toBe(true);

    // Autorizacao por PAPEL (portador declarado), nao por prefixo de nome:
    // entradas de escrita precisam do hash; qualquer OUTRO tipo, nao.
    const allowed = new Set([
      "CredentialVerificationMaterial",
      "CredentialCreateInput",
      "CredentialReplaceInput",
    ]);
    const leaking = blocks
      .filter((b) => carriesHashField(b.body))
      .map((b) => b.name)
      .filter((name) => !allowed.has(name));
    expect(leaking).toEqual([]);
  });

  it("(11) nenhum campo de TEXTO LIVRE nos contratos de conflito", () => {
    // `detail?: string` seria um canal de vazamento de hash/e-mail em runtime,
    // fora do alcance de qualquer varredura de fonte.
    const source = stripComments(contractTypesSource());
    const conflictBlocks = exportedTypeBlocks(source).filter((b) => /Conflict/.test(b.name));
    expect(conflictBlocks.length).toBeGreaterThan(0);
    for (const block of conflictBlocks) {
      expect(block.body, `${block.name} nao pode ter campo livre`).not.toMatch(
        /\bdetail\b|\bmessage\b|\bnote\b|\bdescription\b/i,
      );
    }
  });
});

/**
 * Fonte do `types.ts` DE CONTRATO, selecionada por caminho EXATO.
 *
 * A versao anterior usava `files.find((f) => f.file.endsWith("types.ts"))`. Com
 * a varredura recursiva e a ordem de `readdirSync`, um arquivo chamado
 * `persistence/prisma/types.ts` seria encontrado ANTES de `persistence/types.ts`
 * e as guardas (9)-(11) passariam a inspecionar o arquivo errado — ficando
 * verdes por acidente. Igualdade de caminho remove a armadilha inteira.
 */
function contractTypesSource(): string {
  const types = CONTRACT_FILES.find((f) => f.file === "persistence/types.ts");
  expect(types, "persistence/types.ts nao encontrado (guarda nao vacua)").toBeDefined();
  return types!.content;
}

/**
 * Extrai TODA declaracao exportada de tipo — `export interface X { ... }` E
 * `export type X = ...` (uniao ou nao). A versao anterior so varria
 * `interface`, e como TODOS os resultados desta camada sao `export type`
 * uniao, um `passwordHash` dentro de `IdentityLookupResult` escapava das tres
 * guardas ao mesmo tempo.
 */
function exportedTypeBlocks(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const m of source.matchAll(/export interface (\w+)\s*\{([\s\S]*?)\n\}/g)) {
    out.push({ name: m[1] ?? "", body: m[2] ?? "" });
  }
  // `export type X = ...;` ate o `;` que fecha a declaracao.
  for (const m of source.matchAll(/export type (\w+)\s*=([\s\S]*?);\s*(?:\n|$)/g)) {
    out.push({ name: m[1] ?? "", body: m[2] ?? "" });
  }
  return out;
}

/**
 * Detecta o hash como CAMPO declarado (`readonly ...PasswordHash:`), nao como
 * mencao textual — senao o proprio rotulo de alvo ("credential.passwordHash")
 * seria falso positivo.
 */
function carriesHashField(body: string): boolean {
  return /readonly\s+\w*passwordHash\s*\??\s*:/i.test(body);
}

/** Campos declarados cujo nome termina em "password" (= senha em claro). */
function plainPasswordFields(files: readonly SourceFile[]): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    const code = stripComments(f.content);
    const declaration = /readonly\s+(\w+)\s*\??\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = declaration.exec(code)) !== null) {
      const field = m[1] ?? "";
      if (/password$/i.test(field)) offenders.push(`${f.file}: ${field}`);
    }
    if (/\bplainPassword\b|\brawPassword\b/i.test(code)) offenders.push(`${f.file}: plain/raw`);
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// C7B1 — adapters concretos
// ---------------------------------------------------------------------------

const NO_CLIENT_LIFECYCLE = /new\s+PrismaClient|\$connect\b|\$disconnect\b|\$transaction\b/;
const NO_LOGGING = /console\.\w+\s*\(|\blogger\b|process\.stdout|process\.stderr/;
const NO_UNSAFE_TS = /\bany\b|as\s+unknown\s+as|@ts-ignore|@ts-expect-error/;
const NO_EAGER_LOAD = /include\s*:/;
const NO_HTTP = /node:http|next[/"']|react["']|\bfetch\s*\(|express|cookies|csrf/i;

/**
 * Extrai cada chamada a uma delegacao do executor, com parentese balanceado.
 * Regex sozinha nao consegue delimitar o argumento (objetos aninhados), e e
 * exatamente dentro dele que `select` precisa estar.
 */
function delegateCalls(rawSource: string): { method: string; call: string }[] {
  // Literais de string viram vazio ANTES da contagem: um parentese solto dentro
  // de uma string desbalancearia a varredura e a chamada "vazaria" ate o fim do
  // arquivo — engolindo o `select` de OUTRA chamada e mascarando o defeito. Um
  // falso NEGATIVO silencioso e o pior modo de falha de uma guarda.
  const source = rawSource.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const out: { method: string; call: string }[] = [];
  // Ancorado no NOME DA DELEGACAO (`.user.` / `.passwordCredential.`), nunca no
  // nome do receptor: prender a guarda ao identificador `executor` faria um
  // simples rename para `db` — ou uma desestruturacao — zerar a varredura, e a
  // guarda passaria a reportar "nenhum infrator" porque nao viu NADA.
  const re = /\.(?:user|passwordCredential)\.(\w+)\(/g;
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
    out.push({ method: m[1] ?? "", call: source.slice(m.index, i + 1) });
  }
  return out;
}

/**
 * Metodos que devolvem LINHA — e que por isso exigem `select` explicito.
 *
 * As variantes `*OrThrow` e `*AndReturn` estao aqui porque tambem materializam
 * linha: omiti-las deixaria uma troca trivial (`findUnique` -> `findUniqueOrThrow`)
 * escapar da guarda sem que nada ficasse vermelho.
 */
const ROW_RETURNING = new Set([
  "create",
  "createManyAndReturn",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "updateManyAndReturn",
  "upsert",
]);

function callsWithoutSelect(files: readonly SourceFile[]): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    for (const { method, call } of delegateCalls(stripComments(f.content))) {
      if (ROW_RETURNING.has(method) && !/select\s*:/.test(call)) {
        offenders.push(`${f.file}: ${method}`);
      }
    }
  }
  return offenders;
}

describe("persistence/prisma/: adapters concretos (C7B1)", () => {
  const files = ADAPTER_FILES;

  it("(1) ha adapters para varrer (guarda nao vacua)", () => {
    expect(files.map((f) => f.file).sort()).toEqual([
      "persistence/prisma/error-mapping.ts",
      "persistence/prisma/executor.ts",
      "persistence/prisma/identity-store.ts",
      "persistence/prisma/index.ts",
      "persistence/prisma/mappers.ts",
      "persistence/prisma/password-credential-store.ts",
    ]);
  });

  it("(2) nenhum adapter cria client nem gerencia conexao/transacao", () => {
    expect(matching(files, NO_CLIENT_LIFECYCLE)).toEqual([]);
  });

  it("(3) o Prisma entra SO como import de TIPO", () => {
    // Import de valor traria o runtime do driver para dentro do adapter; import
    // de tipo desaparece na compilacao. A checagem e por LINHA de import.
    const offenders: string[] = [];
    for (const f of files) {
      for (const line of stripComments(f.content).split(/\r?\n/)) {
        if (!/^\s*import\b/.test(line)) continue;
        if (!/@prisma\/client|@screena\/db/.test(line)) continue;
        if (!/^\s*import\s+type\b/.test(line)) offenders.push(`${f.file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("(4) nenhum adapter loga (o hash nunca pode chegar a um log)", () => {
    expect(matching(files, NO_LOGGING)).toEqual([]);
  });

  it("(5) nenhum SQL cru", () => {
    expect(matching(files, NO_RAW_SQL)).toEqual([]);
  });

  it("(6) nenhum HTTP/Next/React/cookie/CSRF", () => {
    expect(matching(files, NO_HTTP)).toEqual([]);
  });

  it("(7) nenhum `any`, cast duplo ou supressao de typecheck", () => {
    expect(matching(files, NO_UNSAFE_TS)).toEqual([]);
  });

  it("(8) nenhum `include:` (model Prisma nunca vaza por relacao)", () => {
    expect(matching(files, NO_EAGER_LOAD)).toEqual([]);
  });

  it("(9) TODA leitura/escrita que devolve linha usa `select` explicito", () => {
    expect(callsWithoutSelect(files)).toEqual([]);
  });

  it("(10) o hash nunca entra em mensagem de erro nem em template string", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(f.content);
      for (const m of code.matchAll(/throw new \w*Error\(([^)]*)\)/g)) {
        if (/hash/i.test(m[1] ?? "")) offenders.push(`${f.file}: throw`);
      }
      for (const m of code.matchAll(/\$\{([^}]*)\}/g)) {
        if (/hash|password/i.test(m[1] ?? "")) offenders.push(`${f.file}: template`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("(11) nenhum adapter aceita senha em texto claro", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(f.content);
      // Campo declarado E parametro nomeado — o adapter tem funcoes, nao so
      // interfaces, entao a deteccao por `readonly` do contrato nao basta.
      for (const m of code.matchAll(/\b(\w+)\s*:\s*string\b/g)) {
        const name = m[1] ?? "";
        if (/password$/i.test(name)) offenders.push(`${f.file}: ${name}`);
      }
      if (/\bplainPassword\b|\brawPassword\b|\bnewPassword\b|\bcurrentPassword\b/i.test(code)) {
        offenders.push(`${f.file}: plain/raw`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("(12) adapters nao importam outro dominio da user platform", () => {
    // Permitido: contratos (`../types.js`, `../ports.js`), o enum compartilhado
    // (`../../core/types.js`), vizinhos locais (`./`) e tipos do driver.
    // Ancorado no INICIO e no FIM: `^\.\/` sozinho autorizaria
    // `./../../auth/flows.js`, que sai do diretorio e alcanca o dominio — o
    // exato import que esta guarda existe para impedir.
    const allowed =
      /^(\.\/[\w.-]+\.js|\.\.\/(types|ports)\.js|\.\.\/\.\.\/core\/types\.js|@prisma\/client|@screena\/db(\/server)?)$/;
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of stripComments(f.content).matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1] ?? "";
        if (!allowed.test(spec)) offenders.push(`${f.file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * CONTROLES NEGATIVOS. Cada guarda acima e alimentada com uma fonte sintetica
 * que a viola: se a guarda estiver quebrada (regex frouxa, escopo vazio,
 * extrator que nao enxerga a construcao), ela fica VERDE la em cima e VERMELHA
 * aqui. Sem este bloco, "nenhum infrator" nao prova nada.
 */
describe("controles negativos: as guardas realmente reprovam", () => {
  const fake = (content: string): SourceFile[] => [{ file: "fake.ts", content }];

  it("(1) detecta criacao de client e ciclo de conexao", () => {
    expect(matching(fake("const c = new PrismaClient();"), NO_CLIENT_LIFECYCLE)).toEqual([
      "fake.ts",
    ]);
    expect(matching(fake("await executor.$disconnect();"), NO_CLIENT_LIFECYCLE)).toEqual([
      "fake.ts",
    ]);
    expect(matching(fake("await prisma.$transaction(fn);"), NO_CLIENT_LIFECYCLE)).toEqual([
      "fake.ts",
    ]);
  });

  it("(2) detecta log", () => {
    expect(matching(fake("console.error(hash);"), NO_LOGGING)).toEqual(["fake.ts"]);
    expect(matching(fake("logger.warn(x);"), NO_LOGGING)).toEqual(["fake.ts"]);
  });

  it("(3) detecta `any`, cast duplo e supressao", () => {
    expect(matching(fake("const x: any = row;"), NO_UNSAFE_TS)).toEqual(["fake.ts"]);
    expect(matching(fake("const x = row as unknown as Foo;"), NO_UNSAFE_TS)).toEqual(["fake.ts"]);
  });

  it("(4) detecta include: e SQL cru", () => {
    expect(matching(fake("findUnique({ include: { user: true } })"), NO_EAGER_LOAD)).toEqual([
      "fake.ts",
    ]);
    expect(matching(fake("await x.$queryRaw`SELECT 1`;"), NO_RAW_SQL)).toEqual(["fake.ts"]);
  });

  it("(5) detecta leitura SEM select — inclusive com objeto aninhado", () => {
    // O aninhamento e o ponto: um extrator ingenuo pararia no primeiro `}` e
    // concluiria que a chamada "termina" antes de poder ver que falta `select`.
    const semSelect = "await executor.user.findUnique({ where: { emailNormalized: e } });";
    expect(callsWithoutSelect(fake(semSelect))).toEqual(["fake.ts: findUnique"]);

    const comSelect =
      "await executor.user.findUnique({ where: { emailNormalized: e }, select: { id: true } });";
    expect(callsWithoutSelect(fake(comSelect))).toEqual([]);
  });

  it("(5b) parentese dentro de string nao cega o extrator", () => {
    // Sem a remocao de literais, o `(` da string desbalancearia a contagem, a
    // chamada se estenderia ate o fim do arquivo e engoliria o `select` da
    // chamada SEGUINTE — deixando a falta passar despercebida.
    const armadilha = [
      'await executor.user.findUnique({ where: { email: "abre ( sem fechar" } });',
      "await executor.user.create({ data: {}, select: { id: true } });",
    ].join("\n");
    expect(callsWithoutSelect(fake(armadilha))).toEqual(["fake.ts: findUnique"]);
  });

  it("(5c) o extrator NAO depende do nome do receptor", () => {
    // Se estivesse ancorado em `executor.`, renomear para `db` zeraria a
    // varredura e a guarda reportaria "nenhum infrator" por cegueira.
    expect(callsWithoutSelect(fake("await db.user.findUnique({ where: { id: 1n } });"))).toEqual([
      "fake.ts: findUnique",
    ]);
    expect(
      callsWithoutSelect(fake("await this.client.passwordCredential.create({ data: {} });")),
    ).toEqual(["fake.ts: create"]);
  });

  it("(5d) as variantes OrThrow/AndReturn tambem exigem select", () => {
    for (const method of [
      "findUniqueOrThrow",
      "findFirstOrThrow",
      "createManyAndReturn",
      "updateManyAndReturn",
    ]) {
      expect(callsWithoutSelect(fake(`await executor.user.${method}({ where: {} });`))).toEqual([
        `fake.ts: ${method}`,
      ]);
    }
    // Controle positivo: `updateMany` nao devolve linha e segue fora da regra.
    expect(callsWithoutSelect(fake("await executor.user.updateMany({ where: {} });"))).toEqual([]);
  });

  it("(5e) a allowlist de imports barra fuga por caminho relativo", () => {
    const fuga = /^(\.\/[\w.-]+\.js|\.\.\/(types|ports)\.js|\.\.\/\.\.\/core\/types\.js|@prisma\/client|@screena\/db(\/server)?)$/;
    // `./../../auth/flows.js` comeca com "./" e escaparia de uma allowlist
    // ancorada so no inicio.
    expect(fuga.test("./../../auth/flows.js")).toBe(false);
    expect(fuga.test("../../auth/flows.js")).toBe(false);
    // Controles positivos: os imports legitimos continuam autorizados.
    expect(fuga.test("./mappers.js")).toBe(true);
    expect(fuga.test("../types.js")).toBe(true);
    expect(fuga.test("@screena/db/server")).toBe(true);
  });

  it("(6) detecta senha em claro como campo declarado", () => {
    expect(plainPasswordFields(fake("readonly password: string;"))).toEqual(["fake.ts: password"]);
    expect(plainPasswordFields(fake("readonly newPassword: string;"))).toEqual([
      "fake.ts: newPassword",
    ]);
    // Controle positivo: hash opaco continua permitido.
    expect(plainPasswordFields(fake("readonly passwordHash: string;"))).toEqual([]);
  });

  it("(7) detecta hash carregado por type alias, nao so por interface", () => {
    const alias = "export type Leak = { readonly passwordHash: string };";
    const blocks = exportedTypeBlocks(alias);
    expect(blocks.some((b) => b.name === "Leak" && carriesHashField(b.body))).toBe(true);
  });

  it("(8) detecta implementacao concreta e import de Prisma", () => {
    expect(matching(fake("export function f() { return 1; }"), NO_IMPLEMENTATION)).toEqual([
      "fake.ts",
    ]);
    expect(matching(fake('import { PrismaClient } from "@prisma/client";'), NO_PRISMA)).toEqual([
      "fake.ts",
    ]);
  });
});

describe("direcao da dependencia: dominio puro NAO conhece persistence/", () => {
  it("(1) nenhum dominio puro importa persistence/", () => {
    const offenders: string[] = [];
    for (const domain of PURE_DOMAINS) {
      for (const f of filesUnder(path.join(SRC, domain))) {
        const code = stripComments(f.content);
        if (/from\s+["'][^"']*persistence/.test(code)) {
          offenders.push(f.file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
