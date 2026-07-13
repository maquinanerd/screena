import type { ReactNode } from "react";

import type { ExternalLink } from "../../src/lib/external-links";

/**
 * EntityExternalIds — linha DISCRETA de identidade externa ("Ver em IMDb / TMDb
 * / Wikidata") das paginas de detalhe (filme/serie/pessoa).
 *
 * PRESENTACIONAL e PURO: recebe `ExternalLink[]` ja montados por
 * `buildExternalLinks` (mesma fonte do `sameAs` do JSON-LD) e so produz JSX. Nao
 * importa @screena/db nem faz IO (invariantes 3/4). Sao apenas fontes canonicas
 * de identidade — nunca link de streaming, nota ou pirataria. Lista vazia nunca
 * chega aqui (o chamador omite a secao), entao a UI nunca parece um bug.
 */

interface EntityExternalIdsProps {
  /** Links ja validados/rotulados; a ordem espelha o grafo `sameAs`. */
  links: ExternalLink[];
  /** Rotulo acessivel da secao (ex.: "Identidade externa"). */
  label?: string;
}

export function EntityExternalIds({
  links,
  label = "Também em",
}: EntityExternalIdsProps): ReactNode {
  if (links.length === 0) return null;
  return (
    <nav className="entity-links" aria-label={label}>
      <span className="entity-links__label">{label}</span>
      <ul className="entity-links__list">
        {links.map((link) => (
          <li key={link.href} className="entity-links__item">
            <a
              className="entity-links__link"
              href={link.href}
              rel="noopener nofollow"
              target="_blank"
            >
              {link.label}
              <svg
                className="entity-links__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 17 17 7" />
                <path d="M9 7h8v8" />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
