/**
 * COMANDOS VALIDADOS de perfil, preferencias e privacidade (Backend C, C7D).
 *
 * Mesmas regras de `auth-commands.ts`: puro, allow-list estrita, nunca spread.
 * Arquivo separado porque o eixo e outro — aquele cobre autenticar, este cobre
 * o que o titular faz DEPOIS de autenticado.
 *
 * NENHUM comando daqui carrega `userId`. A identidade vem SEMPRE da sessao
 * resolvida no servidor; aceita-la no corpo seria entregar ao cliente o poder
 * de escolher de quem e o dado que ele edita — a falha de ownership classica.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import { validateHandle } from "../auth/index.js";
import { CONSENT_KINDS, type ConsentKind, PROFILE_VISIBILITIES } from "../core/types.js";
import type { ProfileVisibility } from "../core/types.js";
import { asRecord, optionalString, rejectUnknownKeys, requireString } from "./parse.js";
import { DISPLAY_NAME_MAX_LENGTH, RAW_PASSWORD_READ_MAX } from "./auth-commands.js";

/** Limites de fronteira (guardas de tamanho antes de qualquer politica). */
export const BIO_MAX_LENGTH = 500;
export const TIMEZONE_MAX_LENGTH = 64;
export const LOCALE_MAX_LENGTH = 35; // BCP-47 com subtags
export const HANDLE_MAX_LENGTH = 30;

/** BCP-47 na forma que o produto usa (`pt-BR`, `en`, `es-419`). */
const LOCALE_SHAPE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** ISO-3166-1 alpha-2, maiusculo. Espelha o CHECK da coluna. */
const COUNTRY_SHAPE = /^[A-Z]{2}$/;
/** IANA tz: `America/Sao_Paulo`, `UTC`. Forma, nao existencia. */
const TIMEZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/**
 * Vocabularios FECHADOS das preferencias de apresentacao.
 *
 * Espelham os CHECK de `user_profiles` (migration
 * `20260820140000_user_presentation_preferences`). Os dois lados precisam
 * concordar: o CHECK protege o banco de escrita fora do app, e o parser protege
 * o usuario de um 500 quando o CHECK dispara. Ha teste que compara os dois.
 */
export const PROFILE_DENSITIES = ["comfortable", "compact"] as const;
export const PROFILE_POSTER_SIZES = ["small", "medium", "large"] as const;

export type ProfileDensity = (typeof PROFILE_DENSITIES)[number];
export type ProfilePosterSize = (typeof PROFILE_POSTER_SIZES)[number];

export interface UpdateProfileCommand {
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly bio: string | null;
  readonly locale: string;
  readonly countryCode: string | null;
  readonly timezone: string | null;
  readonly visibility: ProfileVisibility;
  /**
   * Preferencias de APRESENTACAO. Obrigatorias na presenca da chave, como o
   * resto do comando — este endpoint substitui o perfil INTEIRO, e um campo
   * opcional aqui tornaria impossivel distinguir "voltar ao default" de "nao
   * mexer".
   */
  readonly density: ProfileDensity;
  readonly posterSize: ProfilePosterSize;
}

/**
 * Perfil COMPLETO, nunca parcial.
 *
 * Todo campo e obrigatorio na presenca da chave (podendo ser `null` onde a
 * coluna e nullable) porque um PATCH parcial tornaria impossivel distinguir
 * "apagar a bio" de "nao mexer na bio" — e a diferenca importa: uma delas e um
 * pedido explicito de remocao de dado pessoal.
 *
 * `avatarPath` NAO entra: nao ha pipeline de upload nesta unidade, e aceitar um
 * caminho do cliente deixaria o servidor apontar para um arquivo arbitrario.
 */
