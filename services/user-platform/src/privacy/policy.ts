/**
 * Politica pura de privacidade / LGPD (Backend C, unidade C3).
 *
 * PURO: sem rede, sem DB, sem relogio. Tabelas canonicas que classificam:
 *  - a BASE LEGAL de cada ConsentKind (revogavel x nao revogavel);
 *  - a CLASSIFICACAO de cada DataCategory (exportavel/excluivel/anonimizavel +
 *    acao de retencao com razao controlada);
 *  - as DURACOES de politica (carencia de exclusao, retencao de audit).
 *
 * LACUNA REGISTRADA: o schema nao tem flag de revogabilidade de consentimento
 * nem duracao de carencia. Estas tabelas sao POLITICA DE DOMINIO (nao campo
 * persistente, nao migration), fundamentadas nos 4 ConsentKind do schema e nos
 * principios LGPD — flagadas para confirmacao humana. Alterar exige revisao.
 *
 * Fail-closed: toda consulta a estas tabelas trata chave desconhecida como o
 * caso MAIS restritivo (nao revogavel / nao exportavel / retido, nunca
 * permissivo).
 */

import {
  type ConsentKind,
  type DataCategory,
  type LegalBasis,
  type RetentionAction,
  type RetentionReason,
} from "./types.js";

// ---------------------------------------------------------------------------
// Duracoes de politica (dias). Toda duracao e explicita (nunca "magica").
// ---------------------------------------------------------------------------

export const PRIVACY_DURATIONS = {
  /** Janela de arrependimento apos pedido de exclusao (decisoes secao 7). */
  deletionGraceDays: 14,
  /** Retencao de logs de autenticacao/antifraude (obrigacao de seguranca). */
  authAuditRetentionDays: 365,
} as const;

// ---------------------------------------------------------------------------
// Base legal por ConsentKind (revogabilidade derivada)
// ---------------------------------------------------------------------------

/**
 * Base legal de cada finalidade. `consent` e revogavel livremente; `contract`
 * e `legal_obligation` NAO sao "revogaveis" enquanto se usa o servico (revogar
 * ToS = encerrar a conta, nao alternar um flag). Fonte: os 4 ConsentKind do
 * schema + principios LGPD (POLITICA DE DOMINIO; confirmar com humano).
 */
export const CONSENT_LEGAL_BASIS: Readonly<Record<ConsentKind, LegalBasis>> = {
  terms_of_service: "contract",
  privacy_policy: "legal_obligation",
  marketing_email: "consent",
  analytics: "consent",
};

/** true apenas quando a base legal e `consent` (revogavel). Fail-closed. */
export function isRevocableConsent(kind: ConsentKind): boolean {
  return (CONSENT_LEGAL_BASIS[kind] ?? "legal_obligation") === "consent";
}

// ---------------------------------------------------------------------------
// Classificacao de dado por categoria
// ---------------------------------------------------------------------------

export interface DataClassification {
  readonly exportable: boolean;
  readonly deletable: boolean;
  readonly anonymizable: boolean;
  readonly retentionAction: RetentionAction;
  readonly retentionReason: RetentionReason;
  /** Prazo relativo para retain_until (dias); null nos demais casos. */
  readonly retainForDays: number | null;
}

/**
 * Classificacao canonica. Segredo/hash/credencial NUNCA sao exportaveis; dado
 * proprio do titular e exportavel; audit/consentimento sao retidos por
 * obrigacao; catalogo de terceiro e excluido do export (nao redistribuivel).
 */
export const DATA_CLASSIFICATION: Readonly<Record<DataCategory, DataClassification>> = {
  account_core: {
    exportable: true, // handle/email do proprio titular (o id interno nunca sai)
    deletable: false,
    anonymizable: true,
    retentionAction: "anonymize",
    retentionReason: "referential_integrity",
    retainForDays: null,
  },
  account_credentials: {
    exportable: false, // NUNCA
    deletable: true,
    anonymizable: false,
    retentionAction: "delete",
    retentionReason: "user_owned_data",
    retainForDays: null,
  },
  profile: {
    exportable: true,
    deletable: true,
    anonymizable: true,
    retentionAction: "delete",
    retentionReason: "user_owned_data",
    retainForDays: null,
  },
  product_content: {
    exportable: true,
    deletable: true,
    anonymizable: true,
    retentionAction: "delete",
    retentionReason: "user_owned_data",
    retainForDays: null,
  },
  product_stats: {
    exportable: true,
    deletable: false,
    anonymizable: true,
    retentionAction: "retain_indefinitely",
    retentionReason: "aggregate_anonymous",
    retainForDays: null,
  },
  security_sessions: {
    exportable: false, // NUNCA (hashes)
    deletable: true,
    anonymizable: false,
    retentionAction: "delete",
    retentionReason: "security_obligation",
    retainForDays: null,
  },
  security_tokens: {
    exportable: false, // NUNCA (hashes)
    deletable: true,
    anonymizable: false,
    retentionAction: "delete",
    retentionReason: "security_obligation",
    retainForDays: null,
  },
  security_ip: {
    exportable: false, // NUNCA (hash de IP)
    deletable: true,
    anonymizable: false,
    retentionAction: "delete",
    retentionReason: "security_obligation",
    retainForDays: null,
  },
  security_audit: {
    exportable: false, // NUNCA
    deletable: false,
    anonymizable: true, // anonimiza a referencia ao usuario
    retentionAction: "retain_until",
    retentionReason: "security_obligation",
    retainForDays: PRIVACY_DURATIONS.authAuditRetentionDays,
  },
  governance_consents: {
    exportable: true, // registro do proprio titular (transparencia)
    deletable: false,
    anonymizable: true,
    retentionAction: "retain_indefinitely",
    retentionReason: "legal_obligation", // prova de consentimento
    retainForDays: null,
  },
  governance_requests: {
    exportable: true,
    deletable: false,
    anonymizable: true,
    retentionAction: "retain_indefinitely",
    retentionReason: "legal_obligation", // auditoria LGPD
    retainForDays: null,
  },
  third_party_catalog: {
    exportable: false, // nao e dado do usuario; nao redistribuivel
    deletable: false,
    anonymizable: false,
    retentionAction: "exclude_from_export",
    retentionReason: "not_redistributable",
    retainForDays: null,
  },
};

/**
 * Consulta a classificacao de uma categoria. Fail-closed: categoria
 * desconhecida retorna null (o chamador trata como o caso mais restritivo —
 * nao exportavel, retido, sem anonimizacao permissiva).
 */
export function classifyCategory(category: DataCategory): DataClassification | null {
  return DATA_CLASSIFICATION[category] ?? null;
}

/** true apenas quando a categoria e explicitamente exportavel. Fail-closed. */
export function isCategoryExportable(category: DataCategory): boolean {
  return DATA_CLASSIFICATION[category]?.exportable === true;
}
