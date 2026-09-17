import type { Metadata } from 'next'

import { serializeJsonLd, websiteId } from '@screena/seo'

import { InstitutionalPage } from '../../_components/institutional-page'
import { DATA_CREDITS_PATH } from '../../../src/config/footer'
import { AI_ASSISTED_ARTICLE_NOTE } from '../../../src/lib/editorial-disclosure'
import { GENERAL_CONTACT_EMAIL, PRIVACY_CONTACT_EMAIL } from '../../../src/lib/institutional-facts'
import { trailBreadcrumbJsonLd, type TrailStep } from '../../../src/lib/institutional-trail'
import {
  AUTHORS_INDEX_PATH,
  CONTACT_PATH,
  EDITORIAL_POLICY_PATH,
  SCORE_METHODOLOGY_PATH,
} from '../../../src/lib/routes'
import { SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { socialMetadata } from '../../../src/lib/social-metadata'
import '../../_components/legal.css'

/**
 * Política editorial.
 *
 * AUDITORIA DE SEO (11/09/2026, seção 3.6): a página não existia. Ela descreve o
 * que o LEITOR encontra e o que o sistema garante — e cada garantia tem dono no
 * código:
 *  - a nota de IA é a MESMA do fim da matéria (`AI_ASSISTED_ARTICLE_NOTE`);
 *  - os textos editoriais das fichas são gerados offline a partir do banco,
 *    passam pela verificação de nomes contra o payload e só são exibidos com
 *    status publicável (invariantes 4, 12 e 13);
 *  - notas de terceiros: Termos de Uso, item 4.4, e as regras de rating;
 *  - crédito de fonte no rodapé de toda página (decisão do proprietário de
 *    2026-08-13, travada pelos testes de créditos);
 *  - "Atualizada em" e a página de autor: `formatNewsUpdatedLabel` e
 *    `src/lib/author-presenter.ts`;
 *  - a nota de correção: a matéria a mostra quando a redação registra a
 *    correção no CMS (`buildNewsCorrection`) — a frase só existe porque a nota
 *    existe, e `tests/web/institutional-pages-facts.test.ts` (5) trava o par.
 *
 * `force-dynamic` — motivo (d) de `src/lib/route-cache-policy.ts`: sem banco, mas
 * o robots lê a chave de indexação de RUNTIME.
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Política editorial'
const DESCRIPTION =
  'Como a Cinerie produz notícias e textos editoriais, identifica o uso de inteligência artificial, trata notas de terceiros e recebe apontamentos de erro.'
const TRAIL: readonly TrailStep[] = [{ label: TITLE, href: null }]

export function generateMetadata(): Metadata {
  const canonicalUrl = canonicalPublicUrl(EDITORIAL_POLICY_PATH)
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(true),
    alternates: { canonical: canonicalUrl },
    ...socialMetadata({ type: 'website', title: TITLE, description: DESCRIPTION, canonicalUrl }),
  }
}

export default function EditorialPolicyPage() {
  const canonicalUrl = canonicalPublicUrl(EDITORIAL_POLICY_PATH)

  const pageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
    inLanguage: 'pt-BR',
    isPartOf: { '@id': websiteId(SITE_URL) },
  }

  return (
    <>
      <InstitutionalPage
        lede="O que a Cinerie publica, como publica e o que você pode esperar de cada página."
        title={TITLE}
        trail={TRAIL}
      >
        <h2>O que publicamos</h2>
        <p>
          Notícias sobre cinema e séries, e páginas de obras e de pessoas. As páginas de obras e de
          pessoas reúnem dados de catálogo de fontes identificadas e, quando existem, textos
          editoriais próprios.
        </p>

        <h2>Assinatura e datas</h2>
        <p>
          A assinatura e a data de publicação aparecem no topo da matéria. Quando a matéria é
          alterada em dia posterior ao da publicação, a data da atualização aparece ao lado. A
          página de cada autor, em <a href={AUTHORS_INDEX_PATH}>Autores</a>, reúne as matérias com
          aquela assinatura.
        </p>

        <h2>Inteligência artificial</h2>
        <p>
          Quando uma matéria é produzida com apoio de ferramentas de inteligência artificial, ela
          traz, ao final, a nota: “{AI_ASSISTED_ARTICLE_NOTE}”
        </p>
        <p>
          Os textos editoriais das páginas de obras e de pessoas são redigidos com apoio de
          inteligência artificial fora do site, a partir apenas dos dados do banco da Cinerie. Antes
          de serem salvos, passam por uma verificação automática que aponta qualquer nome que não
          esteja nesses dados; cada versão fica registrada com a origem do texto, e só aparece na
          página depois de aprovada para publicação. Nenhum texto é gerado no momento em que você
          abre a página.
        </p>

        <h2>Notas de outras fontes</h2>
        <p>
          A nota de uma fonte externa aparece sempre identificada, na escala original daquela fonte
          e com o crédito devido. Nunca convertemos a nota de uma fonte para o formato de outra, e
          nunca apresentamos nota de terceiro como se fosse nossa.
        </p>
        <p>
          O Cinerie Score é uma composição dessas notas: nomeia as fontes que o compõem e só aparece
          com pelo menos duas. A conta está em{' '}
          <a href={SCORE_METHODOLOGY_PATH}>Como funciona o Cinerie Score</a>.
        </p>

        <h2>Fontes, imagens e crédito</h2>
        <p>
          O crédito das fontes de dados fica no rodapé de todas as páginas, com o texto que cada
          licença exige, e em <a href={DATA_CREDITS_PATH}>Créditos de dados</a>. Pôsteres, imagens e
          marcas pertencem aos respectivos titulares e aparecem para identificar as obras. Quando a
          imagem de capa de uma matéria tem crédito declarado, ele aparece junto da imagem.
        </p>

        <h2>Onde assistir</h2>
        <p>
          Só indicamos serviços oficiais e licenciados. A disponibilidade de streaming muda sem
          aviso, e por isso a data da última atualização aparece junto das ofertas.
        </p>

        <h2>Erros e pedidos</h2>
        <p>
          Quando a redação corrige uma matéria já publicada, a matéria passa a mostrar uma nota de
          correção, com a data e o texto da correção.
        </p>
        <p>
          Encontrou uma informação errada? Escreva para{' '}
          <a href={`mailto:${GENERAL_CONTACT_EMAIL}`}>{GENERAL_CONTACT_EMAIL}</a> com o endereço da
          página. Pedidos sobre dados pessoais vão para{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a>. Os canais estão
          reunidos em <a href={CONTACT_PATH}>Contato</a>.
        </p>
      </InstitutionalPage>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }}
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
