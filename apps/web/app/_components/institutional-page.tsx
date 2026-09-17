import type { ReactNode } from 'react'

import { HOME_TRAIL_LABEL, type TrailStep } from '../../src/lib/institutional-trail'
import { HOME_PATH } from '../../src/lib/routes'

/**
 * InstitutionalPage — a casca das paginas institucionais: Autores, Sobre,
 * Politica editorial, Contato e a metodologia do Cinerie Score.
 *
 * AUDITORIA DE SEO (11/09/2026, secao 3.6): nao existiam Sobre, Politica
 * editorial, Contato nem pagina de autor. Para um site que publica opiniao
 * editorial e reexibe notas de terceiros, era o conjunto de sinais de confianca
 * que mais faltava.
 *
 * A REGRA DO CONTEUDO, que vale para toda pagina que usa esta casca: cada frase e
 * um fato que o proprio produto sustenta — codigo, licenca registrada ou texto que
 * o controlador ja publicou nos documentos legais. Nenhuma equipe, premio,
 * audiencia, parceria ou credencial que nao exista.
 *
 * Mesma linguagem visual dos documentos legais (`legal-doc.tsx`): trilha VISIVEL,
 * coluna de leitura, base clara. A trilha sai de `trail`, a MESMA lista que a
 * pagina passa a `trailBreadcrumbJsonLd` — a visivel e a do JSON-LD nao divergem.
 * Sem "vigente desde" nem versao: estas paginas descrevem o servico, nao sao
 * contrato aceito por ninguem.
 */
export function InstitutionalPage({
  title,
  trail,
  lede,
  children,
}: {
  readonly title: string
  /** Os degraus depois de "Início"; o ultimo, sem `href`, e a propria pagina. */
  readonly trail: readonly TrailStep[]
  /** Paragrafo de abertura, logo abaixo do titulo. */
  readonly lede?: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <main data-vertical="legal">
      <div className="container" style={{ paddingTop: 36 }}>
        <nav aria-label="Trilha de navegação" className="breadcrumb">
          <ol>
            <li>
              <a href={HOME_PATH}>{HOME_TRAIL_LABEL}</a>
            </li>
            {trail.map((step) =>
              step.href === null ? (
                <li aria-current="page" key={step.label}>
                  {step.label}
                </li>
              ) : (
                <li key={step.href}>
                  <a href={step.href}>{step.label}</a>
                </li>
              ),
            )}
          </ol>
        </nav>
      </div>

      <article className="legal-body">
        <header className="legal-head">
          <h1 className="legal-title">{title}</h1>
          {lede !== undefined ? <p>{lede}</p> : null}
        </header>
        {children}
      </article>
    </main>
  )
}
