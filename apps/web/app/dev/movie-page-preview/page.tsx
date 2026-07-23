import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { isProductionRuntime } from '../../../src/lib/runtime-env'

export const metadata: Metadata = {
  title: 'Preview técnica',
  robots: { index: false, follow: false },
}

/**
 * Rota técnica de preview visual. NÃO é pública em produção (baseline R-12):
 * em runtime de produção responde 404 (a rota "não existe" para o usuário
 * final). Fora de produção (dev/preview) segue disponível para validação visual.
 */
export default function MoviePagePreview() {
  if (isProductionRuntime()) {
    notFound()
  }
  return (
    <main>
      <div className="container">
        <h1>Preview técnica de página de filme</h1>
        <p>
          Esta rota está reservada para validações visuais futuras e não publica dados de uma
          entidade.
        </p>
        <p>
          <a href="/pt/filmes/">Voltar para filmes</a>
        </p>
      </div>
    </main>
  )
}
