/**
 * plan.ts — Planejamento PURO do registro de autorização.
 *
 * Recebe a autorização declarada (`authorization-spec.ts`) + uma PROJEÇÃO do
 * estado atual do banco (licenças e decisões vigentes) e decide, sem tocar em
 * nada, o que criar / supersedir / manter. O bin (`bin/legal.ts`) consulta o
 * banco, projeta o estado, chama isto e — só sob `--confirm` — aplica.
 *
 * Idempotência é a propriedade central: rodar duas vezes o MESMO spec sobre o
 * MESMO estado não deve produzir escrita na segunda vez. Por isso cada alvo é
 * comparado campo a campo com o vigente: igual => `keep`, diferente => nova
 * versão com `supersedes_id` (histórico preservado, nunca UPDATE destrutivo).
 */

import type { AuthorizationEntry, DecisionTarget, LicenseTarget, SourceRole } from "./authorization-spec.js";

/** Projeção da licença VIGENTE (só o necessário para comparar/agrupar). */
export interface CurrentLicense {
  readonly id: string;
  readonly sourceKey: string;
  readonly contentType: string;
  readonly ratingSourceKey: string | null;
  readonly providerKey: string | null;
  readonly territory: string | null;
  readonly licenseStatus: string;
  readonly displayAllowed: boolean;
  readonly logoAllowed: boolean;
  readonly scoreAllowed: boolean;
  readonly reviewQuoteAllowed: boolean;
  readonly requiresAttribution: boolean;
  readonly requiresLinkback: boolean;
  readonly attributionText: string | null;
  readonly policyVersion: string | null;
}

/** Projeção da decisão VIGENTE. */
export interface CurrentDecision {
  readonly id: string;
  readonly sourceLicenseId: string;
  readonly useCase: string;
  readonly territory: string | null;
  readonly stage: string;
  readonly displayAllowed: boolean;
  readonly storageAllowed: boolean;
  readonly derivativeAllowed: boolean;
  readonly attributionRequired: boolean;
  readonly linkbackRequired: boolean;
  readonly policyVersion: string | null;
}

export type ActionKind = "create" | "supersede" | "keep";

/** Ação planejada para uma decisão. */
export interface DecisionPlan {
  readonly action: ActionKind;
  /** Id da decisão vigente quando `supersede`/`keep`. */
  readonly currentId: string | null;
  readonly target: DecisionTarget;
}

/** Ação planejada para uma entrada (licença + suas decisões). */
export interface EntryPlan {
  readonly label: string;
  readonly role: SourceRole;
  readonly license: {
    readonly action: ActionKind;
    readonly currentId: string | null;
    readonly target: LicenseTarget;
  };
  readonly decisions: readonly DecisionPlan[];
  /** Decisões da licença antiga a desativar (só quando a licença é superseded). */
  readonly deactivateDecisionIds: readonly string[];
}

/** Resultado completo do planejamento. */
export interface AuthorizationPlan {
  readonly entries: readonly EntryPlan[];
  readonly summary: {
    readonly licensesCreate: number;
    readonly licensesSupersede: number;
    readonly licensesKeep: number;
    readonly decisionsCreate: number;
    readonly decisionsSupersede: number;
    readonly decisionsKeep: number;
  };
}

/**
 * Chave natural de agrupamento (espelha os índices únicos parciais do banco).
 *
 * Codificação por `JSON.stringify` de tupla, e não por separador: os campos são
 * strings LIVRES vindas do banco, então nenhum delimitador — imprimível ou não —
 * pode ser provado ausente delas. O escape do JSON é inequívoco, logo a chave é
 * injetiva sem depender do domínio dos valores. A versão anterior usava um byte
 * de controle CRU (0x1F) como separador: invisível no editor e no diff, e ainda
 * assim sujeito a colisão se um campo o contivesse.
 *
 * O `?? ""` é PRESERVADO de propósito: ele colapsa `null` e string vazia na mesma
 * chave, e mudá-lo alteraria agrupamentos reais — fora do escopo desta unidade.
 */
