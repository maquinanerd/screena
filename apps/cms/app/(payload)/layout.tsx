/*
 * Layout do painel do Payload, no padrao oficial da lib.
 *
 * `serverFunction` e obrigatoria a partir do Payload 3: e por ela que o painel
 * executa acoes no servidor. Mantida minima e sem logica propria.
 */
import config from '@payload-config'
import '@payloadcms/next/css'
import { RootLayout, handleServerFunctions } from '@payloadcms/next/layouts'
import type { ServerFunctionClient } from 'payload'
import React from 'react'

import { importMap } from './admin/importMap.js'
// Tokens ANTES de `custom.scss`: aquele arquivo consome os `--cinerie-*` que
// este reaponta para o valor real do site publico. Ordem invertida deixaria a
// correcao de deriva sem efeito no primeiro paint.
import './cinerie-tokens.scss'
import './custom.scss'

const serverFunction: ServerFunctionClient = async function (args) {
  'use server'
  return handleServerFunctions({ ...args, config, importMap })
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  )
}
