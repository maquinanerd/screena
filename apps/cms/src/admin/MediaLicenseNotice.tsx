'use client'

/**
 * MediaLicenseNotice — a midia se anuncia ANTES da publicacao.
 *
 * O gate recusa com `unauthorized_media` quando a materia aponta para midia sem
 * licenca aprovada — capa, galeria ou bloco de imagem do corpo. Isso e correto e
 * continua. O que nao existia era o aviso: a redacao so descobria no momento de
 * publicar, depois de ter escrito tudo.
 *
 * Este aviso e LEITURA. Ele nao libera nada e nao muda regra: le o estado das
 * midias referenciadas e leva a pessoa ao documento onde a decisao e tomada —
 * que e onde estao o credito, a fonte e o detentor dos direitos. Liberar sem
 * olhar essas evidencias e exatamente o que o default fail-closed evita.
 */

import { useAllFormFields, useConfig, useForm } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

import { mediaBlockReason } from './editorial-vocabulary.js'
import {
  referencedMediaIds,
  relationIds,
  type MediaFacts,
} from './publish-gate-preview.js'
import { apiBase, fetchMediaFacts } from './admin-rest.js'

export default function MediaLicenseNotice(): React.ReactElement | null {
  const { getData } = useForm()
  const [fields] = useAllFormFields()
  const { config } = useConfig()
  const [media, setMedia] = useState<readonly MediaFacts[]>([])

  const doc = useMemo(() => getData(), [fields, getData])
  const heroId = relationIds(doc.heroMedia)[0] ?? null
  const ids = referencedMediaIds(doc).join(',')
  const base = apiBase(config.routes)

  useEffect(() => {
    const controller = new AbortController()
    const list = ids === '' ? [] : ids.split(',')
    fetchMediaFacts(base, list, controller.signal)
      .then(setMedia)
      // Falha de leitura nao inventa bloqueio: o gate do servidor continua
      // sendo quem recusa, e ele le do banco.
      .catch(() => undefined)
    return () => { controller.abort() }
  }, [ids, base])

  const blocked = useMemo(
    () =>
      media
        .map((item) => ({
          item,
          reason: mediaBlockReason({
            licenseStatus: item.licenseStatus,
            allowedForEditorial: item.allowedForEditorial,
            allowedForHero: item.allowedForHero,
            usedAsHero: item.id === heroId,
          }),
        }))
        .filter((entry): entry is { item: MediaFacts; reason: string } => entry.reason !== null),
    [media, heroId],
  )

  if (blocked.length === 0) return null

  return (
    <aside className="cinerie-media-notice" role="status">
      <strong>
        {blocked.length === 1
          ? 'Uma imagem desta matéria não está liberada:'
          : `${String(blocked.length)} imagens desta matéria não estão liberadas:`}
      </strong>
      <ul>
        {blocked.map(({ item, reason }) => (
          <li key={item.id}>
            <a href={`/admin/collections/media/${item.id}`} rel="noreferrer" target="_blank">
              Mídia #{item.id}
            </a>{' '}
            — {reason}
          </li>
        ))}
      </ul>
      <small>
        A liberação é decidida no próprio documento da mídia, onde ficam o crédito, a fonte e o
        detentor dos direitos.
      </small>
    </aside>
  )
}
