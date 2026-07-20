/**
 * Exportacao de dados (LGPD art. 18) — regras puras (Backend C, unidade C3).
 *
 * PURO: sem rede, sem DB, sem fs, sem relogio. NAO gera arquivo real (ZIP/JSON)
 * — produz PLANO e MANIFESTO deterministicos. O export nunca inclui segredo,
 * hash, credencial, antifraude, dado de terceiro nao redistribuivel nem dado
 * de outro usuario. Fail-closed em categoria desconhecida.
 */

import { type DomainResult, err, ok, type ValidationResult } from "../core/result.js";
import { classifyCategory, isCategoryExportable } from "./policy.js";
import {
  DATA_CATEGORIES,
  type DataCategory,
  type DataRequestStatus,
  type ExportManifestEntry,
  type PublicDataRequestAcceptedDto,
} from "./types.js";

/** Status considerados ATIVOS (um pedido em andamento bloqueia duplicidade). */
const ACTIVE_REQUEST_STATUSES: ReadonlySet<DataRequestStatus> = new Set<DataRequestStatus>([
  "pending",
  "processing",
]);

export function isRequestActive(status: DataRequestStatus): boolean {
  return ACTIVE_REQUEST_STATUSES.has(status);
}

/**
 * Decide um pedido de exportacao. Rejeita duplicidade quando ja ha um pedido de
 * exportacao ATIVO (pending/processing). Pedido concluido/rejeitado/cancelado
 * libera um novo. Fail-closed.
 */
export function decideExportRequest(input: {
  readonly existingRequestStatus: DataRequestStatus | null;
}): DomainResult<{ action: "create_export_request"; initialStatus: "pending" }> {
  if (input.existingRequestStatus !== null && isRequestActive(input.existingRequestStatus)) {
    return err("conflict", "ja existe um pedido de exportacao em andamento.");
  }
  return ok({ action: "create_export_request", initialStatus: "pending" });
}

/**
 * Manifesto de exportacao em ORDEM CANONICA (DATA_CATEGORIES). Cada entrada diz
 * se a categoria entra no export e a razao (controlada). Deterministico.
 */
export function buildExportManifest(): ExportManifestEntry[] {
  const manifest: ExportManifestEntry[] = [];
  for (const category of DATA_CATEGORIES) {
    const c = classifyCategory(category);
    if (c === null) continue; // fail-closed: categoria sem classificacao nao entra
    manifest.push({
      category,
      included: c.exportable,
      reason: c.retentionReason,
    });
  }
  return manifest;
}

export interface ExportPlan {
  /** Categorias incluidas, em ordem canonica. */
  readonly includedCategories: readonly DataCategory[];
  /** Categorias excluidas, em ordem canonica (nunca exportaveis). */
  readonly excludedCategories: readonly DataCategory[];
  readonly manifest: readonly ExportManifestEntry[];
  readonly generatedAt: Date;
}

/**
 * Plano de exportacao deterministico. Segrega incluidas x excluidas mantendo a
 * ordem canonica. Credencial/sessao/token/IP/audit/catalogo-terceiro NUNCA
 * entram em `includedCategories`.
 */
export function buildExportPlan(input: { readonly now: Date }): ExportPlan {
  const manifest = buildExportManifest();
  const includedCategories: DataCategory[] = [];
  const excludedCategories: DataCategory[] = [];
  for (const entry of manifest) {
    if (entry.included && isCategoryExportable(entry.category)) {
      includedCategories.push(entry.category);
    } else {
      excludedCategories.push(entry.category);
    }
  }
  return { includedCategories, excludedCategories, manifest, generatedAt: input.now };
}

/** Aceite publico de um pedido de exportacao (sem detalhe interno). */
export function toPublicExportAccepted(): PublicDataRequestAcceptedDto {
  return {
    ok: true,
    kind: "export",
    status: "pending",
    message: "seu pedido de exportacao foi registrado e sera processado.",
  };
}

/** Chaves proibidas em QUALQUER payload de exportacao (rede de seguranca). */
const FORBIDDEN_EXPORT_KEY = /(password|token|secret|hash|csrf|ip_?hash|internal_?reason)/i;

/**
 * Rede de seguranca: varre recursivamente um objeto de exportacao e acusa se
 * qualquer CHAVE indicar segredo/hash/token/antifraude. Puro; nao serializa
 * nada — apenas inspeciona chaves. Fail-closed em profundidade excessiva.
 */
export function assertExportContainsNoSecrets(exportObject: unknown): ValidationResult {
  const errors: string[] = [];
  const seen = new Set<unknown>();

  function walk(node: unknown, depth: number): void {
    if (depth > 40) {
      errors.push("estrutura de exportacao profunda demais (possivel ciclo).");
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_EXPORT_KEY.test(key)) {
        errors.push(`chave proibida na exportacao: "${key}"`);
      }
      walk((node as Record<string, unknown>)[key], depth + 1);
    }
  }

  walk(exportObject, 0);
  return { ok: errors.length === 0, errors };
}
