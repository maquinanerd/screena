import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Preview técnica',
  robots: { index: false, follow: false },
}

/** Rota técnica preservada sem simular entidade, conteúdo editorial ou schema. */
export default function MoviePagePreview() {
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
