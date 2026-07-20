/**
 * Tipos do dominio de privacidade / LGPD (Backend C, unidade C3).
 *
 * PURO: sem rede, sem DB, sem crypto, sem relogio. Espelha os enums LGPD do
 * schema (ConsentKind/DataRequestKind/DataRequestStatus/UserStatus) e adiciona
 * as CATEGORIAS DE DADO, ACOES DE RETENCAO e BASES LEGAIS como classificacao
 * pura — nenhuma delas e campo persistente novo (nao ha migration nesta
 * unidade); sao politica de dominio, validada por testes.
 *
 * Separacao interno x publico: resultados INTERNOS podem carregar categoria,
 * acao, reason code e ids de orquestracao; resultados PUBLICOS (DTOs locais,
 * provisorios — ver pendencia C3B) nunca carregam id interno, hash, segredo,
 * token, nome de tabela/coluna nem estado de outro usuario.
 */

import type {
  ConsentKind,
  DataRequestKind,
  DataRequestStatus,
  ProfileVisibility,
  UserStatus,
  Visibility,
} from "../core/types.js";

export type {
  ConsentKind,
  DataRequestKind,
  DataRequestStatus,
  ProfileVisibility,
  UserStatus,
  Visibility,
};

// ---------------------------------------------------------------------------
// Categorias de dado (ordem canonica; usada em planos/manifestos deterministicos)
// ---------------------------------------------------------------------------

export const DATA_CATEGORIES = [
  "account_core", // id interno, handle, email, status
  "account_credentials", // password hash + metadados de senha (nunca exportavel)
  "profile", // displayName, avatar, bio, locale, pais, timezone, visibilidade
  "product_content", // watchlist, listas, tracking, ratings, reviews, diario
  "product_stats", // estatisticas agregadas (anonimo retido por politica)
  "security_sessions", // hashes de sessao/csrf
  "security_tokens", // hashes de tokens de uso unico
  "security_ip", // hashes de IP (IP cru nunca persiste)
  "security_audit", // logs de autenticacao / antifraude
  "governance_consents", // registros de consentimento
  "governance_requests", // pedidos LGPD (export/exclusao)
  "third_party_catalog", // metadados de catalogo (TMDB) — nao sao dado do usuario
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Bases legais e acoes de retencao
// ---------------------------------------------------------------------------

export const LEGAL_BASES = [
  "consent", // revogavel livremente
  "contract", // execucao de contrato (ToS) — nao revogavel usando o servico
  "legal_obligation", // obrigacao legal (ex.: prova de consentimento, audit)
  "legitimate_interest", // interesse legitimo (ex.: seguranca/antifraude)
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

export const RETENTION_ACTIONS = [
  "delete",
  "anonymize",
  "retain_until",
  "retain_indefinitely",
  "exclude_from_export",
  "include_in_export",
] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];

/** Codigos de razao CONTROLADOS (nunca texto livre do usuario) para retencao. */
export const RETENTION_REASONS = [
  "user_owned_data", // dado proprio do titular
  "referential_integrity", // integridade referencial (ex.: tumba de conta)
  "security_obligation", // obrigacao de seguranca/antifraude
  "legal_obligation", // obrigacao legal (prova de consentimento, audit LGPD)
  "aggregate_anonymous", // agregado anonimo permitido por politica
  "not_redistributable", // dado de terceiro sem direito de redistribuicao
] as const;
export type RetentionReason = (typeof RETENTION_REASONS)[number];

// ---------------------------------------------------------------------------
// Resultados INTERNOS (orquestracao) — nunca sao a resposta publica
// ---------------------------------------------------------------------------

/** Uma linha do plano de retencao/exclusao (interno). */
export interface RetentionDecision {
  readonly category: DataCategory;
  readonly action: RetentionAction;
  readonly reason: RetentionReason;
  /** Prazo relativo em dias (para retain_until); null caso nao se aplique. */
  readonly retainForDays: number | null;
}

/** Entrada do manifesto de exportacao (interno; convertido na borda futura). */
export interface ExportManifestEntry {
  readonly category: DataCategory;
  readonly included: boolean;
  readonly reason: RetentionReason;
}

// ---------------------------------------------------------------------------
// DTOs PUBLICOS locais (PROVISORIOS — pendencia C3B: mover para contracts/)
// Nunca carregam id interno, hash, segredo, token nem estrutura de banco.
// ---------------------------------------------------------------------------

/** Preferencias de privacidade visiveis ao dono (sem id interno). */
export interface PublicPrivacyPreferencesDto {
  readonly profileVisibility: ProfileVisibility;
  readonly defaultListVisibility: Visibility;
  readonly defaultWatchStateVisibility: Visibility;
}

/** Aceite generico de um pedido LGPD (export/exclusao). */
export interface PublicDataRequestAcceptedDto {
  readonly ok: true;
  readonly kind: DataRequestKind;
  readonly status: DataRequestStatus;
  readonly message: string;
}

/** Estado publico da conta quanto a exclusao (sem detalhe interno). */
export interface PublicAccountLifecycleDto {
  readonly status: UserStatus;
  /** Data efetiva prevista (ISO 8601 UTC) quando em carencia; senao null. */
  readonly effectiveDeletionAt: string | null;
  readonly cancellable: boolean;
}
