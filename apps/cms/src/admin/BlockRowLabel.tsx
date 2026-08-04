'use client'

/**
 * BlockRowLabel — o bloco recolhido diz o que ele e.
 *
 * O painel mostrava "01 Paragraph Untitled" em todo bloco fechado: numa materia
 * de quinze blocos, quinze linhas identicas, e achar um paragrafo exigia abrir
 * um por um. Com o trecho do conteudo no rotulo, a materia recolhida vira
 * sumario navegavel.
 *
 * Efeito colateral desejado: bloco vazio para de se esconder atras de "Untitled"
 * e se denuncia na propria lista, ANTES da tentativa de publicar.
 *
 * A regra de montagem e pura e testada (`block-row-label.ts`); aqui so ha
 * leitura do contexto de linha e marcacao.
 */

import { useRowLabel } from '@payloadcms/ui'
import React from 'react'

import { buildBlockRowLabel } from './block-row-label.js'

export const BlockRowLabel: React.FC = () => {
  const { data, rowNumber } = useRowLabel<Record<string, unknown>>()
  const label = buildBlockRowLabel(data)
  // `rowNumber` e 0-based; a lista do Payload numera a partir de 1.
  const position = String((rowNumber ?? 0) + 1).padStart(2, '0')

  return (
    <span className="cinerie-row-label">
      <span className="cinerie-row-label__position">{position}</span>
      <span className="cinerie-row-label__type">{label.type}</span>
      {label.empty ? (
        <span className="cinerie-row-label__empty">vazio</span>
      ) : label.preview === null ? null : (
        <span className="cinerie-row-label__preview">{label.preview}</span>
      )}
    </span>
  )
}

export default BlockRowLabel
