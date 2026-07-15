/**
 * redirects.ts — Classificacao e resolucao PURA de redirects persistidos.
 *
 * Prompt 3 (§6): fazer os redirects persistidos (`redirects`) serem
 * efetivamente lidos e diferenciar:
 *  - `permanent`  — 301/308 historico (contrato persistido de URL antiga);
 *  - `temporary`  — 302/303/307 (redirect temporario);
 *  - `alias`      — alias de compatibilidade (mesma pagina sob outro caminho);
 *  - `framework`  — redirect que o Next ja faz sozinho (ex.: barra final),
 *                   que NAO deve ser confundido com um contrato 301 persistido.
 *
 * Um 308 automatico do framework (trailingSlash) NUNCA substitui um 301
 * persistido: sao coisas distintas e este modulo as mantem separadas.
 *
 * Tambem resolve CADEIAS de redirect com deteccao de LOOP e teto de saltos,
 * para que a rota emita um unico salto (A -> destino final) sem cair em
 * cadeia longa ou ciclo.
 *
 * PURO: sem rede, banco, IO, `Date` ou `Math.random`.
 */

/** Tipo do redirect, derivado do status + motivo persistido. */
export type RedirectKind = "permanent" | "temporary" | "alias" | "framework";

/** Linha crua de `redirects` (ja lida do PostgreSQL pelo chamador). */
export interface RedirectRecord {
  fromPath: string;
  toPath: string;
  /** Status persistido (default 301 no schema). */
  statusCode: number;
  /** Motivo livre; usado para distinguir `alias`/`framework`. */
  reason?: string | null;
}

/** Redirect ja classificado, pronto para a rota decidir como emitir. */
export interface ClassifiedRedirect {
  fromPath: string;
  toPath: string;
  statusCode: number;
  kind: RedirectKind;
}

const TEMPORARY_STATUS: ReadonlySet<number> = new Set([302, 303, 307]);

/** Teto de saltos numa cadeia de redirect antes de considerar cadeia longa. */
export const MAX_REDIRECT_HOPS = 5;

function normalizeReason(reason: string | null | undefined): string {
  return (reason ?? "").trim().toLowerCase();
}

/**
 * Classifica UM redirect persistido. Precedencia: motivo explicito
 * (`alias`/`framework`) vence; senao o status decide permanente vs temporario.
 * Status desconhecido cai para `permanent` (comportamento conservador do
 * contrato de URL antiga), preservando o `statusCode` original para auditoria.
 */
export function classifyRedirect(record: RedirectRecord): ClassifiedRedirect {
  const reason = normalizeReason(record.reason);
  let kind: RedirectKind;
  if (reason.includes("alias")) {
    kind = "alias";
  } else if (reason.includes("framework") || reason.includes("trailing")) {
    kind = "framework";
  } else if (TEMPORARY_STATUS.has(record.statusCode)) {
    kind = "temporary";
  } else {
    kind = "permanent";
  }
  return {
    fromPath: record.fromPath,
    toPath: record.toPath,
    statusCode: record.statusCode,
    kind,
  };
}

/** Status HTTP efetivo a emitir para um redirect classificado. */
export function redirectStatusFor(kind: RedirectKind): number {
  return kind === "temporary" ? 307 : 308;
}

/** Estado da resolucao de uma cadeia de redirects. */
export type RedirectChainStatus = "none" | "resolved" | "loop" | "too-long";

/** Resultado da resolucao de cadeia. */
export interface RedirectResolution {
  status: RedirectChainStatus;
  /** Destino final colapsado, ou null quando nao ha redirect/ha ciclo. */
  finalPath: string | null;
  /** Status HTTP a emitir (308 permanente / 307 temporario), ou null. */
  statusCode: number | null;
  /** Caminhos visitados, do inicio ao destino (inclui o inicial). */
  hops: string[];
  /** `true` quando algum salto da cadeia e temporario (colapsa para 307). */
  temporary: boolean;
}

/**
 * Resolve a cadeia de redirects a partir de `fromPath`, colapsando A -> ... ->
 * destino final num unico salto. Detecta LOOP (ciclo) e cadeia acima do teto.
 *
 * @param index Mapa `fromPath -> ClassifiedRedirect` (ja construido do banco).
 * @param fromPath Caminho de entrada.
 * @param maxHops Teto de saltos (default MAX_REDIRECT_HOPS).
 */
export function resolveRedirectChain(
  index: ReadonlyMap<string, ClassifiedRedirect>,
  fromPath: string,
  maxHops: number = MAX_REDIRECT_HOPS,
): RedirectResolution {
  const first = index.get(fromPath);
  if (first === undefined) {
    return {
      status: "none",
      finalPath: null,
      statusCode: null,
      hops: [fromPath],
      temporary: false,
    };
  }

  const visited = new Set<string>([fromPath]);
  const hops: string[] = [fromPath];
  let current: ClassifiedRedirect | undefined = first;
  let temporary = false;

  while (current !== undefined) {
    if (current.kind === "temporary") temporary = true;
    const next = current.toPath;

    // Loop: o destino ja foi visitado.
    if (visited.has(next)) {
      return {
        status: "loop",
        finalPath: null,
        statusCode: null,
        hops: [...hops, next],
        temporary,
      };
    }

    visited.add(next);
    hops.push(next);

    // Cadeia longa: excede o teto de saltos.
    if (hops.length - 1 > maxHops) {
      return {
        status: "too-long",
        finalPath: null,
        statusCode: null,
        hops,
        temporary,
      };
    }

    const following = index.get(next);
    if (following === undefined) {
      return {
        status: "resolved",
        finalPath: next,
        statusCode: temporary ? 307 : 308,
        hops,
        temporary,
      };
    }
    current = following;
  }

  // Inalcancavel (o laco sempre retorna), mas o TS exige um retorno.
  return {
    status: "none",
    finalPath: null,
    statusCode: null,
    hops,
    temporary,
  };
}
