/**
 * watch-brands-row.ts — A fileira "ONDE ASSISTIR" do cartão do topo. PURA.
 *
 * O canônico desenha as marcas em linha (NETFLIX · prime video · Max). Três
 * decisões do proprietário se encontram aqui, e as três valem:
 *
 *  1. A MARCA na fileira (canônico + autorização de 20/08/2026 + ordem expressa
 *     de 11/09/2026: "inclua OBRIGATORIAMENTE AS LOGOS dos serviços de
 *     stream"). O logo de cada marca vem da LICENÇA do provedor (via
 *     `publicWatchProviderLogo`, calculado no presenter); a palavra-marca
 *     continua escrita ao lado, e um provedor recém-registrado sem arquivo cai
 *     só no texto.
 *  2. A MODALIDADE visível (decisão de 2026-08-13): "Amazon" num título que
 *     custa R$ 14,90 de aluguel afirmaria que está incluso no Prime. Fileira
 *     compacta = uma entrada por MARCA com as modalidades ao lado — nunca em
 *     `title`/`aria-label`, sempre texto visível.
 *  3. O DESTINO real continua (não-regressão das 874 ofertas verificadas):
 *     cada marca leva à MELHOR oferta dela — a primeira na ordem dos grupos,
 *     que já é "o que está incluso vem antes do que custa" —, com o
 *     `destinationKind` preservado (provedor vs agregador).
 *
 * Deriva da `WatchAvailabilityView` já licenciada/creditada — nenhuma regra de
 * licença é reavaliada aqui.
 */

import type { PublicCreditLogo } from "@screena/legal/public-credits";

import type {
  WatchAvailabilityView,
  WatchDestinationKind,
} from "./watch-availability-presenter";

/** Uma marca na fileira do topo, com as modalidades em que ela aparece. */
export interface WatchBrandRowItem {
  /** Chave estável da marca (para key/data-attr). */
  readonly key: string;
  /** Nome exibido — a palavra-marca da caixa. */
  readonly name: string;
  /**
   * O logo da marca, declarado pela licença do provedor. `null` = só o nome
   * (provedor sem arquivo presente).
   */
  readonly logo: PublicCreditLogo | null;
  /**
   * Rótulos de modalidade na ordem dos grupos do painel ("o que está incluso
   * vem antes do que custa"), deduplicados.
   */
  readonly modalities: readonly string[];
  /** Destino da MELHOR oferta da marca (primeira do primeiro grupo). */
  readonly destinationUrl: string;
  /** O que o destino REALMENTE é — provedor ou agregador (a11y + data-attr). */
  readonly destinationKind: WatchDestinationKind;
}

/**
 * As marcas da fileira, na ordem do primeiro grupo em que aparecem (a ordem
 * dos grupos já é "incluso antes do que custa"). Uma entrada por marca; as
 * modalidades acumulam; o destino e o logo são os da primeira ocorrência.
 */
export function watchBrandsRow(view: WatchAvailabilityView): readonly WatchBrandRowItem[] {
  const byKey = new Map<
    string,
    {
      name: string;
      logo: PublicCreditLogo | null;
      modalities: string[];
      destinationUrl: string;
      destinationKind: WatchDestinationKind;
    }
  >();
  for (const group of view.groups) {
    for (const brand of group.brands) {
      const firstOffer = brand.routes[0]?.offer;
      const existing = byKey.get(brand.key);
      if (existing === undefined) {
        if (firstOffer === undefined) continue;
        byKey.set(brand.key, {
          name: brand.name,
          logo: brand.logo,
          modalities: [group.label],
          destinationUrl: firstOffer.destinationUrl,
          destinationKind: firstOffer.destinationKind,
        });
      } else {
        if (!existing.modalities.includes(group.label)) {
          existing.modalities.push(group.label);
        }
        // A mesma marca pode ter chegado sem logo no primeiro grupo (rota sem
        // arquivo) e com logo num grupo seguinte: a marca é a mesma, o logo vale.
        if (existing.logo === null && brand.logo !== null) existing.logo = brand.logo;
      }
    }
  }
  return [...byKey.entries()].map(([key, item]) => ({
    key,
    name: item.name,
    logo: item.logo,
    modalities: item.modalities,
    destinationUrl: item.destinationUrl,
    destinationKind: item.destinationKind,
  }));
}
