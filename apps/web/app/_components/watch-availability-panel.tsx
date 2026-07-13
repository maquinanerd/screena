import type { ReactNode } from "react";

import type { WatchAvailabilityView } from "../../src/lib/watch-availability-presenter";

/**
 * WatchAvailabilityPanel — painel "Disponibilidade no Brasil" das paginas de
 * detalhe (filme/serie).
 *
 * PRESENTACIONAL e PURO: recebe a `WatchAvailabilityView` ja montada pelo
 * presenter (`watch-availability-presenter.ts`) e so produz JSX. Nao importa
 * @screena/db nem faz IO (invariantes 3/4).
 *
 * Governanca: a view ja passou pelo gate de licenca (so ofertas com
 * `display_allowed = true`), so carrega modalidades LEGAIS e so `deep_link`
 * http/https. Este painel NUNCA renderiza logo/imagem de provedor, nota/rating,
 * CTA falso, placeholder, torrent/IPTV ou plataforma inventada. Links externos
 * saem com `rel="nofollow sponsored noopener"` e `target="_blank"`.
 */

interface WatchAvailabilityPanelProps {
  /** View ja filtrada/licenciada pelo presenter; `null` quando nao ha oferta. */
  view: WatchAvailabilityView | null;
}

export function WatchAvailabilityPanel({
  view,
}: WatchAvailabilityPanelProps): ReactNode {
  if (view === null || view.groups.length === 0) return null;

  return (
    <section
      className="watch-availability"
      aria-labelledby="watch-availability-title"
    >
      <h2 id="watch-availability-title" className="watch-availability__title">
        Disponibilidade no Brasil
      </h2>
      <p className="watch-availability__note">
        As ofertas podem mudar conforme região e assinatura.
      </p>

      <div className="watch-availability__groups">
        {view.groups.map((group) => (
          <div
            key={group.offerType}
            className="watch-availability__group"
            data-offer-type={group.offerType}
          >
            <h3 className="watch-availability__group-title">{group.label}</h3>
            <ul className="watch-availability__list">
              {group.offers.map((offer) => (
                <li
                  key={`${offer.providerKey}:${offer.offerType}:${offer.deepLink}`}
                  className="watch-offer"
                >
                  <a
                    className="watch-offer__link"
                    href={offer.deepLink}
                    rel="nofollow sponsored noopener"
                    target="_blank"
                  >
                    <span className="watch-offer__provider">
                      {offer.providerName}
                    </span>
                    {offer.quality !== null || offer.priceLabel !== null ? (
                      <span className="watch-offer__meta">
                        {offer.quality !== null ? (
                          <span className="watch-offer__quality">
                            {offer.quality}
                          </span>
                        ) : null}
                        {offer.priceLabel !== null ? (
                          <span className="watch-offer__price">
                            {offer.priceLabel}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {view.updatedAtLabel !== null ? (
        <p className="watch-availability__updated">{view.updatedAtLabel}</p>
      ) : null}
    </section>
  );
}
