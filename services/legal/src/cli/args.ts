/**
 * args.ts — Parser PURO da CLI `pnpm legal`. Sem IO.
 *
 * Disciplina: `review` é read-only; `apply` é dry-run por DEFAULT e só escreve
 * com `--confirm`, que exige `--reviewer` (identidade humana) E `--policy-version`
 * (a leva). Um operador que esquece uma flag vê o plano, nunca uma mutação.
 */

import { AUTHORIZATION_BATCH } from "../authorization-spec.js";

export const LEGAL_COMMANDS = ["sources", "help"] as const;
export type LegalCommand = (typeof LEGAL_COMMANDS)[number];

export const LEGAL_SUBCOMMANDS = ["review", "apply"] as const;
export type LegalSubcommand = (typeof LEGAL_SUBCOMMANDS)[number];

/** `legal sources review` — mostra o plano, nunca escreve. */
export interface ReviewArgs {
  readonly command: "sources";
  readonly sub: "review";
  readonly json: boolean;
}

/** `legal sources apply` — dry-run por default; `--confirm` escreve. */
export interface ApplyArgs {
  readonly command: "sources";
  readonly sub: "apply";
  readonly reviewer: string | null;
  readonly policyVersion: string | null;
  readonly confirm: boolean;
  readonly json: boolean;
}

export interface HelpArgs {
  readonly command: "help";
}

export type LegalArgs = ReviewArgs | ApplyArgs | HelpArgs;

export type ParseResult =
  | { readonly ok: true; readonly args: LegalArgs }
  | { readonly ok: false; readonly error: string };

function readFlags(argv: readonly string[]): { flags: Map<string, string | true>; error: string | null } {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) return { flags, error: `argumento posicional inesperado: "${token}"` };
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(body, next);
      i += 1;
    } else {
      flags.set(body, true);
    }
  }
  return { flags, error: null };
}

const isTrue = (v: string | true | undefined): boolean => v === true || v === "true";

export function parseLegalArgs(argv: readonly string[]): ParseResult {
  const [command, sub, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { ok: true, args: { command: "help" } };
  }
  if (command !== "sources") {
    return { ok: false, error: `comando desconhecido: "${command}" (use: sources)` };
  }
  if (sub === undefined || !(LEGAL_SUBCOMMANDS as readonly string[]).includes(sub)) {
    return { ok: false, error: `subcomando invalido: "${sub ?? ""}" (use: review | apply)` };
  }

  const { flags, error } = readFlags(rest);
  if (error !== null) return { ok: false, error };
  const json = isTrue(flags.get("json"));

  if (sub === "review") {
    return { ok: true, args: { command: "sources", sub: "review", json } };
  }

  const rawReviewer = flags.get("reviewer");
  if (rawReviewer === true) return { ok: false, error: "--reviewer exige uma identidade humana" };
  const reviewer = typeof rawReviewer === "string" ? rawReviewer.trim() : null;

  const rawPolicy = flags.get("policy-version");
  if (rawPolicy === true) return { ok: false, error: "--policy-version exige um valor" };
  const policyVersion = typeof rawPolicy === "string" ? rawPolicy.trim() : null;

  const confirm = isTrue(flags.get("confirm"));

  if (confirm) {
    if (reviewer === null || reviewer === "") {
      return { ok: false, error: "--confirm exige --reviewer=<identidade humana>" };
    }
    if (policyVersion === null || policyVersion === "") {
      return { ok: false, error: "--confirm exige --policy-version=<leva>" };
    }
    if (policyVersion !== AUTHORIZATION_BATCH) {
      return {
        ok: false,
        error: `--policy-version invalido: "${policyVersion}" (esperado "${AUTHORIZATION_BATCH}")`,
      };
    }
  }

  return { ok: true, args: { command: "sources", sub: "apply", reviewer, policyVersion, confirm, json } };
}

/** Ajuda da CLI. */
export function renderLegalHelp(): string {
  return `pnpm legal — registro governado de autorizacao de fontes (worker-only)

USO
  pnpm legal sources review
  pnpm legal sources apply --reviewer="Pablo Eduardo — proprietario da Cinerie" --policy-version="${AUTHORIZATION_BATCH}" --confirm

COMANDOS
  sources review   Mostra o plano (fontes, registro vigente, nova versao,
                   permissoes, territorio, atribuicao, linkback, usos
                   bloqueados). Read-only, so banco.
  sources apply    Prepara/aplica novas versoes de source_licenses e
                   data_usage_decisions. DRY-RUN por default; --confirm escreve.

FLAGS
  --reviewer=<quem>         identidade HUMANA (obrigatoria com --confirm)
  --policy-version=<leva>   deve ser "${AUTHORIZATION_BATCH}" (obrigatoria com --confirm)
  --confirm                 executa de verdade (idempotente; historico preservado)
  --json                    saida JSON

GOVERNANCA
  - Nunca promove dado (nao liga display_allowed de rating/oferta).
  - Nunca libera logo, citacao integral de critica ou obra derivada.
  - Nunca cria decisao de Cinerie Score (permanece BLOCKED_BY_DECISION).
  - Idempotente: rodar de novo sem mudanca no spec nao escreve nada.
  - Historico preservado (supersedes_id); nenhuma linha antiga e apagada.
`;
}
