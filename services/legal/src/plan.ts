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

import { CINERIE_TERRITORY } from "./authorization-spec.js";
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

/**
 * O DESTINO das linhas de dado que estavam penduradas numa decisão que sai.
 *
 * POR QUE ESTE TIPO EXISTE. `external_ratings.data_usage_decision_id` e
 * `watch_availability.data_usage_decision_id` são FKs para uma LINHA de
 * `data_usage_decisions` — não para "a decisão vigente daquele uso". Quando uma
 * licença é supersedida, as decisões dela saem de cena (`is_current=false`) e
 * NASCEM linhas novas, com ids novos. As notas e as ofertas continuam apontando
 * para os ids velhos, e todo gate de leitura exige `is_current` na decisão E na
 * licença-mãe (`apps/web/src/server/entity-ratings.ts`,
 * `apps/web/src/server/entity-watch.ts`). Resultado: a coluna `display_allowed`
 * não muda uma linha e mesmo assim a página esvazia.
 *
 * Foi o que aconteceu em produção em 2026-08-20 (`supersede=72`): 453 notas e
 * 874 ofertas sumiram da tela com `display_allowed` intacto. O comentário que
 * governava este ponto dizia que desativar as decisões "só limpa o estado,
 * porque o read path já ignora decisão cuja licença não é is_current" — verdade
 * sobre a decisão, cega quanto ao que apontava para ela.
 *
 * Então o supersede passa a CARREGAR as linhas: quando a licença nova concede o
 * mesmo uso, elas passam a apontar para a decisão nova na MESMA transação.
 * Quando a licença nova é mais restritiva, elas ficam onde estão e somem — mas
 * o plano diz quantas, ANTES de escrever (ver `impact.ts`).
 */
