'use client'

/**
 * WorkflowTransitionBar — o caminho que o painel nao tinha.
 *
 * SUBSTITUI o botao nativo "Publish changes" (`admin.components.edit.
 * PublishButton`). Aquele botao manda `_status: 'published'` solto, e o hook de
 * governanca recusa com 403 — CORRETAMENTE, porque a decisao de publicar mora em
 * `workflowStatus` e so vem de `ready_to_publish`. A trava nao muda aqui. O que
 * muda e a interface parar de oferecer um caminho que nao existe e passar a
 * oferecer os que existem.
 *
 * Antes: o redator descobria sozinho que precisava operar um `select` e salvar
 * cinco vezes seguidas (draft -> needs_review -> in_review -> human_reviewed ->
 * ready_to_publish -> published).
 *
 * NENHUMA REGRA DE SERVIDOR E TOCADA:
 *  - as transicoes oferecidas sao DERIVADAS de `canTransition` (fonte unica);
 *  - a acao e o mesmo `submit()` do formulario, com `workflowStatus` como
 *    override — identico ao que a pessoa faria a mao;
 *  - o gate e apenas ANTECIPADO na tela; quem decide continua sendo o hook.
 */

import { useAuth, useConfig, useDocumentInfo, useForm, useAllFormFields } from '@payloadcms/ui'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ActorKind, WorkflowStatus } from '../workflow.js'
import { WORKFLOW_STATUSES } from '../workflow.js'
import { blocksForOneClickPublish, planPublishPath } from '../publish-path.js'
import {
  explainServerRejection,
  PUBLISH_BLOCK_EXPLANATIONS,
  STATUS_HINTS,
  STATUS_LABELS,
  STATUS_TONES,
  transitionsFrom,
  waitingForLabel,
  type PublishBlockExplanation,
} from './editorial-vocabulary.js'
import {
  previewPublishGate,
  referencedMediaIds,
  relationIds,
  type AuthorFacts,
  type MediaFacts,
} from './publish-gate-preview.js'
import { apiBase, fetchAuthorFacts, fetchMediaFacts } from './admin-rest.js'

/** Papel do usuario logado, no vocabulario das regras puras. */
function actorKindOf(user: unknown): ActorKind | null {
  if (user === null || typeof user !== 'object') return null
  const role = (user as { role?: unknown }).role
  return typeof role === 'string' ? (role as ActorKind) : null
}

function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === 'string' && (WORKFLOW_STATUSES as readonly string[]).includes(value)
}

/**
 * Leva o foco para a aba onde o problema se resolve.
 *
 * As abas de `articles` sao SEM NOME (aba nomeada aninharia o caminho de
 * armazenamento e exigiria migration), entao nao ha id nem rota: o rotulo
 * visivel e a unica ancora. Se o Payload mudar a marcacao, a funcao nao acha o
 * botao e nao faz nada — e a frase continua dizendo o nome da aba. Degradar para
 * texto e aceitavel; quebrar a tela nao.
 */
