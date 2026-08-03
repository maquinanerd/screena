'use client'

/**
 * QaApprovalField — o QA deixa de ser uma data digitada a mao.
 *
 * `qaPassedAt` e campo de GOVERNANCA: o gate de publicacao exige que ele exista
 * (`hooks/articles.ts`). Ate aqui o painel pedia uma data crua, o que convidava
 * a preencher qualquer coisa para destravar a publicacao — no E2E ele e
 * preenchido na unha, o que e um sintoma, nao um teste.
 *
 * Este componente NAO preenche sozinho e NAO afrouxa nada: troca o seletor de
 * data por um ato explicito ("Marcar QA como aprovado") que carimba o instante
 * do clique. O que a redacao ganha e a pergunta certa na tela — "isto foi
 * verificado?" em vez de "que data eu ponho aqui?".
 *
 * QUEM marcou: nao existe coluna `qaPassedBy` no schema, e criar uma seria
 * mudanca de schema (fora do escopo desta camada). O registro duravel de quem
 * carimbou e o `updatedBy` do proprio artigo, derivado da sessao pelo servidor
 * no mesmo save. A tela diz isso em voz alta, em vez de fingir um autor.
 *
 * NAO HA CHECKLIST DE QA documentado no repositorio — `docs/operations/
 * manual-editorial-workflow.md` descreve o gate, nao um roteiro de verificacao.
 * Entao a lista ao lado mostra os fatos VERIFICAVEIS do proprio documento, e
 * nao itens inventados.
 */

import { useAuth, useField, useFormFields } from '@payloadcms/ui'
import type { DateFieldClientComponent } from 'payload'
import React, { useCallback, useMemo } from 'react'

function formatStamp(value: string | null): string | null {
  if (value === null || value.trim() === '') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

function displayName(user: unknown): string {
  if (user === null || typeof user !== 'object') return 'você'
  const candidate = user as { name?: unknown; email?: unknown }
  if (typeof candidate.name === 'string' && candidate.name.trim() !== '') return candidate.name
  if (typeof candidate.email === 'string' && candidate.email.trim() !== '') return candidate.email
  return 'você'
}

/** Um fato que o gate confere e que a redacao consegue conferir junto. */
interface QaFact {
  readonly label: string
  readonly ok: boolean
  readonly detail: string
}

export const QaApprovalField: DateFieldClientComponent = ({ path, readOnly }) => {
  const { value, setValue } = useField<string>({ path })
  const { user } = useAuth()

  const sources = useFormFields(([fields]) => {
    const raw = fields.externalSources?.rows
    return Array.isArray(raw) ? raw.length : 0
  })
  const blocking = useFormFields(([fields]) => {
    const raw = fields.blockingErrors?.value
    return Array.isArray(raw) ? raw.length : 0
  })
  const aiAssisted = useFormFields(([fields]) => fields.aiAssisted?.value === true)

  const facts = useMemo<readonly QaFact[]>(
    () => [
      {
        label: 'Fontes externas declaradas',
        ok: sources > 0,
        detail:
          sources > 0
            ? `${String(sources)} fonte(s) na aba Fontes e QA`
            : 'nenhuma fonte declarada',
      },
      {
        label: 'Erros bloqueantes',
        ok: blocking === 0,
        detail: blocking === 0 ? 'nenhum' : `${String(blocking)} pendente(s)`,
      },
      {
        label: 'Lastro de conteúdo assistido por IA',
        ok: !aiAssisted || sources > 0,
        detail: aiAssisted
          ? sources > 0
            ? 'marcada como assistida por IA, com fonte'
            : 'marcada como assistida por IA e SEM fonte — o gate vai recusar'
          : 'não marcada como assistida por IA',
      },
    ],
    [sources, blocking, aiAssisted],
  )

  const stamped = formatStamp(value ?? null)

  const approve = useCallback((): void => {
    setValue(new Date().toISOString())
  }, [setValue])

  const revoke = useCallback((): void => {
    setValue(null)
  }, [setValue])

  return (
    <div className="cinerie-qa field-type">
      <div className="cinerie-qa__header">
        <span className="cinerie-qa__title">Controle de qualidade</span>
        <span className={`cinerie-qa__state is-${stamped === null ? 'pending' : 'done'}`}>
          {stamped === null ? 'não aprovado' : `aprovado em ${stamped}`}
        </span>
      </div>

      <ul className="cinerie-qa__facts">
        {facts.map((fact) => (
          <li className={fact.ok ? 'is-ok' : 'is-pending'} key={fact.label}>
            <span className="cinerie-qa__fact-mark" aria-hidden="true">
              {fact.ok ? '✓' : '!'}
            </span>
            <span>
              <strong>{fact.label}</strong>
              <small>{fact.detail}</small>
            </span>
          </li>
        ))}
      </ul>

      {readOnly === true ? null : (
        <div className="cinerie-qa__actions">
          {stamped === null ? (
            <button className="cinerie-qa__approve" onClick={approve} type="button">
              Marcar QA como aprovado
            </button>
          ) : (
            <button className="cinerie-qa__revoke" onClick={revoke} type="button">
              Revogar aprovação
            </button>
          )}
          <small className="cinerie-qa__note">
            {stamped === null
              ? `Será registrado como aprovado por ${displayName(user)} no momento do salvamento.`
              : 'Quem aprovou fica registrado em "atualizado por", na aba Publicacao.'}
          </small>
        </div>
      )}
    </div>
  )
}

export default QaApprovalField
