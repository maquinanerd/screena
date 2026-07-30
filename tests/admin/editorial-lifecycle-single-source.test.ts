/**
 * O admin NAO pode ter uma segunda verdade sobre `review_status`.
 *
 * Antes desta correcao, `apps/admin` escrevia qualquer valor do enum de forma
 * isolada: `draft -> published` (pulando a revisao humana) e
 * `blocked -> published` (republicando uma materia retratada) passavam com um
 * clique, enquanto `services/news-ingestion/src/lifecycle.ts` — a fonte unica —
 * proibia os dois. Duas verdades sobre a mesma coluna nao sao flexibilidade: e a
 * garantia de que a mais fraca sera usada.
 *
 * Este arquivo prova quatro coisas:
 *   1. COMPORTAMENTO — o adaptador do admin decide exatamente como a fonte unica.
 *   2. PROCEDENCIA   — o adaptador IMPORTA `canTransition`; nao reimplementa.
 *   3. AUSENCIA      — nao existe tabela de transicoes duplicada em `apps/admin`.
 *   4. FRONTEIRA     — `content_blocks` NAO herda a maquina de estados de artigo.
 *
 * Sobre o item 4: os dois dominios compartilham o enum `ReviewStatus` e NAO
 * compartilham as transicoes. Em artigo, `blocked`/`archived` sao RETRATACAO; em
 * bloco, `blocked` e falha de geracao e `archived` e versao superada arquivada
 * pelo proprio writer. A Fase 1 aplicou a allowlist de artigo aos blocos por
 * simetria de enum e quebrou o caminho feliz do Entity Writer
 * (`ai_generated -> human_reviewed`). Ver
 * `docs/adr/0016-content-block-lifecycle-separation.md`.
 *
 * Os itens 2, 3 e 4 sao guardas TEXTUAIS (mesmo idioma de
 * `editorial-actions-guard.test.ts`), nao execucao: eles afirmam sobre o codigo
 * enviado, nao sobre uma chamada real ao banco.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { canTransition, type EditorialReviewStatus } from "@screena/news-ingestion";

import {
  evaluateReviewStatusTransition,
} from "../../apps/admin/src/lib/editorial-transition-policy";
import {
  REVIEW_STATUSES,
  canRunEditorialAction,
  parseArticleActionInput,
  parseContentBlockActionInput,
  readActionFeedback,
  type ReviewStatusValue,
} from "../../apps/admin/src/lib/editorial-action-policy";

const ADMIN_SRC = resolve(process.cwd(), "apps", "admin", "src");
const ADAPTER_FILE = resolve(ADMIN_SRC, "lib", "editorial-transition-policy.ts");
const ACTIONS_FILE = resolve(ADMIN_SRC, "server", "editorial-actions.ts");
const CODE_EXTENSIONS = [".ts", ".tsx"];

function stripComments(content: string): string {
  const noBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

async function collectCodeFiles(dir: string): Promise<string[]> {
  try {
    await stat(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...(await collectCodeFiles(full)));
    } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. COMPORTAMENTO                                                    */
/* ------------------------------------------------------------------ */

