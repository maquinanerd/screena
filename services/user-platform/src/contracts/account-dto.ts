/**
 * DTOs PUBLICOS de perfil, configuracoes e privacidade (Backend C, C7D).
 *
 * Tudo aqui e serializavel como corpo de resposta ao PROPRIO dono. Nenhum
 * campo carrega segredo, hash, id interno de sessao ou motivo interno.
 *
 * Os mappers (`account-mappers.ts`) montam estes objetos CAMPO A CAMPO a partir
 * das projecoes de persistencia — nunca por spread. E o que garante que uma
 * coluna nova acrescentada la embaixo nao apareca sozinha numa resposta.
 */

import type { ConsentKind, DataRequestKind, DataRequestStatus } from "../core/types.js";
import type { ProfileVisibility } from "../core/types.js";

/** Perfil publico do proprio dono (o que a tela de perfil edita). */
export interface ProfileDto {
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly bio: string | null;
  readonly locale: string;
  readonly countryCode: string | null;
  readonly timezone: string | null;
  readonly visibility: ProfileVisibility;
  /**
   * Preferencias de apresentacao, devolvidas ao cliente.
   *
   * A tela precisa delas para (a) marcar o controle certo e (b) aplicar o efeito
   * sem esperar um segundo request. Sem devolve-las, o painel abriria sempre no
   * default e o usuario veria a propria escolha "sumir" ao recarregar.
   */
  readonly theme: string;
  readonly density: string;
  readonly posterSize: string;
}

/**
 * Uma finalidade de consentimento, como a tela de privacidade a exibe.
 *
 * `revocable` e `legalBasis` vem de `describeConsentBasis` (privacy/policy) e
 * existem para NAO representar falsamente a natureza da finalidade: termos e
 * politica de privacidade nao sao consentimento revogavel, e uma interface que
 * os mostrasse com um botao "retirar" mentiria sobre a base legal.
 *
 * `granted: null` significa AUSENCIA de registro — que nunca equivale a
 * concedido (invariante LGPD). Um booleano puro apagaria essa distincao.
 */
export interface ConsentStateDto {
  readonly kind: ConsentKind;
  readonly granted: boolean | null;
  readonly policyVersion: string | null;
  readonly currentPolicyVersion: string;
  readonly legalBasis: "consent" | "contract" | "legal_obligation" | "legitimate_interest";
  readonly revocable: boolean;
  /**
   * `true` quando ha aceite vigente porem de uma versao ANTIGA do documento.
   * A tela usa isto para pedir novo aceite sem apagar o historico.
   */
  readonly needsRenewal: boolean;
}

/** Estado completo da tela de privacidade. */
export interface PrivacyStateDto {
  readonly consents: readonly ConsentStateDto[];
  readonly requests: readonly DataRequestDto[];
  /** Estado da conta, para a tela saber se ja ha encerramento em andamento. */
  readonly accountStatus: "active" | "disabled" | "pending_deletion" | "deleted";
}

/** Pedido LGPD como o titular o ve. Sem `processedBy` (identidade de operador). */
export interface DataRequestDto {
  readonly kind: DataRequestKind;
  readonly status: DataRequestStatus;
  readonly requestedAt: string;
  readonly processedAt: string | null;
}

/** Aceite de um pedido LGPD (exportacao ou encerramento). */
export interface DataRequestAcceptedDto {
  readonly ok: true;
  readonly kind: DataRequestKind;
  readonly status: DataRequestStatus;
  readonly message: string;
}

/**
 * Envelope da EXPORTACAO.
 *
 * `format` e versionado de proposito: quem baixar o arquivo hoje precisa
 * conseguir interpreta-lo daqui a dois anos, e um formato sem versao torna
 * qualquer mudanca futura uma quebra silenciosa.
 *
 * `manifest` acompanha os DADOS e diz, por categoria, o que entrou e o que NAO
 * entrou e por que — e o que torna a exportacao auditavel em vez de uma pilha
 * de JSON sem contexto.
 */
export interface DataExportDto {
  readonly format: "cinerie.export.v1";
  readonly generatedAt: string;
  readonly manifest: readonly {
    readonly category: string;
    readonly included: boolean;
    readonly reason: string;
  }[];
  readonly account: Readonly<Record<string, unknown>>;
  readonly profile: ProfileDto | null;
  readonly consents: readonly {
    readonly kind: ConsentKind;
    readonly granted: boolean;
    readonly policyVersion: string;
    readonly occurredAt: string;
  }[];
  readonly requests: readonly DataRequestDto[];
  readonly content: Readonly<Record<string, readonly unknown[]>>;
  readonly stats: unknown;
}
