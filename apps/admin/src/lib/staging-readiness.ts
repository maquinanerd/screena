/**
 * staging-readiness.ts — Avaliacao de PRONTIDAO DE STAGING do admin. PURA.
 *
 * Responde a pergunta operacional: "este ambiente ja esta pronto para validar o
 * fluxo editorial com dados reais controlados em staging?". NAO decide nada no
 * banco, NAO publica, NAO chama API, NAO le env — apenas recebe fatos ja
 * coletados (pela camada server-only) e devolve um checklist determinista com
 * status/severidade, resumo, status de fluxo, postura de seed e acoes
 * recomendadas.
 *
 * PUREZA. Este modulo NAO importa Prisma, NAO le `process.env`, NAO usa
 * `fetch`/`Date.now`/`new Date`/`console` e NAO toca filesystem. Recebe tudo por
 * parametro (`StagingReadinessInput`) e e 100% deterministico: a mesma entrada
 * sempre gera a mesma saida, na mesma ordem. Isso o torna testavel isoladamente
 * e reutilizavel sem acoplar runtime.
 *
 * SEM SEGREDO. A entrada carrega apenas booleans/rotulos derivados (nunca
 * usuario/senha/URL de banco); por construcao, nenhuma saida pode conter um
 * segredo. So o `AdminRuntimeKind` (tipo) vem de `./access-protection` — que ja
 * e a fonte unica da deteccao de ambiente e protecao do admin.
 */

import type { AdminRuntimeKind } from "./access-protection";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Node major LTS esperado do projeto (ver `.nvmrc`/CI). */
export const EXPECTED_NODE_MAJOR = 22;

/* ------------------------------------------------------------------ */
/* Tipos                                                              */
/* ------------------------------------------------------------------ */

/** Secao do checklist de staging. */
export type StagingSection =
  | "environment"
  | "protection"
  | "editorial"
  | "database"
  | "flow"
  | "seed";

/** Status de um check. `info` e neutro (nao rebaixa o veredito geral). */
export type StagingCheckStatus = "ok" | "warn" | "fail" | "info";

/** Um item do checklist (seguro para exibir; sem segredo). */
export interface StagingCheck {
  readonly id: string;
  readonly section: StagingSection;
  readonly label: string;
  readonly status: StagingCheckStatus;
  readonly detail: string;
}

/** Contagens agregadas do banco de staging (nunca corpo/conteudo). */
export interface StagingDatabaseFacts {
  readonly articleRecords: number;
  readonly translations: number;
  readonly contentBlocks: number;
  readonly pending: number;
  readonly approved: number;
  readonly blocked: number;
  readonly indexReadyCandidates: number;
}

/** Fatos de ambiente/protecao/banco ja coletados (pela camada server-only). */
export interface StagingReadinessInput {
  readonly runtimeKind: AdminRuntimeKind;
  readonly productionLike: boolean;
  readonly protectionRequired: boolean;
  readonly protectionExplicitlyEnabled: boolean;
  readonly hasCredentials: boolean;
  readonly editorialActionsEnabled: boolean;
  /** Node major detectado no runtime (ou `null` se indisponivel). */
  readonly nodeMajor: number | null;
  /** Contagens do banco, ou `null` se o banco nao respondeu (read-only). */
  readonly database: StagingDatabaseFacts | null;
}

/** Status de fluxo editorial resumido (pt-BR). */
export type StagingFlowStatus = "safe_to_review" | "needs_setup";

/** Postura do seed controlado (nunca roda pela UI). */
export type SeedPosture = "manual_only" | "blocked_production";