function focusTab(label: string): void {
  if (typeof document === 'undefined') return
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('.tabs-field__tab-button'))
  const target = buttons.find((button) => button.textContent?.trim() === label)
  target?.click()
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export default function WorkflowTransitionBar(): React.ReactElement | null {
  const { id, savedDocumentData } = useDocumentInfo()
  const { user } = useAuth()
  const { config } = useConfig()
  const { getData, submit } = useForm()
  const [fields] = useAllFormFields()

  const [pending, setPending] = useState<WorkflowStatus | null>(null)
  const [serverBlocks, setServerBlocks] = useState<readonly PublishBlockExplanation[]>([])
  const [serverError, setServerError] = useState<string | null>(null)
  const [authors, setAuthors] = useState<readonly AuthorFacts[]>([])
  const [media, setMedia] = useState<readonly MediaFacts[]>([])

  const base = apiBase(config.routes)

  /**
   * O documento como o formulario o conhece AGORA.
   *
   * `getData()` reconstroi a forma aninhada (os blocos do corpo chegam achatados
   * em `body.0.media` no estado do formulario); ler `fields` direto perderia as
   * imagens do corpo, e o gate as conta.
   */
  const doc = useMemo(() => getData(), [fields, getData])

  /* --- Estado SALVO, nao o do formulario ---------------------------- */
  //
  // O servidor avalia a transicao contra o documento no banco (`originalDoc`).
  // Ler `workflowStatus` do formulario ofereceria transicoes a partir de um
  // estado que ainda nao existe — e o servidor recusaria o botao que a tela
  // acabou de oferecer.
  const rawStatus: unknown = savedDocumentData?.workflowStatus
  const savedStatus: WorkflowStatus = isWorkflowStatus(rawStatus) ? rawStatus : 'draft'

  const actor = actorKindOf(user)

  /* --- Fatos das relacoes, para antecipar o gate -------------------- */
  const authorIds = relationIds(doc.authors).join(',')
  const mediaIds = referencedMediaIds(doc).join(',')

  useEffect(() => {
    const controller = new AbortController()
    const ids = authorIds === '' ? [] : authorIds.split(',')
    fetchAuthorFacts(base, ids, controller.signal)
      .then(setAuthors)
      // Falha de leitura NAO vira bloqueio inventado: a previsao fica menos
      // informada e o servidor continua sendo quem decide.
      .catch(() => undefined)
    return () => { controller.abort() }
  }, [authorIds, base])

  useEffect(() => {
    const controller = new AbortController()
    const ids = mediaIds === '' ? [] : mediaIds.split(',')
    fetchMediaFacts(base, ids, controller.signal)
      .then(setMedia)
      .catch(() => undefined)
    return () => { controller.abort() }
  }, [mediaIds, base])

  const gate = useMemo(
    () => previewPublishGate({ doc, authors, media, currentStatus: savedStatus }),
    [doc, authors, media, savedStatus],
  )

  const options = useMemo(
    () => (actor === null ? [] : transitionsFrom(savedStatus, actor)),
    [savedStatus, actor],
  )

  /* --- Publicar em um clique ---------------------------------------- */
  //
  // O plano e calculado aqui so para DECIDIR A TELA: se ha caminho, quantos
  // degraus, e como rotular o botao. Quem executa e o servidor, que recalcula
  // o mesmo plano — a tela nunca manda a lista de degraus, porque um cliente
  // que dita a escada e um cliente que pode pular degrau.
  //
  // O botao so aparece com MAIS DE UM degrau pela frente. Com um degrau so, a
  // transicao granular ja E um clique e ja se chama "Publicar" — dois botoes
  // com o mesmo nome na mesma barra confundem quem le a tela e quebraram o
  // E2E por ambiguidade de seletor. A condicao elimina a colisao por
  // construcao, em vez de renomear um dos dois para disfarcar.
  const publishPlan = useMemo(
    () => (actor === null ? null : planPublishPath(savedStatus, actor)),
    [savedStatus, actor],
  )

  /*
   * O gate de previsao julga o estado ATUAL, entao de `draft` ele sempre
   * devolve `not_ready_to_publish` — e essa e justamente a condicao que este
   * botao existe para resolver, subindo a escada. Manter o motivo aqui deixava
   * o botao permanentemente desabilitado no unico lugar onde ele serve.
   *
   * O servidor faz a MESMA coisa por outro caminho: no pre-voo ele pergunta ao
   * gate com `ready_to_publish` no lugar do estado atual. Aqui o equivalente e
   * descartar esse unico motivo. Os demais bloqueios continuam valendo — sem
   * autor ativo, sem QA, com midia sem licenca, o botao segue desabilitado,
   * porque subir a escada nao resolveria nenhum deles.
   */
  const oneClickBlocks = useMemo(() => blocksForOneClickPublish(gate.reasons), [gate.reasons])

  const publishNow = useCallback(async (): Promise<void> => {
    if (id === undefined || id === null) return
    setPending('published')
    setServerBlocks([])
    setServerError(null)
    try {
      const response = await fetch(`${base}/internal/publish-now`, {
        body: JSON.stringify({ id: String(id) }),
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const payload = (await response.json()) as {
        error?: string
        reasons?: readonly string[]
        message?: string
        stoppedAt?: string
      }

      if (response.ok) {
        // Recarrega para a tela refletir o documento PRINCIPAL, nao o rascunho
        // que o autosave deixou em memoria.
        window.location.reload()
        return
      }

      if (payload.error === 'blocked' && Array.isArray(payload.reasons)) {
        // Traducao pela fonte unica: o servidor devolve codigo, o vocabulario
        // editorial devolve a frase em portugues e a aba onde se resolve.
        setServerBlocks(
          payload.reasons
            .map((reason) => PUBLISH_BLOCK_EXPLANATIONS[reason as keyof typeof PUBLISH_BLOCK_EXPLANATIONS])
            .filter((explanation): explanation is PublishBlockExplanation => explanation !== undefined),
        )
      } else if (payload.error === 'transition_failed') {
        setServerError(
          `A subida parou em "${STATUS_LABELS[(payload.stoppedAt ?? savedStatus) as WorkflowStatus] ?? String(payload.stoppedAt)}". ${payload.message ?? ''}`.trim(),
        )
      } else {
        setServerError(payload.message ?? 'Nao foi possivel publicar agora.')
      }
    } catch {
      setServerError('Nao foi possivel falar com o servidor. A materia nao mudou de estado.')
    } finally {
      setPending(null)
    }
  }, [base, id, savedStatus])

  /* --- A acao: o mesmo save, com o estado certo --------------------- */
  const previousStatus = useRef(savedStatus)
  useEffect(() => {
    // Transicao concluida: a tela ja mostra o estado novo, entao a recusa
    // anterior deixou de descrever a realidade.
    if (previousStatus.current !== savedStatus) {
      previousStatus.current = savedStatus
      setServerBlocks([])
      setServerError(null)
    }
  }, [savedStatus])

  const transition = useCallback(
    async (to: WorkflowStatus): Promise<void> => {
      if (id === undefined || id === null) return
      setPending(to)
      setServerBlocks([])
      setServerError(null)
      try {
        // ACTION EXPLICITA, SEM `draft=true`.
        //
        // A collection declara `versions.drafts.autosave`, e nesse arranjo a
        // action padrao do formulario aponta para o salvamento de RASCUNHO.
        // Submeter por ela gravaria a transicao na tabela de VERSOES: o hook
        // rodaria, mas o documento principal continuaria no estado antigo — a
        // barra mostraria sucesso e nada teria mudado de verdade.
        //
        // O botao nativo de publicar resolve isso do mesmo jeito (monta a
        // action sem `draft` e so entao submete). Aqui a URL e relativa: mesma
        // origem, mesmo cookie de sessao.
        const action = `${base}/articles/${String(id)}?depth=0`
        // `overrides` entra por cima do estado atual do formulario: o texto que a
        // pessoa acabou de digitar viaja junto, como viajaria num save comum.
        const result = await submit({ action, overrides: { workflowStatus: to } })
        const response = (result as { res?: Response } | void)?.res
        if (response !== undefined && !response.ok) {
          const raw = await response.text()
          const explained = explainServerRejection(raw)
          if (explained !== null) setServerBlocks(explained)
          else setServerError('Não foi possível concluir a mudança de estado.')
        }
      } catch {
        setServerError('Não foi possível concluir a mudança de estado.')
      } finally {
        setPending(null)
      }
    },
    [submit, base, id],
  )

  // Documento novo ainda sem id: nao ha transicao possivel antes do primeiro
  // autosave, e o Payload ja mostra o proprio estado de criacao.
  if (id === undefined || id === null) return null
  if (actor === null) return null

  const blocks = serverBlocks.length > 0
    ? serverBlocks
    : gate.reasons.map((reason) => PUBLISH_BLOCK_EXPLANATIONS[reason])

  return (
    <section className="cinerie-workflow" aria-label="Fluxo editorial da matéria">
      <header className="cinerie-workflow__state">
        <span
          className={`cinerie-workflow__badge is-${STATUS_TONES[savedStatus]}`}
          data-status={savedStatus}
        >
          {STATUS_LABELS[savedStatus]}
        </span>
        <p className="cinerie-workflow__hint">{STATUS_HINTS[savedStatus]}</p>
      </header>

      <div className="cinerie-workflow__actions">
        {/*
          O ATALHO DE CLIQUE, NAO DE GOVERNANCA.
          Aparece so quando ha caminho para ESTE papel. Um editor ve os degraus
          normais e nao ve este botao — nao porque a tela o esconda por gosto,
          mas porque `planPublishPath` devolve `forbidden_for_role` para quem
          nao publica. A regra continua sendo a mesma do servidor.
        */}
        {publishPlan !== null && publishPlan.ok && publishPlan.path.length > 1 ? (
          <button
            className="cinerie-workflow__action is-publish-now"
            disabled={pending !== null || oneClickBlocks.length > 0}
            onClick={() => { void publishNow() }}
            title={
              oneClickBlocks.length === 0
                ? `Percorre ${String(publishPlan.path.length)} transições registradas uma a uma.`
                : 'Resolva os pendentes abaixo para publicar'
            }
            type="button"
          >
            {pending === 'published' ? 'Publicando…' : 'Publicar'}
          </button>
        ) : null}

        {options.map((option) => {
          const publishing = option.to === 'published'
          const blockedByGate = publishing && !gate.canPublish
          const disabled = !option.allowedForActor || blockedByGate || pending !== null

          if (!option.allowedForActor) {
            return (
              <span className="cinerie-workflow__waiting" key={option.to}>
                {option.label}: {waitingForLabel(option.allowedRoles)}
              </span>
            )
          }

          return (
            <button
              className={`cinerie-workflow__action is-${option.weight}`}
              disabled={disabled}
              key={option.to}
              onClick={() => { void transition(option.to) }}
              // O motivo do bloqueio nao pode viver so na cor de um botao
              // desabilitado: leitor de tela e daltonico ficariam sem a causa.
              title={blockedByGate ? 'Resolva os pendentes abaixo para publicar' : undefined}
              type="button"
            >
              {pending === option.to ? 'Salvando…' : option.label}
            </button>
          )
        })}
      </div>

      {blocks.length > 0 ? (
        <div className="cinerie-workflow__blocks" role="status">
          <strong>
            {serverBlocks.length > 0
              ? 'O servidor recusou a publicação:'
              : 'Para publicar, falta:'}
          </strong>
          <ul>
            {blocks.map((block) => (
              <li key={block.message}>
                {block.message}{' '}
                <button
                  className="cinerie-workflow__jump"
                  onClick={() => { focusTab(block.tab) }}
                  type="button"
                >
                  ir para a aba {block.tab}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {serverError !== null ? (
        <p className="cinerie-workflow__error" role="alert">
          {serverError}
        </p>
      ) : null}
    </section>
  )
}