describe("transicoes de review_status no admin seguem a fonte unica", () => {
  it("permite needs_review -> human_reviewed (revisao acontecendo)", () => {
    expect(evaluateReviewStatusTransition("needs_review", "human_reviewed").allowed).toBe(true);
  });

  it("permite human_reviewed -> published (publicacao apos revisao humana)", () => {
    expect(evaluateReviewStatusTransition("human_reviewed", "published").allowed).toBe(true);
  });

  it("permite blocked -> needs_review (materia retratada volta para revisao)", () => {
    expect(evaluateReviewStatusTransition("blocked", "needs_review").allowed).toBe(true);
  });

  it("RECUSA draft -> published (pularia a revisao humana)", () => {
    const verdict = evaluateReviewStatusTransition("draft", "published");
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.outcome).toBe("forbidden_transition");
  });

  it("RECUSA blocked -> published (republicaria uma materia retratada)", () => {
    const verdict = evaluateReviewStatusTransition("blocked", "published");
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.outcome).toBe("forbidden_transition");
  });

  it("RECUSA archived -> published (mesma regra da retratacao)", () => {
    expect(evaluateReviewStatusTransition("archived", "published").allowed).toBe(false);
  });

  it("RECUSA ai_generated -> published (saida de IA nao publica sozinha)", () => {
    expect(evaluateReviewStatusTransition("ai_generated", "published").allowed).toBe(false);
  });

  it("trata estado igual como unchanged_state, nao como transicao proibida", () => {
    const verdict = evaluateReviewStatusTransition("published", "published");
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.outcome).toBe("unchanged_state");
  });

  it("concorda com canTransition em TODOS os pares de estados", () => {
    // Varredura completa: qualquer divergencia entre o adaptador do admin e a
    // fonte unica aparece aqui, nao em producao.
    for (const from of REVIEW_STATUSES) {
      for (const to of REVIEW_STATUSES) {
        const admin = evaluateReviewStatusTransition(from, to).allowed;
        const source = canTransition(
          from as EditorialReviewStatus,
          to as EditorialReviewStatus,
        ).allowed;
        expect(admin, `divergencia em ${from} -> ${to}`).toBe(source);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. PROCEDENCIA e 3. AUSENCIA de allowlist duplicada                 */
/* ------------------------------------------------------------------ */

describe("procedencia da regra: o admin importa, nao reimplementa", () => {
  let adapter = "";
  let actions = "";

  beforeAll(async () => {
    adapter = stripComments(await readFile(ADAPTER_FILE, "utf-8"));
    actions = stripComments(await readFile(ACTIONS_FILE, "utf-8"));
  });

  it("o adaptador importa canTransition de @screena/news-ingestion", () => {
    expect(adapter).toContain("@screena/news-ingestion");
    expect(adapter).toContain("canTransition");
  });

  it("a superficie de escrita consulta o adaptador antes de persistir", () => {
    expect(actions).toContain("evaluateReviewStatusTransition");
  });

  it("nao existe tabela de transicoes duplicada em apps/admin", async () => {
    // Uma allowlist duplicada aparece como um MAPA estado -> lista de estados
    // (`draft: [...]`). O espelho plano do enum (`REVIEW_STATUSES`) nao casa com
    // este padrao de proposito: ele nao afirma nada sobre transicao.
    const offenders: string[] = [];
    for (const file of await collectCodeFiles(ADMIN_SRC)) {
      const code = stripComments(await readFile(file, "utf-8"));
      for (const status of REVIEW_STATUSES) {
        if (new RegExp(`["']?${status}["']?\\s*:\\s*\\[`).test(code)) {
          offenders.push(`${file}: ${status}: [`);
        }
      }
      if (/ALLOWED_TRANSITIONS/.test(code)) offenders.push(`${file}: ALLOWED_TRANSITIONS`);
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 4. FRONTEIRA: content_blocks NAO herda a maquina de estados          */
/* ------------------------------------------------------------------ */

describe("content_blocks: mesmo enum, dominio diferente (ADR 0016)", () => {
  let actions = "";

  beforeAll(async () => {
    actions = stripComments(await readFile(ACTIONS_FILE, "utf-8"));
  });

  it("o caminho de content_block NAO chama o adaptador de transicao de artigo", () => {
    // A validacao de transicao aparece so nos caminhos de artigo (unitario e
    // lote). Se alguem reaplicar a allowlist de artigo aos blocos, o numero de
    // chamadas sobe e este teste falha apontando o ADR 0016.
    const calls = actions.match(/evaluateReviewStatusTransition\(/g) ?? [];
    expect(
      calls.length,
      "content_blocks nao deve usar a allowlist de artigo — ver docs/adr/0016-content-block-lifecycle-separation.md",
    ).toBe(2);
  });

  it("ai_generated -> human_reviewed: proibido para ARTIGO, e o caminho feliz do bloco", () => {
    // Esta e a diferenca de dominio que a Fase 1 apagou por engano. O Entity
    // Writer produz `ai_generated` para um bloco limpo (decide-status.ts); exigir
    // passagem por `needs_review` afirmaria um warning que nao existe.
    expect(evaluateReviewStatusTransition("ai_generated", "human_reviewed").allowed).toBe(false);
    // Nenhuma trava equivalente existe do lado do bloco: a acao de bloco vai
    // direto da validacao de enum para o compare-and-swap.
    expect(actions).toContain("prisma.contentBlock.findUnique");
    expect(actions).toContain("prisma.contentBlock.update(");
  });

  it("a protecao de CONCORRENCIA vale nos dois dominios", () => {
    // O que blocos herdam da Fase 1 e o CAS, nao o ciclo de vida.
    const conditioned = actions.match(/where:\s*\{\s*id:\s*recordId,\s*reviewStatus:/g) ?? [];
    expect(conditioned.length).toBeGreaterThanOrEqual(3);
  });

  it("o Entity Writer continua proibido de escrever published/human_reviewed", async () => {
    // A trava real da invariante 12 para blocos e do lado do WRITER, e nao foi
    // criada nem removida por esta fase.
    const plan = await readFile(
      resolve(process.cwd(), "services", "entity-writer", "src", "pipeline", "persistence-plan.ts"),
      "utf-8",
    );
    expect(plan).toContain("FORBIDDEN_WRITE_STATES");
    expect(plan).toContain("published");
    expect(plan).toContain("human_reviewed");
  });
});

/* ------------------------------------------------------------------ */
/* Protecoes preexistentes: continuam valendo                          */
/* ------------------------------------------------------------------ */

describe("as travas anteriores continuam de pe", () => {
  it("flag desligada continua negando escrita, qualquer que seja a transicao", () => {
    expect(canRunEditorialAction({})).toBe(false);
    expect(canRunEditorialAction({ ADMIN_EDITORIAL_ACTIONS_ENABLED: "false" })).toBe(false);
    expect(canRunEditorialAction({ ADMIN_EDITORIAL_ACTIONS_ENABLED: "1" })).toBe(false);
    expect(canRunEditorialAction({ ADMIN_EDITORIAL_ACTIONS_ENABLED: "true" })).toBe(true);
  });

  it("campos nao editoriais continuam impossiveis (artigo e content_block)", () => {
    for (const field of ["title", "slug", "body", "content", "publishedAt", "licenseStatus"]) {
      expect(parseArticleActionInput({ id: "1", field, value: "x" }).ok).toBe(false);
      expect(parseContentBlockActionInput({ id: "1", field, value: "x" }).ok).toBe(false);
    }
  });

  it("valor fora do enum continua rejeitado antes de qualquer transicao", () => {
    const parsed = parseArticleActionInput({
      id: "1",
      field: "reviewStatus",
      value: "published; DROP TABLE articles",
    });
    expect(parsed.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Concorrencia: estado desatualizado falha de forma segura            */
/* ------------------------------------------------------------------ */

describe("concorrencia (compare-and-swap)", () => {
  let actions = "";

  beforeAll(async () => {
    actions = stripComments(await readFile(ACTIONS_FILE, "utf-8"));
  });

  it("a escrita de reviewStatus e condicionada ao estado LIDO", () => {
    // O `where` carrega o estado lido como pre-condicao; sem isso a validacao
    // aconteceria contra um estado que ja mudou.
    const conditioned = actions.match(/where:\s*\{\s*id:\s*recordId,\s*reviewStatus:/g) ?? [];
    // 3 caminhos: artigo unitario, content block unitario e content block em lote.
    expect(conditioned.length).toBeGreaterThanOrEqual(3);
    // O caminho de lote de artigo monta o `where` antes do update.
    expect(actions).toContain("id: recordId, reviewStatus: expected");
  });

  it("o estado atual vem do banco, nunca do formulario", () => {
    expect(actions).toContain("findUnique");
    expect(actions).toContain("select: { reviewStatus: true }");
  });

  it("pre-condicao nao satisfeita vira stale_state (nao 'sucesso' silencioso)", () => {
    expect(actions).toContain("isRecordConditionUnmet");
    expect(actions).toContain('buildActionResult("stale_state")');
  });

  it("os novos desfechos tem feedback proprio e sem payload", () => {
    for (const token of ["forbidden_transition", "unchanged_state", "stale_state"]) {
      const feedback = readActionFeedback({ error: token });
      expect(feedback, `sem feedback para ${token}`).not.toBeNull();
      expect(feedback?.tone).toBe("error");
      expect(feedback?.message).toContain("Nada foi alterado");
    }
  });

  it("nenhum estado do enum fica sem cobertura de decisao", () => {
    // Todo par (from, to) devolve um veredito definido — nunca `undefined`.
    for (const from of REVIEW_STATUSES) {
      for (const to of REVIEW_STATUSES) {
        const verdict = evaluateReviewStatusTransition(
          from as ReviewStatusValue,
          to as ReviewStatusValue,
        );
        expect(typeof verdict.allowed).toBe("boolean");
      }
    }
  });
});
