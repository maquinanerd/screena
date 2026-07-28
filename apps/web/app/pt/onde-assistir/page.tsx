import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../_components/ad-slot'
import { EmptyState } from '../../_components/ds'
import { WatchPopular } from '../../_components/watch-popular'
import { HOME_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { getWatchBrowseData } from '../../../src/server/watch-browse'

/**
 * Onde assistir — tela 10 do canônico, estrutura EXATA: HERO escuro centrado
 * ("O seu guia de streaming...", sub, kicker "Serviços de streaming" e fileira
 * de provedores como TEXTO — logo_allowed=false, licença) → POPULARES AGORA
 * (tabs reais de plataforma + grade de posters, ordenada pelo sinal técnico de
 * popularidade) → Ad → "PARA VOCÊ" com a composição canônica preservada em
 * ESTADO HONESTO: não há serviço de recomendação exposto ao app público ainda
 * (Prompt 11 não executado) — a seção declara isso, sem recomendação fake nem
 * heurística ad hoc (DESIGN-DELTA). Só oferta com licença vigente e crédito
 * devido (invariante 6); carimbo "Atualizado em" sempre presente quando há
 * dado.
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Onde assistir'
const DESCRIPTION =
  'Filmes e séries com disponibilidade legal de streaming no Brasil, organizados por provedor.'
const BROWSE_PATH = '/pt/onde-assistir/'

function formatUpdatedAt(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

export async function generateMetadata(): Promise<Metadata> {
  const { providers } = await getWatchBrowseData()
  return {
    title: TITLE,
    description: DESCRIPTION,
    // Indexa so quando ha conteudo real (listagem vazia = noindex tecnico).
    robots: publicRobots(providers.length > 0),
    alternates: { canonical: canonicalPublicUrl(BROWSE_PATH) },
  }
}

export default async function WatchBrowsePage() {
  const { providers, updatedAtIso, attributions } = await getWatchBrowseData()
  const updatedLabel = formatUpdatedAt(updatedAtIso)
  const canonicalUrl = canonicalPublicUrl(BROWSE_PATH)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}${HOME_PATH}` },
      { '@type': 'ListItem', position: 2, name: TITLE, item: canonicalUrl },
    ],
  }

  return (
    <main data-vertical="watch">
      {/* HERO canônico do guia de streaming */}
      <header className="watch-hero">
        <div className="watch-hero__scrim" />
        <div className="watch-hero__inner">
          <h1 className="watch-hero__title">O seu guia de streaming para filmes e séries</h1>
          <p className="watch-hero__sub">
            Descubra onde ver conteúdos novos e populares em streaming com o Cinerie
          </p>
          {providers.length > 0 ? (
            <>
              <div className="watch-hero__kicker">Serviços de streaming no Cinerie</div>
              <div className="watch-hero__services">
                {/* Provedores como TEXTO: logo_allowed=false (licença) */}
                {providers.map((provider) => (
                  <span className="watch-hero__service" key={provider.providerKey}>
                    {provider.providerName}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </header>

      <div className="container">
        {providers.length > 0 ? (
          <section aria-labelledby="watch-popular-title" className="section">
            <div className="eyebrow-bar" data-vertical="series">
              <span aria-hidden="true" className="eyebrow-bar__mark" />
              <h2 className="section-title" id="watch-popular-title">
                <strong>Populares</strong> <span>agora</span>
              </h2>
            </div>
            <WatchPopular
              providers={providers.map((provider) => ({
                providerKey: provider.providerKey,
                providerName: provider.providerName,
                titles: provider.titles.map((title) => ({
                  entityType: title.entityType,
                  title: title.title,
                  href: title.href,
                  posterUrl: title.posterUrl,
                  offerTypes: title.offerTypes,
                })),
              }))}
            />
            {updatedLabel !== null ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 20 }}>
                Atualizado em {updatedLabel}. As ofertas podem mudar conforme região e assinatura.
              </p>
            ) : null}
          </section>
        ) : (
          <EmptyState title="Ainda não há disponibilidade de streaming licenciada para exibir.">
            <p>
              Quando houver ofertas com licença de exibição confirmada, elas aparecem aqui com o
              provedor e a data de atualização.
            </p>
          </EmptyState>
        )}

        {attributions.length > 0 ? (
          <p className="watch-availability__attribution" style={{ marginTop: 32 }}>
            {attributions.map((attribution, index) => (
              <span key={attribution.text}>
                {index > 0 ? ' · ' : null}
                {attribution.url !== null ? (
                  <a href={attribution.url} rel="nofollow noopener" target="_blank">
                    {attribution.text}
                  </a>
                ) : (
                  attribution.text
                )}
              </span>
            ))}
          </p>
        ) : null}

        <AdSlot format="leaderboard" slotId="browse-grid" />

        {/* PARA VOCÊ — composição canônica em estado honesto: recomendações
            personalizadas ainda não existem como serviço (nada de rec fake). */}
        <section aria-labelledby="watch-foryou-title" className="section">
          <div className="eyebrow-bar">
            <span aria-hidden="true" className="eyebrow-bar__mark" />
            <h2 className="section-title" id="watch-foryou-title">
              <strong>Para</strong> <span>você</span>
            </h2>
          </div>
          <EmptyState title="Recomendações personalizadas ainda não estão disponíveis.">
            <p>
              Em breve, esta seção vai se ajustar ao seu histórico. Enquanto isso, explore os
              títulos populares acima ou <a href="/pt/explorar/">navegue pelo Explorar</a>.
            </p>
          </EmptyState>
        </section>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
