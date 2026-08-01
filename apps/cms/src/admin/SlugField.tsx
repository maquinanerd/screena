'use client'

/**
 * SlugField — a slug deixa de ser digitada a mao.
 *
 * A geracao JA EXISTIA no repositorio, mas so no caminho da autopublicacao
 * (`canonical-slug.ts`, usado por `endpoints/editorial-publications.ts`). Quem
 * escrevia pelo painel inventava a propria — com acento, maiuscula ou espaco, ate
 * a projecao reclamar. Este campo usa A MESMA funcao: mesma normalizacao, mesmos
 * limites, mesma lista de reservadas.
 *
 * As duas regras que impedem o automatico de atrapalhar:
 *  1. so preenche enquanto a slug estiver VAZIA — texto que uma pessoa escreveu
 *     nao e sobrescrito por digitacao no titulo;
 *  2. assim que o campo e editado a mao, o acompanhamento para de vez (ate o
 *     botao "regenerar" ser clicado de proposito).
 *
 * O aviso de slug repetida e AVISO: nao bloqueia, nao escreve. A unicidade real
 * e do par (idioma, slug) e continua sendo decidida do lado publico.
 */

import { FieldLabel, TextInput, useConfig, useDocumentInfo, useField, useFormFields } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { canonicalizeSlug, SLUG_LIMITS } from '../canonical-slug.js'
import { apiBase, slugIsTaken } from './admin-rest.js'

/** Motivo da recusa, em portugues. */
const REJECTION_MESSAGES = {
  empty_after_normalization: 'O título não produz um endereço válido — escreva um slug à mão.',
  reserved: 'Este endereço é reservado pelo site. Escolha outro.',
  too_short: `O endereço precisa de pelo menos ${String(SLUG_LIMITS.minLength)} caracteres.`,
} as const

export const SlugField: TextFieldClientComponent = ({ field, path, readOnly }) => {
  const { value, setValue } = useField<string>({ path })
  const { id } = useDocumentInfo()
  const { config } = useConfig()

  // Assinatura dos dois campos de origem. `useFormFields` com seletor evita
  // re-render a cada tecla digitada em qualquer outro campo do formulario.
  const title = useFormFields(([fields]) => (fields.title?.value as string | undefined) ?? '')
  const language = useFormFields(
    ([fields]) => (fields.language?.value as string | undefined) ?? 'pt-BR',
  )

  const [problem, setProblem] = useState<string | null>(null)
  const [taken, setTaken] = useState(false)

  /**
   * O acompanhamento automatico ainda esta ligado?
   *
   * Comeca ligado somente em documento SEM slug. Reabrir uma materia que ja tem
   * endereco nao pode religar o automatico: um ajuste no titulo mudaria a URL de
   * algo possivelmente ja publicado.
   */
  const following = useRef((value ?? '') === '')

  const applyFromTitle = useCallback(
    (source: string, { manual }: { manual: boolean }): void => {
      const result = canonicalizeSlug(source)
      if (!result.ok) {
        // So reclama quando a pessoa PEDIU a geracao. Enquanto o titulo esta
        // sendo digitado, "ainda nao da para gerar" e ruido, nao erro.
        setProblem(manual ? REJECTION_MESSAGES[result.reason] : null)
        return
      }
      setProblem(null)
      setValue(result.slug)
    },
    [setValue],
  )

  useEffect(() => {
    if (readOnly === true) return
    if (!following.current) return
    if (title.trim() === '') return
    applyFromTitle(title, { manual: false })
  }, [title, applyFromTitle, readOnly])

  /* --- Aviso de colisao --------------------------------------------- */
  useEffect(() => {
    const current = (value ?? '').trim()
    if (current === '') {
      setTaken(false)
      return
    }
    const controller = new AbortController()
    // Espera a digitacao assentar: uma consulta por tecla castigaria o banco e
    // pintaria o aviso enquanto a palavra ainda esta pela metade.
    const timer = setTimeout(() => {
      slugIsTaken(
        apiBase(config.routes),
        { slug: current, language, selfId: id === undefined || id === null ? null : String(id) },
        controller.signal,
      )
        .then(setTaken)
        // Falha de leitura nao vira acusacao de colisao.
        .catch(() => undefined)
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value, language, id, config.routes])

  const onManualChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      // Editou a mao: o automatico sai de cena e nao volta sozinho.
      following.current = false
      setProblem(null)
      setValue(event.target.value)
    },
    [setValue],
  )

  const regenerate = useCallback((): void => {
    following.current = true
    applyFromTitle(title, { manual: true })
  }, [applyFromTitle, title])

  return (
    <div className="cinerie-slug field-type text">
      <div className="cinerie-slug__header">
        <FieldLabel label={field?.label ?? 'Slug'} path={path} />
        {readOnly === true ? null : (
          <button
            className="cinerie-slug__regenerate"
            disabled={title.trim() === ''}
            onClick={regenerate}
            type="button"
          >
            Regenerar do título
          </button>
        )}
      </div>

      <TextInput
        onChange={onManualChange}
        path={path}
        readOnly={readOnly}
        value={value ?? ''}
      />

      <p className="cinerie-slug__preview">
        {(value ?? '').trim() === ''
          ? 'O endereço da matéria é gerado a partir do título.'
          : `/pt/noticias/${value}/`}
      </p>

      {problem !== null ? (
        <p className="cinerie-slug__problem" role="alert">
          {problem}
        </p>
      ) : null}

      {taken ? (
        <p className="cinerie-slug__problem" role="status">
          Já existe outra matéria com este endereço em {language}. Ajuste antes de publicar.
        </p>
      ) : null}
    </div>
  )
}

export default SlugField
