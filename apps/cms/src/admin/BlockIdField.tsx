'use client'

/**
 * BlockIdField — a ancora do bloco deixa de ser digitada a mao.
 *
 * O `Block Id` e obrigatorio e era escrito por quem redigia: uma materia de 15
 * blocos exigia quinze identificadores inventados por uma pessoa. Ele continua
 * existindo e continua estavel — e o que liga comentario e correcao a um trecho
 * entre versoes — mas passa a nascer sozinho e a aparecer em leitura.
 *
 * A REGRA QUE IMPEDE O LACO DE RENDER: escreve SOMENTE quando o campo esta
 * vazio. `setValue` no Payload despacha `{type:'UPDATE'}` e chama
 * `setModified(true)` incondicionalmente, entao escrever um valor igual ao atual
 * agenda render sem mudar nada — foi assim que a geracao de slug derrubou o
 * admin. Aqui a escrita e uma so, na criacao do bloco, e as passagens seguintes
 * encontram o campo preenchido e nao fazem nada.
 *
 * O id NAO e regenerado ao reordenar nem ao editar o texto: ele nao deriva de
 * posicao nem de conteudo (ver `block-id.ts`).
 */

import { FieldLabel, useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import React, { useEffect } from 'react'

import { browserRandomHex, generateBlockId, isUsableBlockId } from './block-id.js'

export const BlockIdField: TextFieldClientComponent = ({ field, path, readOnly }) => {
  const { value, setValue } = useField<string>({ path })

  useEffect(() => {
    if (readOnly === true) return
    // A guarda de ponto fixo. Bloco vindo da automacao ja chega com id do
    // contrato; so o bloco criado no painel nasce sem.
    if (isUsableBlockId(value)) return
    setValue(generateBlockId(browserRandomHex))
  }, [value, readOnly, setValue])

  return (
    <div className="cinerie-block-id field-type text">
      <FieldLabel label={field?.label ?? 'Âncora do bloco'} path={path} />
      <output className="cinerie-block-id__value">{value ?? '—'}</output>
      <p className="cinerie-block-id__hint">
        Gerada automaticamente. Serve para ancorar comentário e correção neste trecho — não muda
        quando o bloco é reordenado.
      </p>
    </div>
  )
}

export default BlockIdField
