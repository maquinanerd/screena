import type { ReactNode } from "react";

import type { WatchBrandRowItem } from "../../src/lib/watch-brands-row";

/**
 * WatchBrandsRow — "ONDE ASSISTIR" do cartão do topo: marcas em linha, como o
 * canônico desenha. Sem lista com marcador, sem subtítulo "DISPONIBILIDADE NO
 * BRASIL" dentro do cartão.
 *
 * A caixa da marca carrega o LOGO do provedor (arquivo declarado pela licença —
 * autorização do proprietário de 20/08/2026, arquivos no ar desde 11/09/2026) E
 * a palavra-marca escrita ao lado. O logo é decorativo no HTML (`alt=""`): o
 * nome já está em texto e o `aria-label` do link diz o destino. Nenhum SVG de
 * marca é desenhado aqui — o `src` é o que a licença declarou.
 *
 * A MODALIDADE fica VISÍVEL sob a marca (decisão de 2026-08-13): sem ela, as
 * lojas transacionais ("Amazon Video", "Apple TV Store") afirmariam inclusão
 * numa assinatura que o leitor talvez não tenha.
 *
 * Cada marca é um LINK para a melhor oferta dela (não-regressão: as ofertas
 * verificadas em produção continuam clicáveis). O `aria-label` diz o que o
 * destino REALMENTE é — serviço ou página de disponibilidade do agregador —
 * exatamente como o painel completo já fazia; `rel` e `target` idem.
 */

interface WatchBrandsRowProps {
  readonly brands: readonly WatchBrandRowItem[];
}

export function WatchBrandsRow({ brands }: WatchBrandsRowProps): ReactNode {
  if (brands.length === 0) return null;
  return (
    <ul className="watch-brands">
      {brands.map((brand) => {
        const destino =
          brand.destinationKind === "provider"
            ? `${brand.name}: abrir no serviço`
            : `${brand.name}: abrir página de disponibilidade`;
        return (
          <li className="watch-brands__item" data-watch-brand={brand.key} key={brand.key}>
            <a
              aria-label={destino}
              className="watch-brands__link"
              data-destination-kind={brand.destinationKind}
              href={brand.destinationUrl}
              rel="nofollow sponsored noopener"
              target="_blank"
            >
              <span className="watch-brands__mark">
                {brand.logo !== null ? (
                  <img
                    alt=""
                    aria-hidden="true"
                    className="watch-logo"
                    data-watch-logo={brand.key}
                    decoding="async"
                    // Sem isto o SSR do React 19 emite um preload de prioridade
                    // ALTA por logo, disputando banda com a imagem principal.
                    fetchPriority="low"
                    height={brand.logo.heightPx}
                    src={brand.logo.src}
                    width={brand.logo.widthPx ?? undefined}
                  />
                ) : null}
                <span className="watch-brands__name">{brand.name}</span>
              </span>
              <span className="watch-brands__modalities">{brand.modalities.join(" · ")}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
