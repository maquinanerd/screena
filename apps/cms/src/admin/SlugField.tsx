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
 *
 * ---------------------------------------------------------------------------
 * CORRECAO DO LACO DE RENDER (React #185, "Maximum update depth exceeded").
 *
 * Como estava, o efeito chamava `setValue(...)` a CADA passagem, sem comparar
 * com a slug que ja estava no formulario. Uma escrita que nao muda nada nao e
 * inofensiva no Payload: `setValue` despacha `{type:'UPDATE'}` e chama
 * `setModified(true)` incondicionalmente (`@payloadcms/ui/dist/forms/useField/
 * index.js:87-101`). Cada despacho recria o objeto do campo no estado do
 * formulario, o que reidentifica `field` (`useField/index.js:44-56`), rearma o
 * efeito de validacao com throttle de 150ms (`useField/index.js:274`) e marca o
 * documento como modificado, que por sua vez rearma o autosave.
 *
 * Digitando devagar, cada ciclo desses drena antes da proxima tecla. Numa rajada
 * sustentada as passagens se empilham mais rapido do que o throttle e o autosave
 * escoam, e o React corta no seu teto de atualizacoes aninhadas.
 *
 * Duas travas, na raiz:
 *  1. PONTO FIXO — `decideSlugFromTitle` so devolve `write` quando a slug
 *     calculada DIFERE da atual. Sem diferenca, nenhum despacho acontece. Esta e
 *     a correcao de verdade, e e ela que tem teste.
 *  2. DEBOUNCE — a derivacao espera a digitacao assentar. Uma rajada de 70
 *     teclas passa a produzir UMA derivacao em vez de 70. E defesa em
 *     profundidade: a trava 1 ja fecha o laco sozinha.
 *
 * A geracao automatica continua ligada e com o mesmo comportamento visivel.
 */

import { FieldLabel, TextInput, useConfig, useDocumentInfo, useField, useFormFields } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { SLUG_LIMITS } from '../canonical-slug.js'
import { apiBase, slugIsTaken } from './admin-rest.js'
import { decideSlugFromTitle } from './slug-derivation.js'

/**
 * Quanto a derivacao espera a digitacao assentar.
 *
 * Curto o bastante para a slug parecer instantanea a quem escreve, longo o
 * bastante para uma frase digitada de enfiada virar uma derivacao so.
 */
const DERIVATION_DELAY_MS = 250

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

  /*
   * Derivacao automatica.
   *
   * `value` ESTA nas dependencias de proposito: depois de uma escrita o efeito
   * roda mais uma vez e a decisao volta `idle`, porque a slug ja e a calculada.
   * E o ponto fixo se fechando — duas passagens, nao infinitas. Sem a guarda de
   * `decideSlugFromTitle` esta mesma dependencia seria o laco.
   */
  useEffect(() => {
    if (readOnly === true) return undefined

    const timer = setTimeout(() => {
      const decision = decideSlugFromTitle({
        title,
        currentSlug: value ?? '',
        following: following.current,
        readOnly: false,
        // Digitando nao se reclama de titulo que ainda nao produz slug.
        manual: false,
      })
      if (decision.action === 'write') setValue(decision.slug)
    }, DERIVATION_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [title, value, readOnly, setValue])

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

  /*
   * "Regenerar do titulo" e um PEDIDO explicito: nao passa pelo debounce (a
   * pessoa acabou de clicar e espera resposta imediata) e pode reclamar de um
   * titulo que nao produz endereco valido.
   */
  const regenerate = useCallback((): void => {
    following.current = true
    const decision = decideSlugFromTitle({
      title,
      currentSlug: value ?? '',
      following: true,
      readOnly: readOnly === true,
      manual: true,
    })
    if (decision.action === 'reject') {
      setProblem(REJECTION_MESSAGES[decision.reason])
      return
    }
    setProblem(null)
    if (decision.action === 'write') setValue(decision.slug)
  }, [title, value, readOnly, setValue])

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