export function parseUpdateProfileCommand(input: unknown): DomainResult<UpdateProfileCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, [
    "displayName",
    "handle",
    "bio",
    "locale",
    "countryCode",
    "timezone",
    "visibility",
    "density",
    "posterSize",
  ]);
  if (!strict.ok) return strict;

  const displayName = optionalString(record.value, "displayName", {
    trim: true,
    max: DISPLAY_NAME_MAX_LENGTH,
  });
  if (!displayName.ok) return displayName;

  const handle = optionalString(record.value, "handle", { trim: true, max: HANDLE_MAX_LENGTH });
  if (!handle.ok) return handle;
  if (handle.value !== undefined && handle.value !== null && handle.value.length > 0) {
    // Politica CENTRAL (auth/identity.validateHandle) — nao ha regex duplicada
    // aqui que possa divergir do CHECK da coluna.
    const shape = validateHandle(handle.value);
    if (!shape.ok) {
      return err("validation_failed", "dados invalidos.", shape.errors);
    }
  }

  const bio = optionalString(record.value, "bio", { trim: true, max: BIO_MAX_LENGTH });
  if (!bio.ok) return bio;

  const locale = requireString(record.value, "locale", { trim: true, max: LOCALE_MAX_LENGTH });
  if (!locale.ok) return locale;
  if (!LOCALE_SHAPE.test(locale.value)) {
    return err("validation_failed", "dados invalidos.", ["locale deve ser BCP-47 (ex.: pt-BR)."]);
  }

  const countryCode = optionalString(record.value, "countryCode", { trim: true, max: 2 });
  if (!countryCode.ok) return countryCode;
  if (
    countryCode.value !== undefined &&
    countryCode.value !== null &&
    countryCode.value.length > 0 &&
    !COUNTRY_SHAPE.test(countryCode.value)
  ) {
    return err("validation_failed", "dados invalidos.", [
      "countryCode deve ser ISO-3166-1 alpha-2 maiusculo (ex.: BR).",
    ]);
  }

  const timezone = optionalString(record.value, "timezone", {
    trim: true,
    max: TIMEZONE_MAX_LENGTH,
  });
  if (!timezone.ok) return timezone;
  if (
    timezone.value !== undefined &&
    timezone.value !== null &&
    timezone.value.length > 0 &&
    !TIMEZONE_SHAPE.test(timezone.value)
  ) {
    return err("validation_failed", "dados invalidos.", [
      "timezone deve ser um identificador IANA (ex.: America/Sao_Paulo).",
    ]);
  }

  const visibilityRaw = record.value["visibility"];
  if (
    typeof visibilityRaw !== "string" ||
    !(PROFILE_VISIBILITIES as readonly string[]).includes(visibilityRaw)
  ) {
    return err("validation_failed", "dados invalidos.", [
      `visibility deve ser um de: ${PROFILE_VISIBILITIES.join(", ")}.`,
    ]);
  }

  // Cada preferencia e um conjunto FECHADO. Valor fora dele e recusado na
  // fronteira, com a lista no erro — em vez de virar 500 quando o CHECK do
  // banco disparar, que e o mesmo defeito visto de mais longe.
  const enumerado = <T extends string>(
    chave: string,
    permitidos: readonly T[],
  ): DomainResult<T> => {
    const bruto = record.value[chave];
    if (typeof bruto !== "string" || !(permitidos as readonly string[]).includes(bruto)) {
      return err("validation_failed", "dados invalidos.", [
        `${chave} deve ser um de: ${permitidos.join(", ")}.`,
      ]);
    }
    return ok(bruto as T);
  };

  const density = enumerado("density", PROFILE_DENSITIES);
  if (!density.ok) return density;
  const posterSize = enumerado("posterSize", PROFILE_POSTER_SIZES);
  if (!posterSize.ok) return posterSize;

  const vazioParaNull = (v: string | null | undefined): string | null =>
    v === undefined || v === null || v.length === 0 ? null : v;

  return ok({
    displayName: vazioParaNull(displayName.value),
    handle: vazioParaNull(handle.value),
    bio: vazioParaNull(bio.value),
    locale: locale.value,
    countryCode: vazioParaNull(countryCode.value),
    timezone: vazioParaNull(timezone.value),
    visibility: visibilityRaw as ProfileVisibility,
    density: density.value,
    posterSize: posterSize.value,
  });
}

export interface SetConsentCommand {
  readonly kind: ConsentKind;
  readonly granted: boolean;
}

/**
 * Decisao de consentimento de UMA finalidade.
 *
 * `granted` exige booleano REAL — sem coercao. Uma string `"false"` e truthy em
 * JavaScript, e um consentimento concedido por coercao seria indistinguivel de
 * um aceite real na tabela que existe justamente para servir de prova.
 *
 * `policyVersion` NAO vem do cliente: e do servidor. Aceita-la aqui permitiria
 * registrar aceite de uma versao inexistente ou antiga.
 */
export function parseSetConsentCommand(input: unknown): DomainResult<SetConsentCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["kind", "granted"]);
  if (!strict.ok) return strict;

  const kindRaw = record.value["kind"];
  if (typeof kindRaw !== "string" || !(CONSENT_KINDS as readonly string[]).includes(kindRaw)) {
    return err("validation_failed", "dados invalidos.", [
      `kind deve ser um de: ${CONSENT_KINDS.join(", ")}.`,
    ]);
  }

  const granted = record.value["granted"];
  if (typeof granted !== "boolean") {
    return err("validation_failed", "dados invalidos.", ["granted deve ser booleano."]);
  }

  return ok({ kind: kindRaw as ConsentKind, granted });
}

export interface RequestClosureCommand {
  /** Reautenticacao: encerrar conta exige provar posse da senha. */
  readonly password: string;
}

/**
 * Pedido de ENCERRAMENTO.
 *
 * Exige a senha atual (reautenticacao) porque encerrar e destrutivo e
 * irreversivel apos a janela de arrependimento. Uma sessao roubada nao pode
 * apagar a conta de alguem sem conhecer a senha.
 */
export function parseRequestClosureCommand(input: unknown): DomainResult<RequestClosureCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["password"]);
  if (!strict.ok) return strict;

  const password = requireString(record.value, "password", { max: RAW_PASSWORD_READ_MAX });
  if (!password.ok) return password;

  return ok({ password: password.value });
}
