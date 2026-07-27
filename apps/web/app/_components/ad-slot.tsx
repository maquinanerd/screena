import type { ReactNode } from 'react'

/**
 * AdSlot — slot de publicidade do handoff (25-ADVERTISEMENT-SLOTS).
 *
 * Contrato:
 *  - 4 formatos com DIMENSAO RESERVADA desde o primeiro paint (sem CLS);
 *  - rotulo "PUBLICIDADE" SEMPRE visivel (nunca se confunde com editorial);
 *  - estados: `unavailable` (default — nenhum ad server configurado),
 *    `placeholder` (permitido apenas em dev/QA visual, via env) e `omitted`;
 *  - NUNCA anunciante ficticio, NUNCA criativo inventado.
 *
 * Nao existe integracao com ad server nesta fase (nenhum contrato de venda).
 * Em producao sem configuracao o slot e OMITIDO por padrao — nao renderizamos
 * propaganda falsa nem caixas vazias para o usuario final. O espaco reservado
 * so aparece quando `NEXT_PUBLIC_AD_SLOTS=placeholder` (dev/design QA).
 */

export type AdFormat = 'leaderboard' | 'billboard' | 'rectangle' | 'skyscraper'

function adMode(): 'placeholder' | 'omitted' {
  // Lido em build/render de server component; nunca segredo (flag publica).
  return process.env.NEXT_PUBLIC_AD_SLOTS === 'placeholder' ? 'placeholder' : 'omitted'
}

export function AdSlot({ format, slotId }: { format: AdFormat; slotId: string }): ReactNode {
  if (adMode() === 'omitted') return null
  return (
    <div aria-label="Publicidade" className={`ad-slot ad-slot--${format}`} role="complementary">
      <span className="ad-slot__label">Publicidade</span>
      <div className="ad-slot__box" data-slot-id={slotId}>
        <span>Espaço reservado ({format})</span>
      </div>
    </div>
  )
}
