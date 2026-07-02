import type { ReactNode } from "react";

import type { EntityCard } from "../../src/lib/entity-index-presenter";

/**
 * EntityCardLink - card de entidade (poster 2:3 + badge de tipo + titulo/meta)
 * usado nas listagens (/pt/filmes/, /pt/series/, /pt/pessoas/) e nos portais
 * (home /pt/ e /pt/explorar/). Extraido de entity-index.tsx para nao duplicar
 * markup entre as superficies.
 *
 * PRESENTACIONAL e PURO: recebe o `EntityCard` ja montado pelo presenter e so
 * produz JSX. Nao importa @screena/db nem faz IO. Renderiza apenas dados
 * reais; sem imagem local segura, mostra fallback visual.
 */

/**
 * Rotulo textual do tipo, exibido como badge sobre o poster (cards do design
 * "Screen Screens v2"). Reforca a invariante 11: o tipo nunca depende so da
 * cor — o badge textual acompanha URL, breadcrumb e titulo da secao.
 */
const CARD_KIND_LABELS: Readonly<Record<EntityCard["kind"], string>> = {
  movie: "Filme",
  series: "Série",
  person: "Pessoa",
};

/**
 * Alt especifico por tipo de card: poster 2:3 para filme/serie, retrato para
 * pessoa. Usa apenas o titulo real do card — nunca descreve conteudo inventado.
 */
function cardImageAlt(card: EntityCard): string {
  return card.kind === "person"
    ? `Retrato de ${card.title}`
    : `Pôster de ${card.title}`;
}

interface EntityCardLinkProps {
  card: EntityCard;
}

export function EntityCardLink({ card }: EntityCardLinkProps): ReactNode {
  return (
    <a className="entity-card" href={card.href} data-entity-type={card.kind}>
      <span
        className={`entity-card__media${card.image ? " entity-card__media--real" : ""}`}
      >
        {card.image !== null ? (
          <img
            src={card.image.src}
            alt={cardImageAlt(card)}
            width={card.image.width}
            height={card.image.height}
            className="entity-card__image"
            loading="lazy"
          />
        ) : (
          <span className="entity-card__fallback" aria-hidden="true" />
        )}
        <span className="entity-card__badge" data-entity-type={card.kind}>
          {CARD_KIND_LABELS[card.kind]}
        </span>
      </span>
      <span className="entity-card__body">
        <span className="entity-card__title">{card.title}</span>
        {card.meta !== null ? (
          <span className="entity-card__meta">{card.meta}</span>
        ) : null}
      </span>
    </a>
  );
}