export interface DecisionCarry {
  /** Decisão que sai de cena (id atual, ao qual as linhas ainda apontam). */
  readonly fromDecisionId: string;
  readonly useCase: string;
  readonly territory: string | null;
  /**
   * Índice em `EntryPlan.decisions` da decisão NOVA que assume as linhas.
   * `null` quando nenhuma assume. Índice, e não id, porque a linha nova ainda
   * não existe no momento do planejamento — quem resolve é `apply.ts`.
   */
  readonly toDecisionIndex: number | null;
  readonly verdict: "carry" | "withhold";
  /** Por que as linhas NÃO são carregadas. Vazio quando `carry`. */
  readonly reason: string;
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
  /**
   * O que acontece com as linhas de dado penduradas em cada decisão desativada.
   * Vazio quando a licença é `keep`/`create` (nada sai de cena).
   */
  readonly carries: readonly DecisionCarry[];
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

/** `license_status` que permitem exibição (espelha trigger e read path). */
const DISPLAYABLE_LICENSE_STATUS: ReadonlySet<string> = new Set(["official", "licensed", "third_party"]);

/**
 * Por que a licença NOVA não permitiria exibir; `null` quando permite.
 *
 * Espelha, campo a campo, o que `external_ratings_display_guard` /
 * `watch_availability_display_guard` exigem da licença-mãe e o que o read path
 * reconfere. Precisa ser decidido AQUI, no plano: tentar carregar linhas para
 * uma licença que o trigger vai recusar aborta a transação inteira do apply —
 * uma mudança legítima de licença derrubaria a ferramenta.
 */
function licenseDisplayRefusal(license: LicenseTarget): string | null {
  if (!DISPLAYABLE_LICENSE_STATUS.has(license.licenseStatus)) {
    return `licenca nova com license_status=${license.licenseStatus} nao permite exibicao`;
  }
  if (!license.displayAllowed) return "licenca nova com display_allowed=false";
  // Exibir uma NOTA é exibir o número (regra de ratings §5). Só vale para
  // `rating`: uma licença de `watch_availability` não tem score para permitir.
  if (license.contentType === "rating" && !license.scoreAllowed) {
    return "licenca nova com score_allowed=false (a nota exibe o numero)";
  }
  return null;
}

/** A decisão nova aprova exibição? (o que o guard de escrita exige do destino) */
function targetApprovesDisplay(target: DecisionTarget): boolean {
  return target.stage === "approved_for_display" && target.displayAllowed;
}

/**
 * Para UMA decisão que sai de cena com a LICENÇA, decide quem a sucede.
 *
 * Precedência territorial idêntica à do resolvedor de escrita
 * (`ORDER BY (d.territory IS NOT NULL) DESC` em ratings-review-store e
 * watch-review-store): a decisão territorial vence a global. Uma decisão
 * escopada a OUTRO território não sucede nada aqui — ela não autorizaria
 * exibição neste site.
 */
function planCarry(
  current: CurrentDecision,
  license: LicenseTarget,
  targets: readonly DecisionTarget[],
): DecisionCarry {
  const base = {
    fromDecisionId: current.id,
    useCase: current.useCase,
    territory: current.territory,
  } as const;
  const withhold = (reason: string): DecisionCarry => ({
    ...base,
    toDecisionIndex: null,
    verdict: "withhold",
    reason,
  });

  const candidates = targets
    .map((target, index) => ({ target, index }))
    .filter(
      ({ target }) =>
        (target.useCase as string) === current.useCase &&
        (target.territory === null || target.territory === CINERIE_TERRITORY),
    )
    .sort((a, b) => Number(b.target.territory !== null) - Number(a.target.territory !== null));

  if (candidates.length === 0) {
    return withhold(`a leva nova nao tem decisao de ${current.useCase} para ${CINERIE_TERRITORY}`);
  }

  const licenseRefusal = licenseDisplayRefusal(license);
  if (licenseRefusal !== null) return withhold(licenseRefusal);

  const chosen = candidates.find(({ target }) => targetApprovesDisplay(target));
  if (chosen === undefined) {
    return withhold(`a decisao nova de ${current.useCase} nao aprova exibicao (stage/display_allowed)`);
  }

  return { ...base, toDecisionIndex: chosen.index, verdict: "carry", reason: "" };
}

/**
 * Mesma pergunta, para a decisão supersedida com a LICENÇA MANTIDA.
 *
 * Aqui não há escolha a fazer — a versão nova está no mesmo grupo
 * (`use_case` + território), então o sucessor é ela ou ninguém. O que continua
 * valendo é a recusa: repontuar uma linha exibível para uma decisão que NÃO
 * aprova exibição faz o guard de escrita abortar a transação inteira. A recusa
 * tem de ser decidida aqui, no plano, não descoberta pelo trigger.
 */
function planCarryInPlace(
  current: CurrentDecision,
  license: LicenseTarget,
  target: DecisionTarget,
  index: number,
): DecisionCarry {
  const base = {
    fromDecisionId: current.id,
    useCase: current.useCase,
    territory: current.territory,
  } as const;
  const refusal = licenseDisplayRefusal(license);
  if (refusal !== null) {
    return { ...base, toDecisionIndex: null, verdict: "withhold", reason: refusal };
  }
  if (!targetApprovesDisplay(target)) {
    return {
      ...base,
      toDecisionIndex: null,
      verdict: "withhold",
      reason: `a versao nova de ${current.useCase} nao aprova exibicao (stage/display_allowed)`,
    };
  }
  return { ...base, toDecisionIndex: index, verdict: "carry", reason: "" };
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
    let deactivated: readonly CurrentDecision[] = [];

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
      // deixará de ser vigente, então são desativadas.
      //
      // ATENÇÃO — isto NÃO "só limpa o estado". Era o que o comentário anterior
      // afirmava, e é o que apagou a coluna direita do site em 2026-08-20: as
      // notas e as ofertas apontam para o ID destas linhas, e o read path exige
      // `is_current` nelas. Desativar sem repontuar deixa o dado órfão e
      // invisível, com `display_allowed` intacto. `carries` abaixo decide, por
      // decisão, quem assume as linhas — ver `DecisionCarry`.
      deactivated = decisionsByLicense.get(current.id) ?? [];
      deactivate = deactivated.map((d) => d.id);
    }

    const licenseKept = licenseAction === "keep";
    /** Decisões supersedidas COM a licença mantida (a licença fica, o id da decisão muda). */
    const supersededInPlace: CurrentDecision[] = [];
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
      supersededInPlace.push(currentDecision);
      return { action: "supersede", currentId: currentDecision.id, target };
    });

    return {
      label: entry.label,
      role: entry.role,
      license: { action: licenseAction, currentId, target: entry.license },
      decisions,
      deactivateDecisionIds: deactivate,
      carries: licenseKept
        ? // Licença mantida: só as decisões que ganharam versão nova mudam de id.
          supersededInPlace.map((old) => {
            const index = decisions.findIndex((d) => d.currentId === old.id && d.action === "supersede");
            return planCarryInPlace(old, entry.license, decisions[index]!.target, index);
          })
        : // Licença supersedida: TODAS as decisões dela saem de cena juntas.
          deactivated.map((old) => planCarry(old, entry.license, entry.decisions)),
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