function licenseGroupKey(l: {
  sourceKey: string;
  contentType: string;
  providerKey: string | null;
  territory: string | null;
}): string {
  return JSON.stringify([l.sourceKey, l.contentType, l.providerKey ?? "", l.territory ?? ""]);
}

function decisionGroupKey(sourceLicenseId: string, useCase: string, territory: string | null): string {
  return JSON.stringify([sourceLicenseId, useCase, territory ?? ""]);
}

function licenseMatches(current: CurrentLicense, target: LicenseTarget): boolean {
  return (
    current.licenseStatus === target.licenseStatus &&
    current.displayAllowed === target.displayAllowed &&
    current.logoAllowed === target.logoAllowed &&
    current.scoreAllowed === target.scoreAllowed &&
    current.reviewQuoteAllowed === target.reviewQuoteAllowed &&
    current.requiresAttribution === target.requiresAttribution &&
    current.requiresLinkback === target.requiresLinkback &&
    (current.ratingSourceKey ?? null) === target.ratingSourceKey &&
    (current.attributionText ?? "") === target.attributionText &&
    (current.policyVersion ?? "") === target.policyVersion
  );
}

function decisionMatches(current: CurrentDecision, target: DecisionTarget): boolean {
  return (
    current.useCase === target.useCase &&
    (current.territory ?? null) === target.territory &&
    current.stage === target.stage &&
    current.displayAllowed === target.displayAllowed &&
    current.storageAllowed === target.storageAllowed &&
    current.derivativeAllowed === target.derivativeAllowed &&
    current.attributionRequired === target.attributionRequired &&
    current.linkbackRequired === target.linkbackRequired &&
    (current.policyVersion ?? "") === target.policyVersion
  );
}

/**
 * Planeja o registro. `entries` já inclui as estáticas + as de provedores reais
 * (o bin monta a lista antes de chamar).
 */
export function planAuthorization(
  entries: readonly AuthorizationEntry[],
  currentLicenses: readonly CurrentLicense[],
  currentDecisions: readonly CurrentDecision[],
): AuthorizationPlan {
  const licenseByGroup = new Map<string, CurrentLicense>();
  for (const l of currentLicenses) licenseByGroup.set(licenseGroupKey(l), l);

  const decisionByGroup = new Map<string, CurrentDecision>();
  const decisionsByLicense = new Map<string, CurrentDecision[]>();
  for (const d of currentDecisions) {
    decisionByGroup.set(decisionGroupKey(d.sourceLicenseId, d.useCase, d.territory), d);
    const arr = decisionsByLicense.get(d.sourceLicenseId) ?? [];
    arr.push(d);
    decisionsByLicense.set(d.sourceLicenseId, arr);
  }

  const summary = {
    licensesCreate: 0,
    licensesSupersede: 0,
    licensesKeep: 0,
    decisionsCreate: 0,
    decisionsSupersede: 0,
    decisionsKeep: 0,
  };

  const planned: EntryPlan[] = entries.map((entry) => {
    const current = licenseByGroup.get(licenseGroupKey(entry.license));
    let licenseAction: ActionKind;
    let currentId: string | null;
    let deactivate: string[] = [];

    if (current === undefined) {
      licenseAction = "create";
      currentId = null;
      summary.licensesCreate += 1;
    } else if (licenseMatches(current, entry.license)) {
      licenseAction = "keep";
      currentId = current.id;
      summary.licensesKeep += 1;
    } else {
      licenseAction = "supersede";
      currentId = current.id;
      summary.licensesSupersede += 1;
      // A licença antiga sai de cena: suas decisões referenciam uma licença que
      // deixará de ser vigente, então são desativadas (o read path já ignora
      // decisão cuja licença não é is_current — isto só limpa o estado).
      deactivate = (decisionsByLicense.get(current.id) ?? []).map((d) => d.id);
    }

    const licenseKept = licenseAction === "keep";
    const decisions: DecisionPlan[] = entry.decisions.map((target) => {
      // Decisão só pode ser "mantida"/"supersedida" quando a licença é a MESMA
      // (mesmo id). Licença nova => toda decisão é criada do zero.
      if (!licenseKept || currentId === null) {
        summary.decisionsCreate += 1;
        return { action: "create", currentId: null, target };
      }
      const currentDecision = decisionByGroup.get(decisionGroupKey(currentId, target.useCase, target.territory));
      if (currentDecision === undefined) {
        summary.decisionsCreate += 1;
        return { action: "create", currentId: null, target };
      }
      if (decisionMatches(currentDecision, target)) {
        summary.decisionsKeep += 1;
        return { action: "keep", currentId: currentDecision.id, target };
      }
      summary.decisionsSupersede += 1;
      return { action: "supersede", currentId: currentDecision.id, target };
    });

    return {
      label: entry.label,
      role: entry.role,
      license: { action: licenseAction, currentId, target: entry.license },
      decisions,
      deactivateDecisionIds: deactivate,
    };
  });

  return { entries: planned, summary };
}

