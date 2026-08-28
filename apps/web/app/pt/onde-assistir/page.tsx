import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../_components/ad-slot'
import { EmptyState } from '../../_components/ds'
import { SectionBoundary } from '../../_components/section-boundary'
import { WatchPopular } from '../../_components/watch-popular'
import { decideRouteSection } from '../../../src/lib/section-absence'
import { groupBrowseProvidersByBrand } from '../../../src/lib/watch-browse-brands'
import { HOME_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { getWatchBrowseData } from '../../../src/server/watch-browse'

/**
 * Onde assistir — tela 10 do canônico, estrutura EXATA: HERO escuro centrado
 * ("O seu guia de streaming...", sub, kicker "Serviços de streaming" e fileira
 * de MARCAS como TEXTO — logo_allowed=false, licença) → POPULARES AGORA (tabs
 * reais por MARCA + grade de posters, ordenada pelo sinal técnico de
 * popularidade) → Ad → "PARA VOCÊ", que NÃO renderiza.
 *
 * AGRUPAMENTO POR MARCA. A decomposição marca/variante/canal é DECLARADA em
 * `@screena/public-contracts`, nunca derivada da string do nome. Sem ela, os 24
 * provedores BR fazem "Paramount Plus", "Paramount Plus Premium" e "Paramount+
 * Amazon Channel" aparecerem como três serviços diferentes — e a mesma página
 * passa a contar duas histórias, porque o painel da página de título já agrupa
 * desde 2026-08-19.
 *
 * "PARA VOCÊ" NÃO RENDERIZA. Não existe serviço de recomendação exposto ao app
 * público: a seção não pode ter sucesso para ninguém, nem logado. Uma caixa que
 * só sabe dizer "ainda não" gasta a atenção do leitor à toa — mesma regra da
 * faixa de newsletter. A ausência vai para o log, nunca fica muda.
 *
 * Só oferta com licença vigente e crédito devido (invariante 6); carimbo
 * "Atualizado em" sempre presente quando há dado.
 */

/**
 * `force-dynamic` — E DELIBERADO, e o motivo NAO e mais "ninguem pensou nisso".
 *
 * ============================================================================
 * POR QUE ESTA ROTA NAO PODE TER CACHE DE ROTA (ISR), MEDIDO
 * ============================================================================
 * Trocar isto por `export const revalidate = N` torna a rota elegivel a
 * prerender — e o Next prerenderiza caminho FIXO no `next build`. O release
 * (`Dockerfile`, linha do `pnpm --filter @screena/web build`) roda o build SEM
 * `DATABASE_URL` e sem env publica, de proposito (ver o bloco de comentario la:
 * env assada no build ja causou dois furos de fail-open). Tentado nesta leva:
 *
 *   Error occurred prerendering page "/pt/filmes"
 *   PrismaClientInitializationError: Environment variable not found: DATABASE_URL
 *   Export encountered an error on /pt/filmes/page, exiting the build.
 *
 * As rotas de FICHA (`/pt/filmes/[slug]` e irmas) nao tem esse problema: elas
 * declaram `generateStaticParams` devolvendo `[]`, entao nada e prerenderizado
 * no build e cada URL e gerada na primeira visita — la o ISR esta ligado de
 * verdade nesta leva.
 *
 * O QUE SUBSTITUI O CACHE DE ROTA AQUI: (1) as consultas deixaram de varrer o
 * catalogo inteiro (ver `src/server/entity-indexes.ts` e `src/server/home-hero.ts`)
 * e (2) o snapshot desta superficie e memoizado entre requisicoes por
 * `src/server/surface-cache.ts`. O cabecalho continua `no-store` — e ele e
 * CONSEQUENCIA da rota ser dinamica, nao uma linha nossa.
 *
 * PARA O DONO: dar cache de rota a esta pagina exige um build com banco
 * alcancavel (ou um passo de prerender pos-deploy). E decisao de deploy, nao de
 * codigo — esta registrada em `src/lib/route-cache-policy.ts`.
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
  // `attributions` continua sendo resolvido por `getWatchBrowseData` (é
  // procedência das ofertas), mas a página não o desestrutura mais: desde
  // 2026-08-13 o crédito de fonte vive só no rodapé global.
  const { providers, updatedAtIso } = await getWatchBrowseData()
  const updatedLabel = formatUpdatedAt(updatedAtIso)
  const canonicalUrl = canonicalPublicUrl(BROWSE_PATH)

  // AGRUPAMENTO POR MARCA — a mesma decisão que já vale na página de título.
  const brands = groupBrowseProvidersByBrand(providers, {
    titleKey: (title) => `${title.entityType}:${title.href}`,
  })

  // "Para você": buraco de ROTA (não de título), então o log carrega a rota.
  const forYouSection = decideRouteSection<never>(null, {
    section: 'para-voce',
    reason: 'no_recommendation_service',
    route: BROWSE_PATH,
    vertical: 'mixed',
  })

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
                {/* MARCAS como TEXTO: logo_allowed=false (licença). Uma entrada
                    por marca, com as rotas embaixo — a rota diz o que o leitor
                    precisa contratar, e somê-la esconderia um custo. */}
                {brands.map((brand) => (
                  <span className="watch-hero__service" key={brand.key}>
                    <span className="watch-hero__service-name">{brand.name}</span>
                    {brand.routes.length > 1 ? (
                      <span className="watch-hero__service-routes">
                        {brand.routes
                          .map((route) => route.label)
                          .filter((label): label is string => label !== null)
                          .join(' · ')}
                      </span>
                    ) : null}
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
              brands={brands.map((brand) => ({
                key: brand.key,
                name: brand.name,
                routes: brand.routes.map((route) => ({
                  providerName: route.providerName,
                  label: route.label,
                })),
                titles: brand.titles.map((title) => ({
                  entityType: title.entityType,
                  title: title.title,
                  href: title.href,
                  posterUrl: title.posterUrl,
                  offerTypeLabels: title.offerTypeLabels,
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

        {/* O crédito das origens de disponibilidade saiu daqui em 2026-08-13
            (decisão do proprietário) e vive no rodapé global. `attributions`
            continua sendo resolvido por `getWatchBrowseData` como procedência —
            ver `watch-availability-panel.tsx`. */}

        <AdSlot format="leaderboard" slotId="browse-grid" />

        {/* PARA VOCÊ — não renderiza. A seção não pode ter sucesso para
            ninguém (não existe serviço de recomendação), e uma caixa que só
            sabe dizer "ainda não" gasta a atenção do leitor à toa. Mesma regra
            da faixa de newsletter. A ausência NÃO é muda: o boundary loga. */}
        <SectionBoundary decision={forYouSection} once>
          {() => null}
        </SectionBoundary>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