/** Resultado determinista da avaliacao de prontidao de staging. */
export interface StagingReadinessReport {
  readonly overall: StagingCheckStatus;
  readonly summary: string;
  readonly flowStatus: StagingFlowStatus;
  readonly flowLabel: string;
  readonly seedPosture: SeedPosture;
  readonly seedPostureLabel: string;
  readonly checks: readonly StagingCheck[];
  readonly recommendedActions: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Rotulos (pt-BR)                                                     */
/* ------------------------------------------------------------------ */

const RUNTIME_KIND_LABELS: Record<AdminRuntimeKind, string> = {
  production: "production",
  preview: "preview/staging",
  development: "development",
  unknown: "local/unknown",
};

const OVERALL_SUMMARY: Record<StagingCheckStatus, string> = {
  ok: "Ambiente pronto para validar o fluxo editorial em staging.",
  info: "Ambiente pronto para validar o fluxo editorial em staging.",
  warn: "Staging utilizavel, mas ha pontos de atencao antes de liberar.",
  fail: "Staging NAO esta pronto: resolva os itens criticos antes de prosseguir.",
};

const FLOW_LABELS: Record<StagingFlowStatus, string> = {
  safe_to_review: "Seguro para revisar",
  needs_setup: "Precisa configurar staging",
};

const SEED_POSTURE_LABELS: Record<SeedPosture, string> = {
  manual_only: "Seed disponivel apenas por comando manual (dry-run por padrao)",
  blocked_production: "Seed apply/cleanup bloqueado em producao real",
};

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

const STATUS_RANK: Record<StagingCheckStatus, number> = { info: 0, ok: 1, warn: 2, fail: 3 };

/** Veredito geral: pior status entre os checks (info nunca rebaixa; piso = ok). */
function overallStatus(checks: readonly StagingCheck[]): StagingCheckStatus {
  let rank = STATUS_RANK.ok;
  for (const check of checks) {
    const current = STATUS_RANK[check.status];
    if (current > rank) rank = current;
  }
  if (rank === STATUS_RANK.fail) return "fail";
  if (rank === STATUS_RANK.warn) return "warn";
  return "ok";
}

/** Rotulo pt-BR do ambiente detectado. */
export function runtimeKindLabel(kind: AdminRuntimeKind): string {
  return RUNTIME_KIND_LABELS[kind];
}

/* ------------------------------------------------------------------ */
/* Construcao dos checks                                               */
/* ------------------------------------------------------------------ */

function environmentChecks(input: StagingReadinessInput): StagingCheck[] {
  const checks: StagingCheck[] = [];

  checks.push({
    id: "env.kind",
    section: "environment",
    label: "Ambiente detectado",
    status: "info",
    detail: `${RUNTIME_KIND_LABELS[input.runtimeKind]} (production-like: ${
      input.productionLike ? "sim" : "nao"
    }).`,
  });

  if (input.nodeMajor === null) {
    checks.push({
      id: "env.node",
      section: "environment",
      label: "Node major",
      status: "info",
      detail: `Nao foi possivel detectar o Node major; alvo do projeto e ${EXPECTED_NODE_MAJOR} LTS.`,
    });
  } else if (input.nodeMajor === EXPECTED_NODE_MAJOR) {
    checks.push({
      id: "env.node",
      section: "environment",
      label: "Node major",
      status: "ok",
      detail: `Node ${input.nodeMajor} (alvo ${EXPECTED_NODE_MAJOR} LTS).`,
    });
  } else {
    checks.push({
      id: "env.node",
      section: "environment",
      label: "Node major",
      status: "warn",
      detail: `Node ${input.nodeMajor} difere do alvo ${EXPECTED_NODE_MAJOR} LTS; validar em CI Node ${EXPECTED_NODE_MAJOR}.`,
    });
  }

  return checks;
}

function protectionChecks(input: StagingReadinessInput): StagingCheck[] {
  const checks: StagingCheck[] = [];

  if (input.productionLike && !input.hasCredentials) {
    checks.push({
      id: "protection.credentials",
      section: "protection",
      label: "Protecao do admin",
      status: "fail",
      detail:
        "Ambiente production-like SEM credenciais Basic Auth: o admin bloqueia (401) e nao pode ser exposto assim. Configure as credenciais por env.",
    });
  } else if (input.productionLike && input.hasCredentials) {
    checks.push({
      id: "protection.credentials",
      section: "protection",
      label: "Protecao do admin",
      status: "ok",
      detail: "Production-like com credenciais Basic Auth configuradas: protecao exigida e presente.",
    });
  } else if (input.protectionRequired && input.hasCredentials) {
    checks.push({
      id: "protection.credentials",
      section: "protection",
      label: "Protecao do admin",
      status: "ok",
      detail: "Protecao habilitada explicitamente e credenciais presentes.",
    });
  } else if (input.protectionRequired && !input.hasCredentials) {
    checks.push({
      id: "protection.credentials",
      section: "protection",
      label: "Protecao do admin",
      status: "fail",
      detail: "Protecao exigida, mas sem credenciais: o admin bloqueia (401) ate configurar as credenciais.",
    });
  } else {
    checks.push({
      id: "protection.credentials",
      section: "protection",
      label: "Protecao do admin",
      status: "info",
      detail: "Dev/local: acesso aberto e esperado. Antes de expor staging, exija Basic Auth.",
    });
  }

  checks.push({
    id: "protection.credentials_present",
    section: "protection",
    label: "Credenciais configuradas",
    status: input.hasCredentials ? "ok" : "info",
    detail: input.hasCredentials
      ? "Credenciais presentes (apenas presenca; valores nunca lidos aqui)."
      : "Sem credenciais (apenas presenca; valores nunca lidos aqui).",
  });

  return checks;
}

function editorialChecks(input: StagingReadinessInput): StagingCheck[] {
  const checks: StagingCheck[] = [];

  if (input.productionLike && !input.hasCredentials && input.editorialActionsEnabled) {
    checks.push({
      id: "editorial.actions",
      section: "editorial",
      label: "Escrita editorial",
      status: "fail",
      detail:
        "Acoes de escrita HABILITADAS em production-like SEM credenciais: proteja o admin ou desabilite a escrita antes de expor.",
    });
  } else if (!input.productionLike && input.editorialActionsEnabled) {
    checks.push({
      id: "editorial.actions",
      section: "editorial",
      label: "Escrita editorial",
      status: "warn",
      detail:
        "Acoes de escrita habilitadas fora de production-like: confirme se e intencional para este ambiente de teste.",
    });
  } else if (input.editorialActionsEnabled) {
    checks.push({
      id: "editorial.actions",
      section: "editorial",
      label: "Escrita editorial",
      status: "ok",
      detail: "Acoes de escrita habilitadas em ambiente protegido.",
    });
  } else {
    checks.push({
      id: "editorial.actions",
      section: "editorial",
      label: "Escrita editorial",
      status: "info",
      detail: "Acoes de escrita desabilitadas por ambiente (somente leitura).",
    });
  }

  return checks;
}

function databaseChecks(input: StagingReadinessInput): StagingCheck[] {
  const db = input.database;
  if (db === null) {
    return [
      {
        id: "database.connectivity",
        section: "database",
        label: "Conectividade do banco (read-only)",
        status: "warn",
        detail:
          "Banco de staging nao respondeu a leitura agregada agora: confirme a conexao e a conectividade read-only antes de validar dados.",
      },
    ];
  }

  return [
    {
      id: "database.connectivity",
      section: "database",
      label: "Conectividade do banco (read-only)",
      status: "ok",
      detail: "Leitura agregada respondeu (somente contagens; sem corpo/conteudo).",
    },
    {
      id: "database.counts",
      section: "database",
      label: "Contagens agregadas",
      status: "info",
      detail: `Artigos: ${db.articleRecords} · traducoes: ${db.translations} · content blocks: ${db.contentBlocks}.`,
    },
    {
      id: "database.editorial",
      section: "database",
      label: "Estado editorial",
      status: "info",
      detail: `Pendentes: ${db.pending} · aprovados: ${db.approved} · bloqueados: ${db.blocked} · candidatos a indexar: ${db.indexReadyCandidates}.`,
    },
  ];
}

function seedChecks(input: StagingReadinessInput): StagingCheck[] {
  const blocked = input.runtimeKind === "production";
  return [
    {
      id: "seed.ui",
      section: "seed",
      label: "Seed pela UI",
      status: "info",
      detail: "O seed NAO roda pela interface: esta pagina e somente leitura.",
    },
    {
      id: "seed.mode",
      section: "seed",
      label: "Modo padrao",
      status: "info",
      detail:
        "Sem flags, o comando manual roda em dry-run (nunca escreve). O apply exige --apply mais a env de confirmacao dupla.",
    },
    {
      id: "seed.production",
      section: "seed",
      label: "Producao real",
      status: "info",
      detail: blocked
        ? "Producao real detectada: apply/cleanup do seed abortam por seguranca."
        : "Fora de producao real: apply/cleanup exigem confirmacao explicita por comando manual.",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Acoes recomendadas + fluxo                                          */
/* ------------------------------------------------------------------ */

function buildRecommendedActions(input: StagingReadinessInput): string[] {
  const actions: string[] = [];

  if (input.productionLike && !input.hasCredentials) {
    actions.push(
      "Configurar credenciais Basic Auth (por env) antes de expor staging — production-like sem credenciais bloqueia com 401.",
    );
  }
  if (input.productionLike && !input.hasCredentials && input.editorialActionsEnabled) {
    actions.push(
      "Proteger o admin ou desabilitar a escrita: acoes editoriais estao habilitadas em production-like sem credenciais.",
    );
  }
  if (!input.productionLike && input.editorialActionsEnabled) {
    actions.push(
      "Confirmar intencao: acoes de escrita editorial habilitadas fora de production-like.",
    );
  }
  if (input.nodeMajor !== null && input.nodeMajor !== EXPECTED_NODE_MAJOR) {
    actions.push(
      `Validar em CI Node ${EXPECTED_NODE_MAJOR}: o Node local (${input.nodeMajor}) difere do alvo.`,
    );
  }
  if (input.database === null) {
    actions.push(
      "Verificar conectividade read-only com o PostgreSQL de staging (a leitura agregada nao respondeu).",
    );
  }
  if (input.runtimeKind === "production") {
    actions.push("Nao rodar seed em producao real: apply/cleanup abortam por seguranca.");
  }
  actions.push(
    "Rodar o seed apenas por comando manual, em dry-run, antes de qualquer --apply (com a env de confirmacao dupla).",
  );

  return actions;
}

function flowStatusOf(input: StagingReadinessInput, overall: StagingCheckStatus): StagingFlowStatus {
  if (overall === "fail") return "needs_setup";
  if (input.database === null) return "needs_setup";
  if (input.productionLike && !input.hasCredentials) return "needs_setup";
  return "safe_to_review";
}

/* ------------------------------------------------------------------ */
/* Avaliacao                                                           */
/* ------------------------------------------------------------------ */

/**
 * Avalia a prontidao de staging a partir de fatos ja coletados. Determinista:
 * mesma entrada -> mesma saida, mesma ordem. Nenhum campo carrega segredo.
 */
export function evaluateStagingReadiness(input: StagingReadinessInput): StagingReadinessReport {
  const checks: StagingCheck[] = [
    ...environmentChecks(input),
    ...protectionChecks(input),
    ...editorialChecks(input),
    ...databaseChecks(input),
    ...seedChecks(input),
  ];

  const overall = overallStatus(checks);
  const flowStatus = flowStatusOf(input, overall);
  const seedPosture: SeedPosture =
    input.runtimeKind === "production" ? "blocked_production" : "manual_only";

  return {
    overall,
    summary: OVERALL_SUMMARY[overall],
    flowStatus,
    flowLabel: FLOW_LABELS[flowStatus],
    seedPosture,
    seedPostureLabel: SEED_POSTURE_LABELS[seedPosture],
    checks,
    recommendedActions: buildRecommendedActions(input),
  };
}

/** Variante de badge (a cor NUNCA e o unico sinal; sempre com rotulo textual). */
export type StagingBadgeVariant = "ok" | "info" | "warn" | "fail";

export function stagingBadgeVariant(status: StagingCheckStatus): StagingBadgeVariant {
  return status;
}

/** Rotulo pt-BR de um status de check. */
const STATUS_LABELS: Record<StagingCheckStatus, string> = {
  ok: "OK",
  info: "Info",
  warn: "Atencao",
  fail: "Critico",
};

export function stagingStatusLabel(status: StagingCheckStatus): string {
  return STATUS_LABELS[status];
}
