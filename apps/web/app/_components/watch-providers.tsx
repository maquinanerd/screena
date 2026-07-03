import type { ReactNode } from "react";

import type { WatchView } from "../../src/lib/watch-presenter";

/**
 * WatchProviders — secao "Onde assistir" das paginas de detalhe (filme/serie).
 *
 * PRESENTACIONAL e PURO: recebe a `WatchView` ja montada pelo presenter
 * (`watch-presenter.ts`) e so produz JSX. Nao importa @screena/db nem faz IO
 * (invariantes 3/4).
 *
 * Governanca: a `WatchView` ja passou pelo gate de licenca (so ofertas com
 * `display_allowed = true`) e so carrega modalidades LEGAIS. Este componente
 * nao renderiza deep link nesta fase — so nome do provedor + modalidade e o
 * carimbo honesto de frescor ("Atualizado em ..."). Nunca exibe torrent, IPTV,
 * player ilegal, nota ou plataforma inventada.
 */

interface WatchProvidersProps {
  /** Titulo da secao (ex.: "Onde assistir"). */
  heading: string;
  /** View ja filtrada/licenciada pelo presenter. */
  view: WatchView;
}

export function WatchProviders({ heading, view }: WatchProvidersProps): ReactNode {
  if (view.providers.length === 0) return null;
  return (
    <section className="watch-providers" aria-labelledby="watch-providers-title">
      <h2 id="watch-providers-title" className="watch-providers__title">
        {heading}
      </h2>
      <ul className="watch-providers__list">
        {view.providers.map((provider) => (
          <li key={provider.providerName} className="watch-provider">
            <span className="watch-provider__name">{provider.providerName}</span>
            <span className="watch-provider__offers">
              {provider.offerLabels.map((label) => (
                <span key={label} className="watch-provider__offer">
                  {label}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {view.updatedAtLabel !== null ? (
        <p className="watch-providers__updated">{view.updatedAtLabel}</p>
      ) : null}
    </section>
  );
}