/** `true` quando não há nada a escrever (idempotência atingida). */
export function isPlanClean(plan: AuthorizationPlan): boolean {
  const s = plan.summary;
  return (
    s.licensesCreate === 0 &&
    s.licensesSupersede === 0 &&
    s.decisionsCreate === 0 &&
    s.decisionsSupersede === 0
  );
}

/**
 * Fontes cujo logo entra pelos TERMOS DA PROPRIA FONTE.
 *
 * So o TMDB: os termos da API **exigem** o logo ("You must use the TMDB logo to
 * identify Your use of TMDB, the TMDB APIs, or TMDB Content").
 */
const LOGO_BY_SOURCE_TERMS: ReadonlySet<string> = new Set(["tmdb"]);

/**
 * Fontes cujo logo entra por DECISAO DO PROPRIETARIO (2026-08-20).
 *
 * Nominal, chave a chave — NUNCA derivada do spec: uma guarda que se
 * auto-autoriza a partir do dado que ela guarda nao guarda nada. A lista e a
 * transcricao literal da decisao (docs/legal/owner-authorization-2026-08-20.md):
 * as tres fontes de nota exibiveis + os provedores de streaming registrados
 * (services/streaming/src/provider-registry.ts, leva BR 2026-08-19 inclusa).
 * Provedor novo registrado depois da decisao exige ampliar ESTA lista, com
 * revisao humana — o carimbo em bloco e exatamente o que esta guarda impede.
 */
const LOGO_BY_OWNER_DECISION: ReadonlySet<string> = new Set([
  // Fontes de nota exibiveis
  "imdb",
  "rotten_tomatoes",
  "metacritic",
  // Provedores de streaming registrados (registro canonico, 2026-08-20)
  "netflix",
  "prime-video",
  "amazon-video",
  "max",
  "apple-tv",
  "pluto-tv",
  "google-play",
  "disney-plus",
  "globoplay",
  "hbo-max-amazon-channel",
  "claro-video",
  "telecine-amazon-channel",
  "paramount-plus-amazon-channel",
  "claro-tv-plus",
  "paramount-plus",
  "paramount-plus-premium",
  "universal-plus-amazon-channel",
  "oldflix",
  "mercado-play",
  "sony-one-amazon-channel",
  "paramount-plus-apple-tv-channel",
  "looke",
  "netmovies",
  "lionsgate-plus-amazon-channels",
  "plex",
  "belas-artes-a-la-carte",
  "looke-amazon-channel",
  "mgm-plus-apple-tv-channel",
  "filmelier-plus-amazon-channel",
  "gospel-play",
  "mgm-plus-amazon-channel",
  "arte-amazon-channel",
  "reserva-imovision-amazon-channel",
]);

