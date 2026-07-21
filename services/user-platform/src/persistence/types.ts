/**
 * types.ts — CONTRATOS de persistencia da user platform (Backend C, C7A).
 *
 * SO CONTRATOS. Nenhum PrismaClient, nenhum SQL, nenhum IO, nenhuma
 * implementacao — os adapters concretos sao C7B. Este modulo existe para que a
 * fronteira transacional tenha um vocabulario estavel ANTES de existir adapter.
 *
 * Direcao da dependencia: persistence -> dominio (nunca o contrario). Os
 * dominios puros continuam sem saber que persistencia existe.
 */

import type { UserStatus } from "../core/types.js";

/**
 * Escopo transacional OPACO. O adapter (C7B) o liga ao client concreto; este
 * contrato NAO conhece Prisma. O marcador nominal impede passar um objeto
 * qualquer no lugar de um escopo real.
 */
export interface TransactionScope {
  readonly transactional: true;
}

/**
 * Por que a escrita nao pode ser aplicada. Espelha as pre-condicoes que os
 * planos de dominio ja declaram — nao inventa taxonomia nova.
 */
export type PersistenceConflictReason =
  /** O snapshot vigente lido nao e mais o vigente (optimistic concurrency). */
  | "expected_current_mismatch"
  /** Mesma idempotencyKey ja existe com CONTEUDO divergente. */
  | "idempotency_content_mismatch"
  /** A pre-imagem usada no compare-and-swap nao bate mais (ratings/reviews). */
  | "stale_preimage"
  /** Uma constraint UNIQUE barrou a escrita (ex.: dois vigentes concorrentes). */
  | "unique_violation";

/**
 * ALVO SEMANTICO do conflito (C7B0). Existe porque `users` tem TRES uniques de
 * identidade concorrentes (email, email_normalized, handle) e o adapter precisa
 * dizer QUAL falhou — sem jamais expor nome de constraint, indice, tabela ou
 * codigo do driver.
 *
 * E um discriminador ESTRUTURADO acoplado a `unique_violation`, nao uma lista
 * paralela de razoes: assim os contratos ja existentes (recomendacoes) seguem
 * validos sem mudanca — o campo e opcional.
 *
 * Nao e politica de resposta publica: a borda HTTP (unidade futura) decide se
 * reduz essa informacao para evitar enumeracao de contas.
 */
/** Alvos de violacao de UNICIDADE (uniques reais do schema). */
export type UniqueConflictTarget =
  | "identity.email"
  | "identity.emailNormalized"
  | "identity.handle"
  /** Ja existe credencial para o usuario (relacao 1:1 do schema). */
  | "credential.user";

/**
 * Alvos de divergencia de PRE-IMAGEM (compare-and-swap). NAO indica unicidade:
 * o hash NAO tem unique — e apenas o valor comparado no swap.
 */
export type PreimageConflictTarget = "credential.passwordHash";

/** Uniao fechada de todos os alvos (util para documentacao e testes). */
export type PersistenceConflictTarget = UniqueConflictTarget | PreimageConflictTarget;

/**
 * Conflito de persistencia. O `target` e ACOPLADO AO `reason` por construcao:
 * so `unique_violation` aceita alvo de unicidade e so `stale_preimage` aceita
 * alvo de pre-imagem. Assim o typecheck barra pares sem sentido (ex.:
 * `expected_current_mismatch` + `identity.handle`) e `credential.passwordHash`
 * nunca pode sugerir que o hash tem unique.
 *
 * `target` e OPCIONAL: os contratos de recomendacao (C7A) continuam validos sem
 * ele — nenhuma razao foi removida ou renomeada.
 *
 * NAO ha campo de texto livre: um `detail: string` seria um canal por onde um
 * adapter poderia vazar hash ou e-mail em log/erro, e nenhuma varredura de
 * fonte alcanca valor de runtime. O alvo semantico ja carrega o que o chamador
 * precisa; nomes de constraint, SQL, host e banco nunca saem daqui.
 */
export type PersistenceConflict =
  | { readonly reason: "unique_violation"; readonly target?: UniqueConflictTarget }
  | { readonly reason: "stale_preimage"; readonly target?: PreimageConflictTarget }
  | { readonly reason: "expected_current_mismatch" | "idempotency_content_mismatch" };

/**
 * Resultado da EXECUCAO de um plano ja decidido pelo dominio. A persistencia
 * NUNCA decide regra de negocio: ela aplica, nao aplica (noop) ou reporta
 * conflito.
 */
export type PersistenceOutcome<T> =
  | { readonly kind: "applied"; readonly value: T }
  | { readonly kind: "noop"; readonly reason: string }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/** Identificador de linha recem-escrita (null quando o plano nao inseriu). */
export interface WrittenRowRef {
  readonly id: bigint | null;
}

