import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { serializeJsonLd } from '@screena/seo'

import { DATA_CREDITS, DATA_CREDITS_PATH, TMDB_DISCLAIMER } from '../../../src/config/footer'
import { HOME_PATH } from '../../../src/lib/routes'
import { SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'

/**
 * Créditos de dados — o destino do link "Créditos de dados" do rodapé
 * (FOOTER-SPEC.md §5).
 *
 * Desde 2026-08-13 o crédito de fonte não vive mais colado ao dado: ele vive no
 * rodapé global. O rodapé cabe numa faixa; esta página é onde a mesma lista
 * respira — cada fonte, o texto verbatim da licença, e o que ela alimenta.
 *
 * ============================================================================
 * A LISTA NÃO É ESCRITA AQUI
 * ============================================================================
 * `DATA_CREDITS` é derivado de `services/legal/src/authorization-spec.ts`, o
 * mesmo registro que materializa `source_licenses`. Esta página não conhece o
 * nome de nenhuma fonte, e é por isso que ela não pode ficar desatualizada:
 * registrar uma licença nova faz a fonte aparecer aqui e no rodapé, sem editar
 * nenhum dos dois.
 *
 * ============================================================================
 * POR QUE NÃO HÁ "LINK DO SITE" NEM "LINK DOS TERMOS" POR FONTE
 * ============================================================================
 * A spec §5 pede os dois. O registro legal não os tem: `LicenseTarget` guarda
 * `attributionText`, e `apply.ts` não escreve `terms_url`. Escrever aqui uma
 * URL que a licença não declara seria inventar procedência — a mesma classe de
 * defeito que fez a premiação da OMDb nascer sem crédito automático.
 *
 * O LINKBACK, quando a licença o exige, viaja com o próprio dado
 * (`attribution_url` da linha) e é gate de exibição: nota ou oferta sem ele não
 * chega à tela. Ele não depende desta página.
 */

const TITLE = 'Créditos de dados'
const DESCRIPTION =
  'As fontes de dados que a Cinerie exibe, com o crédito exigido por cada licença ' +
  'e o que cada uma fornece.'

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(true),
    alternates: { canonical: canonicalPublicUrl(DATA_CREDITS_PATH) },
  }
}

export default function CreditosDeDadosPage(): ReactNode {
  const canonicalUrl = canonicalPublicUrl(DATA_CREDITS_PATH)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}${HOME_PATH}` },
      { '@type': 'ListItem', position: 2, name: TITLE, item: canonicalUrl },
    ],
  }

  return (
    <>
      <main data-vertical="legal">
        <div className="container" style={{ paddingTop: 36 }}>
          <nav aria-label="Trilha de navegação" className="breadcrumb">
            <ol>
              <li>
                <a href={HOME_PATH}>Início</a>
              </li>
              <li aria-current="page">{TITLE}</li>
            </ol>
          </nav>
        </div>

        <article className="legal-body">
          <header className="legal-head">
            <h1 className="legal-title">{TITLE}</h1>
          </header>

          <p>
            A Cinerie exibe dados de fontes terceiras autorizadas. Cada fonte abaixo tem
            uma licença registrada, e o crédito reproduzido é o texto exigido por ela —
            não uma descrição nossa.
          </p>

          {/* Exigência dos termos da API do TMDB, repetida em destaque (spec §5).
              Sai da própria licença, nunca de um literal desta página. */}
          <p>
            <strong>{TMDB_DISCLAIMER}</strong>
          </p>

          <h2>Fontes e créditos</h2>
          <dl className="data-credits">
            {DATA_CREDITS.map((credit) => (
              <div className="data-credits__row" key={credit.creditKey}>
                <dt>{credit.text}</dt>
                <dd>{credit.roleLabel}</dd>
              </div>
            ))}
          </dl>

          <h2>Sobre a disponibilidade de streaming</h2>
          <p>
            As ofertas de "onde assistir" variam por região e por acordo comercial, e
            podem estar defasadas em relação à plataforma. A data do último sincronismo
            confiável aparece junto do painel de disponibilidade. Para a informação
            definitiva, consulte o serviço correspondente.
          </p>

          <h2>Marcas e imagens</h2>
          <p>
            Imagens, pôsteres, logotipos e marcas pertencem aos respectivos titulares. A
            Cinerie credita cada fonte em texto e não reproduz a marca gráfica de
            terceiros: as licenças registradas não autorizam o uso de logotipo.
          </p>
          <p>
            A presença de uma fonte, marca, produto ou serviço na Cinerie não implica
            parceria, afiliação, certificação ou endosso, salvo quando expressamente
            indicado.
          </p>
        </article>
      </main>

      <script
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
        type="application/ld+json"
      />
    </>
  )
}
