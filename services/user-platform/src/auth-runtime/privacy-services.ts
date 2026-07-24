/**
 * SERVICOS DE APLICACAO de perfil, consentimento e direitos do titular (C7D).
 *
 * Perfil/preferencias, consentimento versionado, exportacao de dados e
 * encerramento de conta. Mesma arquitetura das unidades anteriores: o dominio
 * puro de `privacy/` decide, os ports persistem, tudo em UMA transacao.
 *
 * OWNERSHIP E ESTRUTURAL AQUI. Nenhuma funcao deste arquivo recebe `userId` de
 * fora: todas recebem `AuthenticatedContext`, que so nasce de
 * `resolveAuthenticatedContext` a partir do cookie. Nao existe assinatura por
 * onde um cliente escolha de quem e o dado que le ou altera.
 */

import {
  buildExportManifest,
  buildExportPlan,
  decideExportRequest,
  isRequestActive,
  assertExportContainsNoSecrets,
} from "../privacy/export.js";
import {
  buildDeletionPlan,
  computeEffectiveDeletionAt,
  decideDeletionCancel,
  decideDeletionRequest,
} from "../privacy/deletion.js";
import { currentConsent, describeConsentBasis, recordConsent, revokeConsent } from "../privacy/consent.js";
import { CONSENT_KINDS, type ConsentKind, type UserStatus } from "../core/types.js";
import { type DomainResult, err, ok } from "../core/result.js";
import { authenticatePassword } from "../auth/credentials.js";
import { planRevokeAllAfterSensitiveEvent } from "../auth/sessions.js";
import type {
  ConsentStateDto,
  DataExportDto,
  DataRequestDto,
  PrivacyStateDto,
  ProfileDto,
} from "../contracts/account-dto.js";
import type {
  RequestClosureCommand,
  SetConsentCommand,
  UpdateProfileCommand,
} from "../contracts/account-commands.js";
import type { AuthenticatedContext, AuthRequestContext, AuthRuntimeDeps } from "./deps.js";
import { AuthTransactionAbort, isAuthTransactionAbort } from "./transaction.js";
import { consumeAuthRequestBudget } from "./throttle.js";

/**
 * Versao vigente de UMA finalidade.
 *
 * `marketing_email` e `analytics` nao tem documento proprio — sao finalidades
 * descritas DENTRO da politica de privacidade, entao acompanham a versao dela.
 * Inventar uma versao separada faria a prova apontar para um texto inexistente.
 */
