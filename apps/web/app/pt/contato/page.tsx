import type { Metadata } from 'next'

import { organizationId, publicHomeUrl, serializeJsonLd, websiteId } from '@screena/seo'

import { InstitutionalPage } from '../../_components/institutional-page'
import {
  GENERAL_CONTACT_EMAIL,
  PRIVACY_CONTACT_EMAIL,
  SITE_CONTROLLER,
} from '../../../src/lib/institutional-facts'
import { trailBreadcrumbJsonLd, type TrailStep } from '../../../src/lib/institutional-trail'
import { CONTACT_PATH, PRIVACY_PATH } from '../../../src/lib/routes'
import { SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { socialMetadata } from '../../../src/lib/social-metadata'
import '../../_components/legal.css'

/**
 * Contato.
 *
 * AUDITORIA DE SEO (11/09/2026, seção 3.6): a página não existia. Os canais e a
 * identificação do responsável são os que o controlador já publicou nos Termos de
 * Uso (item 12) e na Política de Privacidade (item 1) — `src/lib/institutional-facts.ts`
 * os centraliza e um teste reprova se algum deixar de constar lá. Sem telefone e
 * sem endereço de rua: o controlador não publicou nenhum dos dois.
 *
 * DEPENDÊNCIA EXTERNA: as caixas precisam receber e-mail (ver
 * `docs/seo/SEO-INFRA-CHANGES-2026-09-11.md`).
 *
 * `force-dynamic` — motivo (d) de `src/lib/route-cache-policy.ts`: sem banco, mas
 * o robots lê a chave de indexação de RUNTIME.
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Contato'
const META_TITLE = 'Contato da Cinerie'
const DESCRIPTION =
  'Os canais de contato da Cinerie — dúvidas gerais, erros de informação e pedidos sobre dados pessoais — e quem responde pelo site.'
const TRAIL: readonly TrailStep[] = [{ label: TITLE, href: null }]

export function generateMetadata(): Metadata {
  const canonicalUrl = canonicalPublicUrl(CONTACT_PATH)
  return {
    title: META_TITLE,
    description: DESCRIPTION,
    robots: publicRobots(true),
    alternates: { canonical: canonicalUrl },
    ...socialMetadata({
      type: 'website',
      title: META_TITLE,
      description: DESCRIPTION,
      canonicalUrl,
    }),
  }
}

export default function ContactPage() {
  const canonicalUrl = canonicalPublicUrl(CONTACT_PATH)

  const contactJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: META_TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
    inLanguage: 'pt-BR',
    isPartOf: { '@id': websiteId(SITE_URL) },
    // O MESMO nó `Organization` da home (`@id`), acrescido dos canais que esta
    // página mostra.
    mainEntity: {
      '@type': 'Organization',
      '@id': organizationId(SITE_URL),
      name: 'Cinerie',
      url: publicHomeUrl(SITE_URL),
      contactPoint: [
        {
          '@type': 'ContactPoint',
          contactType: 'dúvidas gerais e erros de informação',
          email: GENERAL_CONTACT_EMAIL,
          availableLanguage: 'pt-BR',
        },
        {
          '@type': 'ContactPoint',
          contactType: 'privacidade e dados pessoais',
          email: PRIVACY_CONTACT_EMAIL,
          availableLanguage: 'pt-BR',
        },
      ],
    },
  }

  return (
    <>
      <InstitutionalPage
        lede="A Cinerie atende por e-mail. Escolha o endereço pelo assunto."
        title={TITLE}
        trail={TRAIL}
      >
        <h2>Dúvidas gerais e erros de informação</h2>
        <p>
          <a href={`mailto:${GENERAL_CONTACT_EMAIL}`}>{GENERAL_CONTACT_EMAIL}</a>
        </p>
        <p>
          Para apontar um erro, inclua o endereço da página e o que está incorreto. Para outros
          assuntos — inclusive pedidos de titulares de direitos sobre imagens, textos ou marcas
          exibidos no site —, use o mesmo endereço.
        </p>

        <h2>Privacidade e dados pessoais</h2>
        <p>
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a>
        </p>
        <p>
          Pedidos sobre dados pessoais e o exercício dos direitos previstos na Lei Geral de Proteção
          de Dados Pessoais. Os prazos e o procedimento estão no item 1 da{' '}
          <a href={PRIVACY_PATH}>Política de Privacidade</a>.
        </p>

        <h2>Quem responde pela Cinerie</h2>
        <p>
          {SITE_CONTROLLER.name}
          <br />
          Nome fantasia: {SITE_CONTROLLER.tradeName}
          <br />
          CNPJ: {SITE_CONTROLLER.cnpj}
          <br />
          Sede: {SITE_CONTROLLER.seat}
        </p>
      </InstitutionalPage>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(contactJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(trailBreadcrumbJsonLd(TRAIL, SITE_URL, canonicalUrl)),
        }}
      />
    </>
  )
}
