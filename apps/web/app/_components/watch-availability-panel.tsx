import type { ReactNode } from "react";

import type {
  WatchAvailabilityOffer,
  WatchAvailabilityView,
} from "../../src/lib/watch-availability-presenter";

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
 *
 * ============ AGRUPAMENTO POR MARCA (2026-08-19) ============
 *
 * Decisao de Pablo Eduardo: o leitor ve "Paramount+" UMA vez, com as rotas
 * clicaveis embaixo — assinatura direta, plano Premium, canal no Prime Video.
 * Antes disso o mesmo titulo listava quatro linhas com nomes que so diferiam no
 * sufixo, e nada dizia o que as separava.
 *
 * Tres limites que o componente respeita, e que nenhum ajuste visual pode
 * afrouxar:
 *  1. NENHUMA OFERTA SOME. Toda rota e um `<a>` com o proprio destino.
 *  2. NENHUMA LINHA MENTE. O rotulo da rota diz o que o leitor precisa ter —
 *     "canal no Prime Video" nomeia o hospedeiro, porque assinar o canal exige
 *     assinar o Prime tambem. Esconder isso atras do nome da marca seria
 *     omitir um custo.
 *  3. AGRUPAR E OPT-IN. Provedor sem marca DECLARADA
 *     (`@screena/public-contracts`) cai no caminho solo e aparece exatamente
 *     como antes. Nao ha ramo que adivinhe marca a partir do nome do upstream.
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
              {group.brands.map((brand) => {
                const solo =
                  brand.routes.length === 1 && brand.routes[0]?.label === null;
                return (
                  <li
                    key={brand.key}
                    className="watch-brand"
                    data-brand-declared={brand.declared ? "sim" : "nao"}
                  >
                    {solo ? (
                      /*
                        CAMINHO SOLO — identico ao de antes desta decisao: uma
                        linha, o nome do provedor, nenhum rotulo de rota. E isto
                        que "aparece sozinho, como hoje" significa.
                      */
                      <WatchOfferLink offer={brand.routes[0]!.offer} />
                    ) : (
                      <>
                        <span className="watch-brand__name">{brand.name}</span>
                        <ul className="watch-brand__routes">
                          {brand.routes.map((route) => (
                            <li
                              key={`${route.offer.providerKey}:${route.offer.destinationUrl}`}
                              className="watch-brand__route"
                            >
                              <WatchOfferLink
                                offer={route.offer}
                                routeLabel={route.label}
                              />
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {view.updatedAtLabel !== null ? (
        <p className="watch-availability__updated">{view.updatedAtLabel}</p>
      ) : null}

      {/*
        O CREDITO DA ORIGEM NAO FICA MAIS AQUI.

        Ate 2026-08-12 este painel fechava com "Disponibilidade fornecida por
        Movie of the Night" / "por JustWatch". Decisao do proprietario (Pablo
        Eduardo, 2026-08-13): todo credito de fonte passou a viver no RODAPE
        GLOBAL, que e chrome de toda pagina.

        `view.attributions` continua sendo montado pelo presenter — e
        proveniencia da oferta que REALMENTE entrou, usada por auditoria e pelos
        validadores contra Postgres real. Nao renderiza-lo aqui e a decisao;
        deixar de calcula-lo seria perder o rastro.

        Reintroduzir o credito neste ponto duplica o que o rodape ja diz.
        Travado por `tests/web/footer-credits.test.tsx`.
      */}
    </section>
  );
}

/**
 * O link de UMA oferta.
 *
 * Extraido para que a linha solta e a rota dentro de uma marca sejam
 * LITERALMENTE o mesmo elemento. Duas copias divergiriam, e a de menos trafego
 * divergiria em silencio — foi assim que a modalidade sumiu de dois dos quatro
 * consumidores quando o portao foi aberto as duas origens.
 */
function WatchOfferLink({
  offer,
  routeLabel = null,
}: {
  offer: WatchAvailabilityOffer;
  /** Rotulo da rota ("canal no Prime Video"); `null` na linha solta. */
  routeLabel?: string | null;
}): ReactNode {
  /*
    O destino tem DUAS naturezas e o rotulo acessivel diz qual: `provider` leva
    ao titulo no proprio servico; `aggregator` leva a pagina do titulo no
    agregador daquele pais (o unico link que a origem TMDB/JustWatch publica).
    Prometer "ir para a Netflix" num link que leva ao agregador seria afirmar um
    destino que o upstream nunca prometeu.

    Com o agrupamento, o `aria-label` ganhou a ROTA: quem ouve "Paramount+:
    abrir no serviço" quatro vezes seguidas nao sabe qual das quatro ativou.
  */
  const destino =
    offer.destinationKind === "provider"
      ? `${offer.providerName}: abrir no serviço`
      : `${offer.providerName}: abrir página de disponibilidade`;
  const ariaLabel = routeLabel === null ? destino : `${destino} (${routeLabel})`;

  return (
    <a
      className="watch-offer__link"
      href={offer.destinationUrl}
      data-destination-kind={offer.destinationKind}
      aria-label={ariaLabel}
      rel="nofollow sponsored noopener"
      target="_blank"
    >
      {/*
        Numa rota, o nome do provedor CRU sairia da tela — quem manda e a marca,
        que ja esta no `<span class="watch-brand__name">`. O que a rota exibe e
        o rotulo. Sem marca declarada, o nome do provedor continua sendo a linha.
      */}
      <span className="watch-offer__provider">
        {routeLabel ?? offer.providerName}
      </span>
      {/*
        TEXTO VISIVEL, nao so `aria-label`. O destino do caminho TMDB/JustWatch
        e a pagina de disponibilidade do titulo, e nao o servico — quem clica
        precisa saber ANTES. O criterio e o mesmo que o credito da nota fixou:
        informacao que muda o que o leitor espera nao pode viver so em atributo
        de acessibilidade.

        Ela nomeia o DESTINO, nunca o fornecedor tecnico — escrever "via TMDB"
        colocaria o `provider_api` na cara do leitor como se fosse a fonte, e a
        fonte creditada e o JustWatch (invariante 2).
      */}
      {offer.destinationKind === "aggregator" ? (
        <span className="watch-offer__destination">
          página de disponibilidade
        </span>
      ) : null}
      {offer.quality !== null || offer.priceLabel !== null ? (
        <span className="watch-offer__meta">
          {offer.quality !== null ? (
            <span className="watch-offer__quality">{offer.quality}</span>
          ) : null}
          {offer.priceLabel !== null ? (
            <span className="watch-offer__price">{offer.priceLabel}</span>
          ) : null}
        </span>
      ) : null}
    </a>
  );
}
