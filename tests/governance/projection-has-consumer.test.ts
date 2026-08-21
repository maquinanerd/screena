/**
 * projection-has-consumer.test.ts — TABELA DE PROJEÇÃO SEM CONSUMIDOR REPROVA.
 *
 * ============================================================================
 * O DEFEITO, E POR QUE ELE PASSOU MESES
 * ============================================================================
 * `discovery_snapshots` foi criada na Fase 8 para alimentar trilhos do site. O
 * job que a escreve existia, o schema existia, o store existia, os testes
 * existiam — e **nenhuma superfície a lia**. Enquanto isso, três trilhos que
 * deveriam sair dela ordenavam por `popularity` acumulada e afirmavam "em alta".
 *
 * É o irmão do defeito do **dado descartado** (`catalog sync` baixava
 * `watch/providers` em todo payload e o normalizador jogava fora, por mais de um
 * ano). Os dois são desperdício silencioso, em direções opostas:
 *
 *   dado descartado   — chega e ninguém GRAVA
 *   projeção órfã     — grava e ninguém LÊ
 *
 * Nenhum teste pega os dois, porque em ambos os casos cada metade funciona
 * perfeitamente sozinha. O que falta é a asserção sobre o ELO.
 *
 * ============================================================================
 * POR QUE "TEM ALGUM LEITOR" NÃO SERVE COMO REGRA
 * ============================================================================
 * Medido em 2026-08-21, ANTES da PR que ligou o trending: `discovery_snapshots`
 * já tinha três leitores em `services/` — o `catalog status`, um comando de
 * diagnóstico. Uma regra do tipo "escrita sem nenhuma leitura" daria VERDE e
 * teria deixado o defeito de pé por mais meses.
 *
 * O que estava errado não era a ausência de leitor: era o leitor estar no lugar
 * ERRADO. A tabela foi feita para uma superfície, e nenhuma superfície a lia.
 *
 * Por isso o registro abaixo declara, por projeção, **onde o consumidor tem de
 * estar**. É uma afirmação de INTENÇÃO, e ela precisa de humano — nenhuma
 * heurística deduz para que uma tabela foi criada.
 *
 * ============================================================================
 * O QUE ESTE TESTE NÃO FAZ (e a extensão que ficou de fora)
 * ============================================================================
 * Ele não DESCOBRE projeções novas: uma tabela ausente do registro não é
 * verificada. A extensão natural — varrer o schema e reprovar todo model com
 * escrita e zero leitura em qualquer lugar — não entrou porque exigiria medir o
 * ruído dela primeiro (muitos models são lidos por SQL bruto e por stores
 * compartilhados, e um guard que grita errado ensina a ignorar guard). Fica
 * registrado como o próximo passo, não como esquecimento.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(process.cwd());
const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Uma projeção: tabela derivada que existe para ser LIDA por alguém específico.
 *
 * `consumerDir` é a afirmação de intenção — o diretório onde o consumidor tem de
 * estar. `writerDir` é excluído da busca: o escritor lendo a própria tabela
 * (para dedupe, para checkpoint) não prova consumo nenhum.
 */
interface Projection {
  /** Model do Prisma, como aparece em `prisma.<model>.`. */
  readonly model: string;
  /** Nome da tabela, para leituras por SQL bruto. */
  readonly table: string;
  /**
   * Onde o consumidor TEM de estar.
   *
   * `apps/web/src/server` e nao `apps/web`, e a diferenca e uma asserção a mais,
   * de graca: no `apps/web` so `src/server/**` pode tocar o banco. Um leitor em
   * `scripts/` (validador) ou num componente NAO conta — o primeiro nao e
   * superficie, o segundo seria violacao de camada.
   *
   * Efeito colateral bem-vindo: varre 35 arquivos em vez de 287, e a varredura
   * deste guard parou de disputar I/O com a de `coverage-single-path`, cujo
   * `beforeAll` estourava 10 s na suíte completa.
   */
  readonly consumerDir: string;
  /** Onde o escritor vive. Leitura aqui não conta. */
  readonly writerDir: string;
  /** Para que a tabela foi criada. Obrigatório — é a intenção declarada. */
  readonly purpose: string;
  /**
   * Quando a projeção é lida através da RELAÇÃO de outra (o item de um
   * snapshot chega no `select: { items: ... }` do pai), o consumo do pai
   * satisfaz o filho. Sem isto, uma tabela lida de verdade reprovaria por não
   * ter acessor próprio.
   */
  readonly readVia?: string;
}

/**
 * O REGISTRO. Acrescentar linha aqui é declarar intenção; remover é declarar
 * que a tabela deixou de ser projeção.
 */