// ---------------------------------------------------------------------------
// C7B0 — IDENTIDADE
//
// DTOs derivados dos fluxos REAIS (auth/flows.ts): `decideSignup` precisa saber
// se o e-mail ja existe; `decideLogin` precisa de existencia + status. Nada
// alem disso entra: os campos sao justificados um a um em
// docs/product/user-product-identity-credential-ports.md.
// ---------------------------------------------------------------------------

/**
 * Identidade como a PERSISTENCIA devolve ao dominio. Minimo ESTRITO — cada
 * campo tem consumidor real:
 *  - `id`     -> chave do dono (busca da credencial; futura sessao);
 *  - `status` -> unica coisa que `decideLogin` consulta (elegibilidade).
 *
 * EXCLUIDOS por NAO terem consumidor nestes fluxos: `email` bruto,
 * `emailNormalized` (quem consultou ja o tem; devolve-lo seria PII sem leitor),
 * `handle`, `displayName`, `role`, `emailVerifiedAt`, `createdAt`, `updatedAt`,
 * `deletedAt`, perfil, preferencias, privacidade e estatisticas.
 * NUNCA contem `passwordHash`, `algorithm`, token ou qualquer segredo.
 */
export interface IdentityRecord {
  readonly id: bigint;
  readonly status: UserStatus;
}

/**
 * Entrada de criacao de identidade. Espelha `SignupCommand` (contracts):
 * e-mail bruto + normalizado (a normalizacao e do DOMINIO — o adapter NAO
 * normaliza) e `displayName` opcional.
 *
 * `status`/`role` NAO entram: o schema tem defaults (`active`/`user`) e permitir
 * defini-los aqui criaria uma operacao administrativa que nenhum fluxo pede.
 * `handle` NAO entra: o cadastro nao o define (ver `SignupCommand`).
 */
export interface IdentityCreateInput {
  readonly email: string;
  readonly emailNormalized: string;
  readonly displayName: string | null;
}

export type IdentityCreateResult =
  | { readonly kind: "created"; readonly identity: IdentityRecord }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

export type IdentityLookupResult =
  | { readonly kind: "found"; readonly identity: IdentityRecord }
  | { readonly kind: "not_found" };

// ---------------------------------------------------------------------------
// C7B0 — CREDENCIAL DE SENHA
//
// O schema mantem UMA credencial por usuario (relacao 1:1, unique em user_id).
// Nenhum historico e inventado aqui. Senha em texto claro NUNCA atravessa estes
// contratos: o dominio (auth/credentials.ts) ja entrega hash + rotulo de
// algoritmo derivado do proprio PHC. O port trata o hash como STRING OPACA:
// nao gera, nao verifica, nao interpreta PHC, nao extrai parametros de scrypt.
// ---------------------------------------------------------------------------

/**
 * Material de verificacao. E o UNICO tipo desta camada autorizado a carregar o
 * hash, devolvido SO por `PasswordCredentialStore.findForVerification`.
 */
export interface CredentialVerificationMaterial {
  /**
   * Hash PHC-like OPACO. Nunca logar, nunca colocar em mensagem de erro.
   *
   * `algorithm` NAO entra aqui: `authenticatePassword` (auth/credentials.ts:58)
   * so recebe `storedHash`, e ate um futuro rehash-on-login le os parametros de
   * DENTRO do proprio PHC. Transportar o rotulo ampliaria a superficie do unico
   * struct que carrega segredo, sem leitor.
   */
  readonly passwordHash: string;
}

/** Criacao da credencial INICIAL (cadastro). Recebe hash, nunca senha. */
export interface CredentialCreateInput {
  readonly userId: bigint;
  readonly passwordHash: string;
  readonly algorithm: string;
}

/**
 * Troca de senha por COMPARE-AND-SWAP. `user_password_credentials` NAO tem
 * coluna `version` (registrado em C7A), entao a pre-imagem e o proprio hash
 * atual — aquele que o chamador acabou de ler e verificar.
 */
export interface CredentialReplaceInput {
  readonly userId: bigint;
  /** Hash que o chamador leu; se nao for mais o vigente => conflict. */
  readonly expectedPasswordHash: string;
  readonly nextPasswordHash: string;
  readonly nextAlgorithm: string;
}

export type CredentialCreateResult =
  | { readonly kind: "created" }
  /** Ja existe credencial para o usuario (1:1). */
  | { readonly kind: "already_exists"; readonly conflict: PersistenceConflict }
  /** FK: o usuario nao existe (nao pode ocorrer dentro da transacao de cadastro). */
  | { readonly kind: "user_not_found" };

export type CredentialVerificationLookupResult =
  | { readonly kind: "found"; readonly material: CredentialVerificationMaterial }
  | { readonly kind: "not_found" };

export type CredentialReplaceResult =
  | { readonly kind: "updated" }
  /** Nao ha credencial para o usuario. */
  | { readonly kind: "not_found" }
  /** A pre-imagem nao corresponde mais (`stale_preimage`) — nunca sobrescrever. */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };
