import type { ReactNode } from "react";

/**
 * EntityFacts — ficha tecnica das paginas de detalhe: uma lista de definicao
 * (`<dl>`) com pares rotulo/valor de dados FACTUAIS de catalogo (ano, duracao,
 * situacao, idioma, temporadas...).
 *
 * PRESENTACIONAL e PURO: recebe apenas os pares ja resolvidos pela camada server
 * (nunca inventa nem formata dado de terceiro). O chamador filtra os valores
 * ausentes antes de passar; se a lista chegar vazia, nada e renderizado (a ficha
 * some em vez de mostrar linhas em branco que pareceriam bug).
 */

export interface EntityFact {
  /** Rotulo curto em pt-BR (ex.: "Ano", "Duração"). */
  label: string;
  /** Valor ja formatado; so entra quando existe (nunca placeholder). */
  value: string;
}

interface EntityFactsProps {
  facts: EntityFact[];
}

export function EntityFacts({ facts }: EntityFactsProps): ReactNode {
  if (facts.length === 0) return null;
  return (
    <dl className="entity-facts">
      {facts.map((fact) => (
        <div key={fact.label} className="entity-facts__row">
          <dt className="entity-facts__label">{fact.label}</dt>
          <dd className="entity-facts__value">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
