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
                  key={`${offer.providerKey}:${offer.offerType}:${offer.destinationUrl}`}
                  className="watch-offer"
                >
                  {/*
                    O destino tem DUAS naturezas e o rotulo acessivel diz qual:
                    `provider` leva ao titulo no proprio servico; `aggregator`
                    leva a pagina do titulo no agregador daquele pais (o unico
                    link que a origem TMDB/JustWatch publica). Prometer "ir para
                    a Netflix" num link que leva ao agregador seria afirmar um
                    destino que o upstream nunca prometeu.
                  */}
                  <a
                    className="watch-offer__link"
                    href={offer.destinationUrl}
                    data-destination-kind={offer.destinationKind}
                    aria-label={
                      offer.destinationKind === "provider"
                        ? `${offer.providerName}: abrir no serviço`
                        : `${offer.providerName}: abrir página de disponibilidade`
                    }
                    rel="nofollow sponsored noopener"
                    target="_blank"
                  >
                    <span className="watch-offer__provider">
                      {offer.providerName}
                    </span>
                    {/*
                      TEXTO VISIVEL, nao so `aria-label`. O destino do caminho
                      TMDB/JustWatch e a pagina de disponibilidade do titulo, e
                      nao o servico — quem clica precisa saber ANTES. O criterio
                      e o mesmo que o credito da nota fixou: informacao que muda
                      o que o leitor espera nao pode viver so em atributo de
                      acessibilidade. O `aria-label` continua onde estava; ele
                      nao estava errado, estava sozinho.

                      A frase e a MESMA do `aria-label` de proposito: uma string
                      so, entao o que se ve e o que se ouve nao podem divergir.
                      Ela nomeia o DESTINO, nunca o fornecedor tecnico —
                      escrever "via TMDB" colocaria o `provider_api` na cara do
                      leitor como se fosse a fonte, e a fonte creditada e o
                      JustWatch (invariante 2).
                    */}
                    {offer.destinationKind === "aggregator" ? (
                      <span className="watch-offer__destination">
                        página de disponibilidade
                      </span>
                    ) : null}
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

      {/*
        Credito da fonte agregadora, exigido pela licenca que autoriza exibir as
        ofertas (requires_attribution/requires_linkback). O presenter ja
        descartou qualquer oferta sem o credito devido, entao esta lista nunca
        fica vazia quando ha grupo — e o credito sempre pertence a uma oferta
        realmente exibida acima.
      */}
      {view.attributions.length > 0 ? (
        <p className="watch-availability__attribution">
          {view.attributions.map((attribution, index) => (
            <span key={`${attribution.text}|${attribution.url ?? ""}`}>
              {index > 0 ? " · " : null}
              {attribution.url !== null ? (
                <a
                  className="watch-availability__attribution-link"
                  href={attribution.url}
                  rel="nofollow noopener"
                  target="_blank"
                >
                  {attribution.text}
                </a>
              ) : (
                attribution.text
              )}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