/**
 * Guarda de segurança PURA, chamada antes de qualquer apply — se disparar, é
 * bug no spec, não estado a corrigir. O que ela garante desde 2026-08-20:
 *
 *  - `cinerie_score_display` SO passa na forma exata que a decisão do
 *    proprietário autorizou (derivada com base `owner_decision`, display
 *    aprovado). Qualquer outra decisão com `derivative_allowed` continua
 *    derrubando o apply — a autorização é do Score, não de "derivadas".
 *  - Logo SO passa para fonte nas duas allowlists NOMINAIS (termos da fonte,
 *    ou decisão do proprietário), com a base coerente com a lista e com o
 *    arquivo oficial declarado.
 *  - Citação integral de crítica continua nunca passando.
 */
export function assertNoBlockedGrants(plan: AuthorizationPlan): void {
  for (const entry of plan.entries) {
    for (const d of entry.decisions) {
      const isScoreDecision = (d.target.useCase as string) === "cinerie_score_display";
      if (isScoreDecision) {
        // A forma autorizada pelo proprietario (2026-08-20), e SO ela: derivada
        // com base owner_decision, aprovada para exibicao. Uma decisao de score
        // sem base registrada afirmaria que "a fonte permitiu" — mentira que o
        // registro existe para impedir.
        if (!d.target.derivativeAllowed || d.target.derivativeBasis !== "owner_decision") {
          throw new Error(
            `plano invalido: decisao cinerie_score_display em "${entry.label}" sem base registrada ` +
              "(exige derivative_allowed com derivativeBasis owner_decision — decisao do proprietario, 2026-08-20)",
          );
        }
        if (d.target.stage !== "approved_for_display" || !d.target.displayAllowed) {
          throw new Error(
            `plano invalido: decisao cinerie_score_display em "${entry.label}" fora do estagio aprovado`,
          );
        }
      } else if (d.target.derivativeAllowed) {
        throw new Error(
          `plano invalido: derivative_allowed em "${entry.label}" (a decisao do proprietario de ` +
            "2026-08-20 autoriza a derivada do Cinerie Score, nao derivadas em geral)",
        );
      }
    }
    if (entry.license.target.reviewQuoteAllowed) {
      throw new Error(`plano invalido: review_quote em "${entry.label}" (nao autorizado)`);
    }
    // LOGO: duas allowlists NOMINAIS, uma por base. Fora delas, o apply cai
    // ANTES de escrever em `source_licenses`. Ampliar exige editar ESTA lista,
    // com revisao humana — nunca uma flag no proprio spec.
    const license = entry.license.target;
    if (license.logoAllowed) {
      const expectedBasis = LOGO_BY_SOURCE_TERMS.has(license.sourceKey)
        ? "source_terms"
        : LOGO_BY_OWNER_DECISION.has(license.sourceKey)
          ? "owner_decision"
          : null;
      if (expectedBasis === null) {
        throw new Error(
          `plano invalido: logo_allowed em "${entry.label}" (fonte "${license.sourceKey}" fora ` +
            "das allowlists nominais de marca — termos da fonte ou decisao do proprietario)",
        );
      }
      if (license.logoBasis !== expectedBasis) {
        throw new Error(
          `plano invalido: logo_allowed em "${entry.label}" com base "${String(license.logoBasis)}" ` +
            `(a allowlist nominal registra "${expectedBasis}" para "${license.sourceKey}" — a base gravada tem que dizer a verdade)`,
        );
      }
      // O logo so pode ir ao ar a partir do arquivo declarado pela licenca. Uma
      // licenca que autoriza a marca sem dizer QUAL arquivo deixaria a pagina
      // livre para desenhar uma aproximacao — o defeito que este campo evita.
      if (license.logoAsset === null) {
        throw new Error(
          `plano invalido: logo_allowed sem logoAsset em "${entry.label}" (marca autorizada precisa declarar o arquivo oficial)`,
        );
      }
    } else if (license.logoBasis !== null) {
      throw new Error(
        `plano invalido: logoBasis sem logo_allowed em "${entry.label}" (base declarada para marca nao autorizada)`,
      );
    }
  }
}
