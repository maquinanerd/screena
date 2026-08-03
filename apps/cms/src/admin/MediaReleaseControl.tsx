'use client'

/**
 * MediaReleaseControl — o estado de liberacao da midia, visivel e acionavel.
 *
 * Fica no documento da PROPRIA MIDIA, e nao no artigo, de proposito: liberar uso
 * e decisao com consequencia juridica, e ela precisa acontecer onde estao as
 * evidencias — o arquivo, o credito, a fonte e o detentor dos direitos. Um botao
 * de liberar no meio do fluxo de publicacao transformaria a decisao num obstaculo
 * a ser removido as pressas, que e exatamente o que o default fail-closed
 * (`licenseStatus: 'unknown'`, tres permissoes `false`) existe para evitar.
 *
 * O que este controle faz e um SAVE comum do formulario com os campos certos —
 * o mesmo que marcar as caixas a mao. O access control da collection continua
 * valendo no servidor: quem nao pode atualizar `media` recebe recusa.
 */

import { useAllFormFields, useForm } from '@payloadcms/ui'
import React, { useCallback, useMemo, useState } from 'react'

import { mediaLicenseLabel } from './editorial-vocabulary.js'

interface Permission {
  readonly key: 'allowedForEditorial' | 'allowedForHero' | 'allowedForSocial'
  readonly label: string
  readonly hint: string
}

const PERMISSIONS: readonly Permission[] = [
  {
    key: 'allowedForEditorial',
    label: 'Uso editorial',
    hint: 'aparece no corpo da matéria',
  },
  { key: 'allowedForHero', label: 'Capa', hint: 'pode ser a imagem de destaque' },
  { key: 'allowedForSocial', label: 'Social', hint: 'pode ir para as redes' },
]

export default function MediaReleaseControl(): React.ReactElement | null {
  const { getData, submit } = useForm()
  const [fields] = useAllFormFields()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const doc = useMemo(() => getData(), [fields, getData])
  const licenseStatus = typeof doc.licenseStatus === 'string' ? doc.licenseStatus : 'unknown'
  const granted = PERMISSIONS.filter((permission) => doc[permission.key] === true)
  const released = licenseStatus === 'approved' && doc.allowedForEditorial === true

  const release = useCallback(async (): Promise<void> => {
    setSaving(true)
    setFailed(false)
    try {
      const result = await submit({
        overrides: {
          licenseStatus: 'approved',
          allowedForEditorial: true,
          allowedForHero: true,
        },
      })
      const response = (result as { res?: Response } | void)?.res
      if (response !== undefined && !response.ok) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }, [submit])

  return (
    <aside className={`cinerie-media-release is-${released ? 'released' : 'blocked'}`}>
      <div className="cinerie-media-release__state">
        <strong>{released ? 'Liberada para publicação' : 'Não publica'}</strong>
        <span>{mediaLicenseLabel(licenseStatus)}</span>
      </div>

      <ul className="cinerie-media-release__permissions">
        {PERMISSIONS.map((permission) => {
          const on = doc[permission.key] === true
          return (
            <li className={on ? 'is-on' : 'is-off'} key={permission.key}>
              <span aria-hidden="true">{on ? '✓' : '—'}</span>
              <span>
                <strong>{permission.label}</strong>
                <small>{permission.hint}</small>
              </span>
            </li>
          )
        })}
      </ul>

      {released ? null : (
        <div className="cinerie-media-release__action">
          <button disabled={saving} onClick={() => { void release() }} type="button">
            {saving ? 'Salvando…' : 'Liberar para uso editorial e capa'}
          </button>
          <small>
            Marca a licença como aprovada e libera corpo e capa. Confirme antes o crédito, a
            fonte e o detentor dos direitos abaixo — a responsabilidade pela liberação é de quem
            clica. Uso em redes sociais continua desmarcado.
          </small>
        </div>
      )}

      {granted.length > 0 && !released ? (
        <small className="cinerie-media-release__partial">
          Já liberada para: {granted.map((permission) => permission.label).join(', ')} — mas a
          licença ainda não está aprovada, então nada publica.
        </small>
      ) : null}

      {failed ? (
        <p className="cinerie-media-release__error" role="alert">
          Não foi possível liberar. Você pode não ter permissão para alterar mídia.
        </p>
      ) : null}
    </aside>
  )
}
