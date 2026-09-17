import type { Metadata } from 'next'

import { organizationId, serializeJsonLd, websiteId } from '@screena/seo'

import { InstitutionalPage } from '../../_components/institutional-page'
import { DATA_CREDITS_PATH } from '../../../src/config/footer'
import { SITE_CONTROLLER } from '../../../src/lib/institutional-facts'
import { trailBreadcrumbJsonLd, type TrailStep } from '../../../src/lib/institutional-trail'
import {
  ABOUT_PATH,
  AUTHORS_INDEX_PATH,
  CONTACT_PATH,
  EDITORIAL_POLICY_PATH,
  PRIVACY_PATH,
  SCORE_METHODOLOGY_PATH,
  TERMS_PATH,
} from '../../../src/lib/routes'
import { SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { socialMetadata } from '../../../src/lib/social-metadata'

/**
 * Sobre a Cinerie.
 *
 * AUDITORIA DE SEO (11/09/2026, seção 3.6): a página não existia. Cada frase aqui
 * repete um fato que o produto sustenta — o texto do controlador nos Termos de Uso
 * (itens 1, 4 e 12), o registro de licenças que alimenta os Créditos de dados e as
 * invariantes de render. Nenhuma equipe, audiência, prêmio ou parceria.
 *
 * `force-dynamic` — motivo (d) de `src/lib/route-cache-policy.ts`: sem banco, mas
 * o robots lê a chave de indexação de RUNTIME.
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Sobre a Cinerie'
const DESCRIPTION =
  'O que é a Cinerie, de onde vêm os dados de filmes, séries e pessoas, como o conteúdo editorial é feito e quem responde pelo site.'
const TRAIL: readonly TrailStep[] = [{ label: 'Sobre', href: null }]

export function generateMetadata(): Metadata {
  const canonicalUrl = canonicalPublicUrl(ABOUT_PATH)
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(true),
    alternates: { canonical: canonicalUrl },
    ...socialMetadata({ type: 'website', title: TITLE, description: DESCRIPTION, canonicalUrl }),
  }
}

export default function AboutPage() {
  const canonicalUrl = canonicalPublicUrl(ABOUT_PATH)

  const aboutJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
    inLanguage: 'pt-BR',
    isPartOf: { '@id': websiteId(SITE_URL) },
    // O MESMO nó `Organization` da home — por `@id`, sem repetir campos.
    about: { '@id': organizationId(SITE_URL) },
  }

  return (
    <>
      <InstitutionalPage
        lede="A Cinerie é uma base de consulta sobre entretenimento em português: filmes, séries, temporadas, episódios e pessoas, com notícias e conteúdo editorial próprio."
        title={TITLE}
        trail={TRAIL}
      >
        <h2>O que você encontra aqui</h2>
        <p>
          Cada página gira em torno de uma obra ou de uma pessoa: ficha técnica, elenco, imagens e,
          quando há oferta licenciada, onde assistir de forma legal. As notícias tratam de cinema e
          séries.
        </p>
        <p>
          O serviço é gratuito e não exige conta para consultar o catálogo. A conta existe para
          funções pessoais, como marcar o que você assistiu, acompanhar o progresso de séries e
          montar listas.
        </p>

        <h2>O que a Cinerie não faz</h2>
        <p>
          A Cinerie não exibe, hospeda nem transmite filmes ou séries — não é um serviço de
          streaming. Quando indica onde assistir, aponta apenas para serviços oficiais e
          licenciados, e nunca para torrent, IPTV irregular, player pirata ou download não
          autorizado.
        </p>

        <h2>De onde vêm os dados</h2>
        <p>
          Parte das informações de catálogo — títulos, sinopses, datas, créditos, elenco, pôsteres
          e imagens — vem do TMDB (The Movie Database). Notas de outras fontes aparecem sempre
          identificadas, na escala original de cada uma e com o crédito devido.
        </p>
        <p>
          As páginas são montadas a partir do banco de dados da própria Cinerie, atualizado por
          rotinas de sincronização; as imagens de catálogo são carregadas dos servidores do TMDB. A
          lista das fontes, com o crédito que cada licença exige, está em{' '}
          <a href={DATA_CREDITS_PATH}>Créditos de dados</a>.
        </p>

        <h2>Conteúdo editorial</h2>
        <p>
          Como as notícias e os textos editoriais são produzidos, e como o uso de inteligência
          artificial é identificado, está na <a href={EDITORIAL_POLICY_PATH}>Política editorial</a>.
          Quem assina as matérias está em <a href={AUTHORS_INDEX_PATH}>Autores</a>.
        </p>
        <p>
          O número de 0 a 100 que aparece em algumas fichas é o Cinerie Score; a conta dele está em{' '}
          <a href={SCORE_METHODOLOGY_PATH}>Como funciona o Cinerie Score</a>.
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
        <p>
          Os canais de contato estão em <a href={CONTACT_PATH}>Contato</a>. O uso do site é regido
          pelos <a href={TERMS_PATH}>Termos de Uso</a> e pela{' '}
          <a href={PRIVACY_PATH}>Política de Privacidade</a>.
        </p>
      </InstitutionalPage>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(aboutJsonLd) }}
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