function currentPolicyVersion(deps: AuthRuntimeDeps, kind: ConsentKind): string {
  return kind === "terms_of_service"
    ? deps.policyVersions.terms_of_service
    : deps.policyVersions.privacy_policy;
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export async function readProfile(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
): Promise<ProfileDto | null> {
  return deps.runInTransaction(async (scope, stores) => {
    const lookup = await stores.profiles.findByUserId(scope, authenticated.userId);
    if (lookup.kind !== "found") {
      return null;
    }
    const p = lookup.profile;
    // Campo a campo: `avatarPath` NAO sai. Nao ha pipeline de midia nesta
    // unidade, e devolver um caminho interno sem servidor de assets seria
    // expor estrutura sem leitor.
    return {
      displayName: p.displayName,
      handle: p.handle,
      bio: p.bio,
      locale: p.locale,
      countryCode: p.countryCode,
      timezone: p.timezone,
      visibility: p.visibility,
    };
  });
}

/**
 * Atualiza perfil + preferencias. Conta nao-operacional nao edita nada
 * (`assertCanMutate` ja e aplicado pela borda via status).
 */
export async function updateProfile(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  command: UpdateProfileCommand,
  // `_context` mantido na assinatura por simetria com os outros servicos e
  // porque a auditoria de perfil entra aqui quando o enum ganhar o evento (ver
  // nota abaixo). Nao consumido hoje.
  _context: AuthRequestContext,
): Promise<DomainResult<ProfileDto>> {
  return deps.runInTransaction(async (scope, stores) => {
    const atual = await stores.profiles.findByUserId(scope, authenticated.userId);
    if (atual.kind !== "found") {
      return err<ProfileDto>("not_found", "perfil nao encontrado.");
    }

    const saved = await stores.profiles.upsert(scope, {
      userId: authenticated.userId,
      displayName: command.displayName,
      handle: command.handle,
      bio: command.bio,
      // `avatarPath` PRESERVADO: o comando nao o carrega, e sobrescrever com
      // null aqui apagaria o avatar a cada edicao de bio.
      avatarPath: atual.profile.avatarPath,
      locale: command.locale,
      countryCode: command.countryCode,
      timezone: command.timezone,
      visibility: command.visibility,
    });

    if (saved.kind !== "saved") {
      // Unica causa possivel de conflito: handle de outra conta. A mensagem
      // NAO revela de quem — apenas que esta em uso.
      return err<ProfileDto>("conflict", "este nome de usuario ja esta em uso.");
    }

    // SEM entrada em `user_auth_audit_logs`.
    //
    // `AuthAuditAction` e um enum FECHADO de eventos de AUTENTICACAO, e nao tem
    // (nem deve ter) um valor para "perfil editado". Reaproveitar um valor
    // existente — `signup`, por exemplo — gravaria um fato FALSO numa tabela
    // append-only, que por construcao ninguem consegue corrigir depois. Um
    // registro de auditoria errado e pior do que a ausencia dele.
    //
    // Acrescentar `profile_updated` ao enum exigiria migration; a lacuna esta
    // registrada em docs/product/user-product-identity-privacy.md.
    const p = saved.profile;
    return ok({
      displayName: p.displayName,
      handle: p.handle,
      bio: p.bio,
      locale: p.locale,
      countryCode: p.countryCode,
      timezone: p.timezone,
      visibility: p.visibility,
    });
  });
}

// ---------------------------------------------------------------------------
// Consentimento
// ---------------------------------------------------------------------------

/** Estado das quatro finalidades + pedidos LGPD + status da conta. */
export async function readPrivacyState(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
): Promise<PrivacyStateDto> {
  return deps.runInTransaction(async (scope, stores) => {
    const registros = await stores.consents.listByUser(scope, authenticated.userId);
    const pedidos = await stores.dataRequests.listByUser(scope, authenticated.userId);

    const consents: ConsentStateDto[] = CONSENT_KINDS.map((kind) => {
      const vigente = currentConsent(registros, kind);
      const base = describeConsentBasis(kind);
      const versaoAtual = currentPolicyVersion(deps, kind);
      return {
        kind,
        // AUSENCIA vira `null`, nunca `false`: "nunca respondeu" e "recusou"
        // sao fatos diferentes, e so o segundo e uma decisao do titular.
        granted: vigente === null ? null : vigente.granted,
        policyVersion: vigente?.policyVersion ?? null,
        currentPolicyVersion: versaoAtual,
        legalBasis: base.legalBasis,
        revocable: base.revocable,
        needsRenewal:
          vigente !== null && vigente.granted && vigente.policyVersion !== versaoAtual,
      };
    });

    return {
      consents,
      requests: pedidos.map(toDataRequestDto),
      accountStatus: authenticated.userStatus,
    };
  });
}

/**
 * Registra uma decisao de consentimento (conceder ou retirar).
 *
 * A RETIRADA tem efeito REAL e imediato porque o gate de leitura
 * (`isConsentActive`) consulta sempre o registro mais recente: assim que a
 * linha `granted=false` entra, toda consulta seguinte ja nega. Nao ha cache a
 * invalidar nem job a esperar.
 *
 * Finalidade NAO revogavel (termos/privacidade, base legal `contract`/
 * `legal_obligation`) recusa a retirada com `forbidden` — retirar o aceite dos
 * termos e encerrar a conta, e isso tem fluxo proprio.
 */
export async function setConsent(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  command: SetConsentCommand,
  // `_context` nao e consumido: a prova de consentimento e a propria linha
  // append-only, nao um log de autenticacao (ver comentario na transacao).
  _context: AuthRequestContext,
): Promise<DomainResult<{ readonly recorded: true }>> {
  const now = deps.now();
  const policyVersion = currentPolicyVersion(deps, command.kind);

  const plan = command.granted
    ? recordConsent({
        userId: authenticated.userId,
        kind: command.kind,
        granted: true,
        policyVersion,
        now,
      })
    : revokeConsent({ userId: authenticated.userId, kind: command.kind, policyVersion, now });

  if (!plan.ok) {
    return plan;
  }

  await deps.runInTransaction(async (scope, stores) => {
    // A PROPRIA linha e a auditoria. `user_consent_records` e append-only e
    // carrega quem, qual finalidade, qual decisao, qual versao e quando — que e
    // exatamente a prova que a LGPD exige. Duplicar isso em
    // `user_auth_audit_logs` com um `AuthAuditAction` emprestado gravaria um
    // evento de autenticacao que nao aconteceu.
    await stores.consents.append(scope, plan.value);
  });

  return ok({ recorded: true as const });
}

/**
 * GATE DE FINALIDADE — a pergunta que o resto do produto faz antes de gravar
 * qualquer coisa opcional.
 *
 * Fail-closed em tres camadas: ausencia de registro, revogacao e versao
 * divergente devolvem `false` (`isConsentActive`). Conta nao-operacional
 * tambem devolve `false` — uma conta em encerramento nao alimenta tracking.
 */
export async function hasActiveConsent(
  deps: AuthRuntimeDeps,
  userId: bigint,
  kind: ConsentKind,
): Promise<boolean> {
  const versao = currentPolicyVersion(deps, kind);
  return deps.runInTransaction(async (scope, stores) => {
    const registros = await stores.consents.listByUserAndKind(scope, { userId, kind });
    const vigente = currentConsent(registros, kind);
    return vigente !== null && vigente.granted && vigente.policyVersion === versao;
  });
}

// ---------------------------------------------------------------------------
// Exportacao
// ---------------------------------------------------------------------------

function toDataRequestDto(row: {
  readonly kind: "export" | "deletion";
  readonly status: "pending" | "processing" | "completed" | "rejected" | "cancelled";
  readonly requestedAt: Date;
  readonly processedAt: Date | null;
}): DataRequestDto {
  return {
    kind: row.kind,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    processedAt: row.processedAt === null ? null : row.processedAt.toISOString(),
  };
}

/**
 * Registra o pedido de exportacao e ENTREGA os dados na mesma requisicao.
 *
 * Sincrono de proposito: o volume de UM titular e pequeno (perfil, listas,
 * notas, consentimentos) e um pipeline assincrono exigiria outbox, storage de
 * arquivo, token de download e expurgo — quatro pecas novas que esta unidade
 * nao cria. O pedido continua registrado em `user_data_requests`, entao a
 * trilha de auditoria existe do mesmo jeito e a migracao para assincrono
 * depois nao muda o contrato publico.
 *
 * IDEMPOTENCIA: `decideExportRequest` recusa quando ha pedido ATIVO. Combinado
 * ao throttle, isso impede que recarregar a pagina gere carga infinita.
 */
export async function requestDataExport(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  context: AuthRequestContext,
): Promise<DomainResult<DataExportDto>> {
  const now = deps.now();

  let resultado: DomainResult<DataExportDto>;
  try {
    resultado = await deps.runInTransaction<DomainResult<DataExportDto>>(
      async (scope, stores) => {
        const budget = await consumeAuthRequestBudget({
          throttles: stores.throttles,
          scope,
          purpose: "data_export",
          // Chave = userId, NAO o e-mail: a sessao ja identifica o titular, e
          // gravar o e-mail em `user_auth_throttles.key` poria PII numa coluna
          // que este fluxo nao precisa que a carregue.
          emailNormalized: String(authenticated.userId),
          clientIpHash: context.clientIpHash,
          now,
        });
        if (budget.locked) {
          return err<DataExportDto>(
            "rate_limited",
            "muitos pedidos de exportacao. Tente novamente mais tarde.",
          );
        }

        const anterior = await stores.dataRequests.findLatestByKind(scope, {
          userId: authenticated.userId,
          kind: "export",
        });
        const decisao = decideExportRequest({
          existingRequestStatus:
            anterior.kind === "found" && isRequestActive(anterior.request.status)
              ? anterior.request.status
              : null,
        });
        if (!decisao.ok) {
          return err<DataExportDto>(decisao.error.code, decisao.error.message);
        }

        const criado = await stores.dataRequests.create(scope, {
          userId: authenticated.userId,
          kind: "export",
          status: "pending",
          requestedAt: now,
        });
        if (criado.kind !== "created") {
          throw new AuthTransactionAbort("data_request_conflict");
        }

        const projecao = await stores.exportReader.project(scope, authenticated.userId);
        if (projecao.kind !== "found") {
          throw new AuthTransactionAbort("export_projection_missing");
        }
        const p = projecao.projection;
        const plano = buildExportPlan({ now });

        const dto: DataExportDto = {
          format: "cinerie.export.v1",
          generatedAt: now.toISOString(),
          manifest: buildExportManifest().map((entry) => ({
            category: entry.category,
            included: entry.included,
            reason: entry.reason,
          })),
          account: {
            email: p.accountCore.email,
            status: p.accountCore.status,
            emailVerifiedAt: p.accountCore.emailVerifiedAt?.toISOString() ?? null,
            createdAt: p.accountCore.createdAt.toISOString(),
          },
          profile:
            p.profile === null
              ? null
              : {
                  displayName: p.profile.displayName,
                  handle: p.profile.handle,
                  bio: p.profile.bio,
                  locale: p.profile.locale,
                  countryCode: p.profile.countryCode,
                  timezone: p.profile.timezone,
                  visibility: p.profile.visibility,
                },
          consents: p.governanceConsents.map((c) => ({
            kind: c.kind,
            granted: c.granted,
            policyVersion: c.policyVersion,
            occurredAt: c.occurredAt.toISOString(),
          })),
          requests: p.governanceRequests.map(toDataRequestDto),
          content: p.productContent,
          stats: p.productStats,
        };

        // REDE DE SEGURANCA, nao a unica defesa. A exclusao estrutural ja
        // aconteceu no tipo do executor (que nao alcanca credencial, sessao,
        // token nem auditoria); esta varredura pega o caso em que alguem
        // acrescentar um campo mal nomeado a projecao.
        const semSegredo = assertExportContainsNoSecrets(dto);
        if (!semSegredo.ok) {
          // Falha FECHADA: nao entrega nada. Um export que vazasse hash seria
          // pior do que um export que falhou.
          throw new AuthTransactionAbort("export_contains_secrets");
        }

        // Conclui o pedido no MESMO commit em que os dados sao montados: se a
        // entrega falhar depois, o registro conta a verdade do que aconteceu.
        const concluido = await stores.dataRequests.transition(scope, {
          id: criado.request.id,
          expectedStatus: "pending",
          nextStatus: "completed",
          processedAt: now,
          // NUNCA "system"/"agent": a coluna e para identidade HUMANA. Uma
          // conclusao automatica deixa o campo nulo.
          processedBy: null,
        });
        if (concluido.kind !== "updated") {
          throw new AuthTransactionAbort("data_request_transition_failed");
        }

        await stores.audit.append(scope, {
          userId: authenticated.userId,
          sessionId: authenticated.sessionId,
          action: "data_export_completed",
          ipHash: context.clientIpHash,
          userAgent: context.userAgent,
          detail: { categories: plano.includedCategories.length },
          occurredAt: now,
        });

        return ok(dto);
      },
    );
  } catch (error) {
    if (!isAuthTransactionAbort(error)) {
      throw error;
    }
    return err("conflict", "nao foi possivel gerar a exportacao agora.");
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Encerramento de conta
// ---------------------------------------------------------------------------

/**
 * Pede o ENCERRAMENTO da conta.
 *
 * Exige reautenticacao por senha. Coloca a conta em `pending_deletion`, revoga
 * TODAS as sessoes e abre uma janela de arrependimento — a anonimizacao
 * definitiva acontece depois dela, por operacao separada.
 *
 * A conta NAO e apagada: `users` guarda a linha como tumba (a FK `Restrict` de
 * `user_auth_audit_logs` recusaria o DELETE, e a prova de consentimento tem de
 * sobreviver por obrigacao legal).
 */
export async function requestAccountClosure(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  command: RequestClosureCommand,
  context: AuthRequestContext,
): Promise<DomainResult<{ readonly effectiveAt: string }>> {
  const now = deps.now();

  let resultado: DomainResult<{ readonly effectiveAt: string }>;
  try {
    resultado = await deps.runInTransaction(async (scope, stores) => {
      const budget = await consumeAuthRequestBudget({
        throttles: stores.throttles,
        scope,
        purpose: "account_closure",
        emailNormalized: String(authenticated.userId),
        clientIpHash: context.clientIpHash,
        now,
      });
      if (budget.locked) {
        return err<{ readonly effectiveAt: string }>(
          "rate_limited",
          "muitas tentativas. Tente novamente mais tarde.",
        );
      }

      // REAUTENTICACAO. Sessao sozinha nao encerra conta.
      const material = await stores.credentials.findForVerification(
        scope,
        authenticated.userId,
      );
      const confere =
        material.kind === "found" &&
        authenticatePassword({
          password: command.password,
          storedHash: material.material.passwordHash,
          verify: deps.verifyPassword,
        });
      if (!confere) {
        throw new AuthTransactionAbort("wrong_password");
      }

      // Idempotencia: um pedido de exclusao ATIVO bloqueia um segundo.
      const anterior = await stores.dataRequests.findLatestByKind(scope, {
        userId: authenticated.userId,
        kind: "deletion",
      });
      const decisao = decideDeletionRequest({
        currentStatus: authenticated.userStatus,
        hasActiveDeletionRequest:
          anterior.kind === "found" && isRequestActive(anterior.request.status),
      });
      if (!decisao.ok) {
        throw new AuthTransactionAbort("deletion_not_allowed");
      }

      const efetivoEm = computeEffectiveDeletionAt({
        requestedAt: now,
        graceDays: deps.deletionGraceDays,
      });

      const criado = await stores.dataRequests.create(scope, {
        userId: authenticated.userId,
        kind: "deletion",
        status: decisao.value.requestStatus,
        requestedAt: now,
      });
      if (criado.kind !== "created") {
        throw new AuthTransactionAbort("data_request_conflict");
      }

      const transicao = await stores.accountLifecycle.transitionStatus(scope, {
        userId: authenticated.userId,
        // Pre-imagem = o status que ESTA sessao observou. Fixar "active" aqui
        // seria repetir uma suposicao; o CAS deve comparar com o que foi lido.
        expectedStatus: authenticated.userStatus,
        nextStatus: decisao.value.nextStatus,
        // O CHECK do schema amarra status e carimbo: os dois viajam juntos.
        deletedAt: now,
      });
      if (transicao.kind !== "updated") {
        throw new AuthTransactionAbort("status_transition_failed");
      }

      // Evento sensivel: derruba TUDO, inclusive a sessao que pediu. Quem
      // cancelar o encerramento reautentica.
      const ativas = await stores.sessions.listActiveIds(scope, {
        userId: authenticated.userId,
        now,
      });
      const plano = planRevokeAllAfterSensitiveEvent({ activeSessionIds: ativas });
      await stores.sessions.revoke(scope, { sessionIds: plano.revokeSessionIds, now });

      await stores.audit.append(scope, {
        userId: authenticated.userId,
        sessionId: authenticated.sessionId,
        action: "deletion_requested",
        ipHash: context.clientIpHash,
        userAgent: context.userAgent,
        detail: { graceDays: deps.deletionGraceDays },
        occurredAt: now,
      });

      return ok({ effectiveAt: efetivoEm.toISOString() });
    });
  } catch (error) {
    if (!isAuthTransactionAbort(error)) {
      throw error;
    }
    // Mensagem UNICA: senha errada e conta ja em encerramento nao se
    // distinguem la fora.
    return err("unauthorized", "nao foi possivel encerrar a conta.");
  }

  return resultado;
}

/**
 * CANCELA o encerramento dentro da janela de arrependimento.
 *
 * NAO E ENDPOINT DO TITULAR, e a razao e uma consequencia direta do dominio —
 * nao uma escolha de conveniencia:
 *
 *   `SESSION_ELIGIBLE_STATUSES` (auth/types.ts) e `["active"]`. Assim que o
 *   encerramento leva a conta a `pending_deletion`, `accountCanHoldSession`
 *   passa a recusar, e nem `evaluateSessionAccess` nem `decideLogin` deixam
 *   essa conta autenticar. Logo NAO EXISTE `AuthenticatedContext` possivel para
 *   uma conta em encerramento, e um endpoint autenticado de cancelamento seria
 *   codigo inalcancavel — o pior tipo de falsa garantia: aparece na
 *   documentacao, passa no typecheck e nunca roda.
 *
 * A alternativa seria relaxar `accountCanHoldSession` para aceitar
 * `pending_deletion`. Isso e recusado de proposito: bloquear novos logins e
 * exatamente o que protege uma conta cuja sessao foi roubada, e e o
 * comportamento que o pedido de encerramento existe para produzir.
 *
 * O arrependimento continua existindo — como operacao ASSISTIDA, com identidade
 * humana registrada em `processed_by` e runbook proprio
 * (docs/runbooks/user-identity-privacy.md). A janela de carencia continua sendo
 * a trava: fora dela, `decideDeletionCancel` recusa.
 */
export async function cancelAccountClosure(
  deps: AuthRuntimeDeps,
  authenticated: { readonly userId: bigint; readonly userStatus: UserStatus },
  operator: string,
): Promise<DomainResult<{ readonly cancelled: true }>> {
  const now = deps.now();

  return deps.runInTransaction(async (scope, stores) => {
    // A janela de arrependimento se conta a partir do PEDIDO, nao de agora —
    // por isso o pedido e lido antes da decisao.
    const pedidoAtual = await stores.dataRequests.findLatestByKind(scope, {
      userId: authenticated.userId,
      kind: "deletion",
    });
    if (pedidoAtual.kind !== "found") {
      return err<{ readonly cancelled: true }>(
        "precondition_failed",
        "nao ha encerramento em andamento.",
      );
    }

    const decisao = decideDeletionCancel({
      currentStatus: authenticated.userStatus,
      requestedAt: pedidoAtual.request.requestedAt,
      now,
      graceDays: deps.deletionGraceDays,
    });
    if (!decisao.ok) {
      return err<{ readonly cancelled: true }>(decisao.error.code, decisao.error.message);
    }

    const transicao = await stores.accountLifecycle.transitionStatus(scope, {
      userId: authenticated.userId,
      expectedStatus: "pending_deletion",
      nextStatus: decisao.value.nextStatus,
      // Volta a `null`: o CHECK exige coerencia entre status e carimbo.
      deletedAt: null,
    });
    if (transicao.kind !== "updated") {
      return err<{ readonly cancelled: true }>(
        "conflict",
        "nao foi possivel cancelar o encerramento.",
      );
    }

    const pedido = await stores.dataRequests.findLatestByKind(scope, {
      userId: authenticated.userId,
      kind: "deletion",
    });
    if (pedido.kind === "found" && isRequestActive(pedido.request.status)) {
      await stores.dataRequests.transition(scope, {
        id: pedido.request.id,
        expectedStatus: pedido.request.status,
        nextStatus: "cancelled",
        processedAt: now,
        // Identidade HUMANA de quem atendeu o arrependimento — a coluna existe
        // para isso e o schema proibe "system"/"agent".
        processedBy: operator,
      });
    }

    await stores.audit.append(scope, {
      userId: authenticated.userId,
      sessionId: null,
      action: "deletion_cancelled",
      ipHash: null,
      userAgent: null,
      detail: { operator },
      occurredAt: now,
    });

    return ok({ cancelled: true as const });
  });
}

/**
 * ANONIMIZACAO definitiva, apos a janela de arrependimento.
 *
 * NAO e exposta como endpoint publico: e operacao de manutencao, chamada por
 * runbook/CLI com decisao humana registrada. Expo-la ao titular daria um botao
 * que apaga dado imediatamente, sem a janela que existe exatamente para
 * proteger de arrependimento e de sessao roubada.
 */
export async function anonymizeAccount(
  deps: AuthRuntimeDeps,
  userId: bigint,
  operator: string,
): Promise<DomainResult<{ readonly anonymized: true }>> {
  const now = deps.now();

  return deps.runInTransaction(async (scope, stores) => {
    const identidade = await stores.identities.findById(scope, userId);
    if (identidade.kind !== "found") {
      return err<{ readonly anonymized: true }>("not_found", "conta nao encontrada.");
    }

    // PRE-CONDICAO explicita: so `pending_deletion` anonimiza. O adapter repete
    // essa checagem no WHERE (defesa em profundidade), mas recusar aqui produz
    // a mensagem certa em vez de um `conflict` generico.
    if (identidade.identity.status !== "pending_deletion") {
      return err<{ readonly anonymized: true }>(
        "precondition_failed",
        "conta nao esta elegivel a anonimizacao.",
      );
    }

    const consentimentos = await stores.consents.listByUser(scope, userId);
    const vigentes = CONSENT_KINDS.filter((kind) => {
      const atual = currentConsent(consentimentos, kind);
      return atual !== null && atual.granted;
    });

    // `buildDeletionPlan` devolve o plano DIRETO (nao um DomainResult): ele nao
    // decide elegibilidade — isso ja foi decidido acima.
    const plano = buildDeletionPlan({
      userId,
      activeConsentKinds: vigentes,
      effectiveAt: now,
    });

    const aplicado = await stores.accountLifecycle.anonymize(scope, {
      userId,
      // Os placeholders vem do DOMINIO (`deleted-<id>@anonymized.invalid`), nao
      // do adapter: so ele sabe qual forma preserva a unicidade das colunas.
      anonymizedEmail: plano.accountAnonymization.email,
      anonymizedEmailNormalized: plano.accountAnonymization.emailNormalized,
      anonymizedAt: now,
    });
    if (aplicado.kind !== "anonymized") {
      return err<{ readonly anonymized: true }>("conflict", "anonimizacao nao aplicada.");
    }

    // C8 — EXECUCAO DA RETENCAO, no MESMO commit da anonimizacao.
    //
    // `DATA_CLASSIFICATION.product_content` prescreve `retentionAction:"delete"`
    // desde o C3, e `buildDeletionPlan` devolve esse plano — mas ate o C8 nao
    // existia store algum de conteudo de produto, entao a politica era decidida
    // e nunca executada: a conta virava tumba e listas, tracking, diario, notas
    // e importacoes continuavam intactos.
    //
    // Fazer isso aqui dentro (e nao numa segunda transacao) fecha a janela em
    // que a conta ja esta anonimizada e a biblioteca ainda existe.
    //
    // O que NAO e apagado, pela MESMA politica: consentimento e pedidos LGPD
    // (`retain_indefinitely`, prova legal), auditoria (`retain_until`) e o
    // snapshot agregado de estatisticas (`aggregate_anonymous`).
    const purgado = await stores.productContentPurge.purgeForUser(scope, userId);

    const pedido = await stores.dataRequests.findLatestByKind(scope, {
      userId,
      kind: "deletion",
    });
    if (pedido.kind === "found" && isRequestActive(pedido.request.status)) {
      await stores.dataRequests.transition(scope, {
        id: pedido.request.id,
        expectedStatus: pedido.request.status,
        nextStatus: "completed",
        processedAt: now,
        // Identidade HUMANA do operador — o schema exige isso da coluna.
        processedBy: operator,
      });
    }

    await stores.audit.append(scope, {
      userId,
      sessionId: null,
      action: "account_anonymized",
      ipHash: null,
      userAgent: null,
      // Contagens do que a retencao apagou — prova operacional de que a
      // politica foi EXECUTADA, e nao apenas decidida. Sao numeros, nunca
      // conteudo: o detalhe da auditoria continua sem PII.
      detail: {
        operator,
        purgedWatchStates: purgado.watchStates,
        purgedEpisodeProgress: purgado.episodeProgress,
        purgedViewingEvents: purgado.viewingEvents,
        purgedListItems: purgado.listItems,
        purgedLists: purgado.lists,
        purgedRatings: purgado.ratings,
        purgedImportJobs: purgado.importJobs,
      },
      occurredAt: now,
    });

    return ok({ anonymized: true as const });
  });
}
