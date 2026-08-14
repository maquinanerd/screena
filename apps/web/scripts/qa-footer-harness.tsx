/**
 * qa-footer-harness.tsx — Gera um HTML estatico com o rodape REAL + o
 * globals.css REAL, para inspecao visual nos 4 breakpoints.
 *
 * NAO e evidencia final: harness estatico nao e o Next real (sem hidratacao,
 * sem fonte servida pelo app). Serve para conferir layout/tokens/quebras.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SiteFooter } from '../app/_components/site-footer'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.argv[2] ?? path.join(root, '.qa-footer')

const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8')
const markup = renderToStaticMarkup(React.createElement(SiteFooter))

mkdirSync(path.join(outDir, 'brand'), { recursive: true })
copyFileSync(
  path.join(root, 'public/brand/cinerie-wordmark-white.svg'),
  path.join(outDir, 'brand/cinerie-wordmark-white.svg'),
)
writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA — rodape global Cinerie</title>
<style>${css}</style>
<style>body{margin:0}#stub{padding:48px 24px;font:14px/1.6 Montserrat,system-ui;background:#fff}</style>
</head><body>
<div id="stub">Conteudo da rota (stub) — o rodape comeca abaixo.</div>
${markup}
</body></html>`,
)
console.log('QA harness em', outDir)