const PROJECTIONS: readonly Projection[] = [
  {
    model: "discoverySnapshot",
    table: "discovery_snapshots",
    consumerDir: "apps/web/src/server",
    writerDir: "services/ingestion",
    purpose:
      "Trilhos de descoberta do site (Em Alta, Popular essa semana). Escrita pelo job " +
      "sync_lists; lida pelas superfícies em apps/web/src/server/trending-snapshot.ts.",
  },
  {
    model: "discoverySnapshotItem",
    table: "discovery_snapshot_items",
    consumerDir: "apps/web/src/server",
    writerDir: "services/ingestion",
    readVia: "discoverySnapshot",
    purpose: "Itens do snapshot, lidos pela relação `items` do pai.",
  },
  {
    model: "searchDocument",
    table: "search_documents",
    consumerDir: "apps/web/src/server",
    writerDir: "services/ingestion",
    purpose: "Projeção de busca. Escrita pelo reindex; lida pela página de busca.",
  },
  {
    model: "cinerieScoreCalculation",
    table: "cinerie_score_calculations",
    consumerDir: "apps/web/src/server",
    writerDir: "services/ratings",
    purpose:
      "Histórico versionado do Cinerie Score. Escrito pelo worker offline; lido para " +
      "resolver a PROCEDÊNCIA da nota antes de exibi-la.",
  },
  {
    model: "pageIndexabilityDecision",
    table: "page_indexability_decisions",
    consumerDir: "apps/web/src/server",
    writerDir: "services/ingestion",
    purpose:
      "Decisão de indexabilidade por página. Escrita offline; lida pelo sitemap e pelo " +
      "meta robots — os dois NUNCA podem discordar dela.",
  },
];

/** Métodos do Prisma que são LEITURA. Escrita não prova consumo. */
const READ_METHODS = ["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"];

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
        // Teste não é consumidor: um mock lendo a tabela provaria só que alguém
        // escreveu um mock.
        if (entry.name === "__tests__") continue;
        await walk(full);
        continue;
      }
      if (!CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      if (entry.name.includes(".test.")) continue;
      out.push(full);
    }
  };
  await walk(dir);
  return out;
}

interface Reader {
  readonly file: string;
  readonly evidence: string;
}

function findReaders(files: readonly { path: string; source: string }[], projection: Projection): Reader[] {
  const readers: Reader[] = [];
  for (const file of files) {
    for (const method of READ_METHODS) {
      const needle = `prisma.${projection.model}.${method}`;
      if (file.source.includes(needle)) {
        readers.push({ file: relative(REPO_ROOT, file.path), evidence: needle });
        break;
      }
    }
    // Leitura por SQL bruto: a tabela citada num FROM/JOIN.
    if (
      new RegExp(`(from|join)\\s+"?${projection.table}"?`, "i").test(file.source) &&
      !readers.some((reader) => reader.file === relative(REPO_ROOT, file.path))
    ) {
      readers.push({ file: relative(REPO_ROOT, file.path), evidence: `SQL: ${projection.table}` });
    }
  }
  return readers;
}

let consumerFiles: Map<string, { path: string; source: string }[]>;

beforeAll(async () => {
  consumerFiles = new Map();
  const dirs = new Set(PROJECTIONS.map((projection) => projection.consumerDir));
  for (const dir of dirs) {
    const paths = await collectFiles(join(REPO_ROOT, dir));
    const loaded = await Promise.all(
      paths.map(async (path) => ({ path, source: await readFile(path, "utf8") })),
    );
    consumerFiles.set(dir, loaded);
  }
}, 60_000);

describe("toda projeção declarada tem consumidor ONDE ela foi feita para ser lida", () => {
  it.each(PROJECTIONS.map((projection) => [projection.model, projection] as const))(
    "%s",
    (_model, projection) => {
      const target = projection.readVia ?? projection.model;
      const resolved =
        projection.readVia === undefined
          ? projection
          : (PROJECTIONS.find((entry) => entry.model === target) ?? projection);

      const files = consumerFiles.get(projection.consumerDir) ?? [];
      const readers = findReaders(files, resolved);

      expect(
        readers.length,
        `A projeção "${projection.table}" não tem leitor em ${projection.consumerDir}.\n` +
          `Para que ela existe: ${projection.purpose}\n` +
          "Uma tabela escrita e nunca lida é o irmão do dado descartado: cada metade " +
          "funciona sozinha e o elo não existe. Ligue o consumidor, ou remova a linha " +
          "do registro declarando que ela deixou de ser projeção.",
      ).toBeGreaterThan(0);
    },
  );

  it("todo registro declara PARA QUE a tabela existe", () => {
    for (const projection of PROJECTIONS) {
      expect(projection.purpose.trim().length, projection.model).toBeGreaterThan(40);
    }
  });

  it("leitura no ESCRITOR não conta como consumo", () => {
    // `discovery_snapshots` é lida dentro de `services/ingestion` (o `catalog
    // status`, e o próprio store para dedupe) desde a Fase 8. Se isso contasse,
    // o guard teria dado verde durante todos os meses em que nenhuma superfície
    // lia a tabela — que é exatamente o defeito.
    const snapshot = PROJECTIONS.find((entry) => entry.model === "discoverySnapshot")!;
    expect(snapshot.consumerDir).not.toBe(snapshot.writerDir);
    expect(snapshot.consumerDir.startsWith("apps/")).toBe(true);
  });

  it("CONTROLE NEGATIVO: apontar o consumidor para um diretório sem leitor REPROVA", async () => {
    const inexistente: Projection = {
      model: "discoverySnapshot",
      table: "discovery_snapshots",
      // Diretório real, e sem leitor desta tabela.
      consumerDir: "packages/seo",
      writerDir: "services/ingestion",
      purpose: "controle negativo: consumidor apontado para onde ninguém lê a tabela",
    };
    const paths = await collectFiles(join(REPO_ROOT, inexistente.consumerDir));
    const loaded = await Promise.all(
      paths.map(async (path) => ({ path, source: await readFile(path, "utf8") })),
    );
    expect(findReaders(loaded, inexistente)).toHaveLength(0);
  });
});
