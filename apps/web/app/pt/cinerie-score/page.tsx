import type { Metadata } from 'next'

import { serializeJsonLd, websiteId } from '@screena/seo'

import { InstitutionalPage } from '../../_components/institutional-page'
import { DATA_CREDITS_PATH } from '../../../src/config/footer'
import {
  SCORE_EXAMPLE,
  SCORE_FORMULA_APPROVED_ON,
  SCORE_FORMULA_VERSION,
  SCORE_IMDB_WEIGHT,
  SCORE_MINIMUM_SOURCES,
  SCORE_SCALE,
  SCORE_TMDB_MINIMUM_VOTES,
  SCORE_TMDB_WEIGHT,
  formatScoreCount,
  formatScoreDecimal,
  scoreExampleSteps,
} from '../../../src/lib/cinerie-score-methodology'
import { trailBreadcrumbJsonLd, type TrailStep } from '../../../src/lib/institutional-trail'
import { EDITORIAL_POLICY_PATH, SCORE_METHODOLOGY_PATH } from '../../../src/lib/routes'
import { SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { socialMetadata } from '../../../src/lib/social-metadata'

/**
 * Como funciona o Cinerie Score — a conta inteira, com os números da fórmula
 * vigente.
 *
 * AUDITORIA DE SEO (11/09/2026, seção 3.6): o número aparecia nas fichas sem
 * página que dissesse como ele é feito. Os números desta página vêm de
 * `src/lib/cinerie-score-methodology.ts`, que um teste confere contra a própria
 * fórmula — esta página não descreve conta que o cálculo não faz.
 *
 * `force-dynamic` — motivo (d) de `src/lib/route-cache-policy.ts`: sem banco, mas
 * o robots lê a chave de indexação de RUNTIME.
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Como funciona o Cinerie Score'
const DESCRIPTION =
  'O Cinerie Score vai de 0 a 100 e resume notas de crítica e de público de fontes identificadas. Veja as fontes, os pesos e quando ele aparece.'
const TRAIL: readonly TrailStep[] = [{ label: 'Cinerie Score', href: null }]

export function generateMetadata(): Metadata {
  const canonicalUrl = canonicalPublicUrl(SCORE_METHODOLOGY_PATH)
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(true),
    alternates: { canonical: canonicalUrl },
    ...socialMetadata({ type: 'website', title: TITLE, description: DESCRIPTION, canonicalUrl }),
  }
}

export default function CinerieScoreMethodologyPage() {
  const canonicalUrl = canonicalPublicUrl(SCORE_METHODOLOGY_PATH)
  const steps = scoreExampleSteps()

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
        lede={`O Cinerie Score é um número de 0 a ${SCORE_SCALE} que resume, numa escala só, notas públicas de crítica e de público. Ele não é uma nota dada pela Cinerie e não substitui as notas das fontes: elas continuam na página, cada uma na sua escala e com o seu crédito.`}
        title={TITLE}
        trail={TRAIL}
      >
        <h2>As fontes</h2>
        <p>Entram quatro fontes, e cada nota é levada para a escala de 0 a {SCORE_SCALE}:</p>
        <ul>
          <li>
            <strong>Rotten Tomatoes</strong> — a nota da crítica, de 0 a 100, entra como está.
          </li>
          <li>
            <strong>Metacritic</strong> — de 0 a 100, entra como está.
          </li>
          <li>
            <strong>IMDb</strong> — de 0 a 10, multiplicada por 10.
          </li>
          <li>
            <strong>TMDB</strong> — de 0 a 10, multiplicada por 10, e só quando tem pelo menos{' '}
            {SCORE_TMDB_MINIMUM_VOTES} votos.
          </li>
        </ul>
        <p>
          A nota de público do Rotten Tomatoes não entra. O crédito de cada fonte está no rodapé
          de todas as páginas e em <a href={DATA_CREDITS_PATH}>Créditos de dados</a>.
        </p>

        <h2>Crítica e público</h2>
        <p>As notas formam dois grupos:</p>
        <ul>
          <li>
            <strong>Crítica</strong>: a média simples das notas disponíveis entre Rotten Tomatoes e
            Metacritic.
          </li>
          <li>
            <strong>Público</strong>: a média ponderada das notas disponíveis entre IMDb (peso{' '}
            {SCORE_IMDB_WEIGHT}) e TMDB (peso {SCORE_TMDB_WEIGHT}).
          </li>
        </ul>
        <p>
          Com os dois grupos, o Cinerie Score é metade crítica e metade público. Com um grupo só, é
          esse grupo. O resultado é arredondado para um número inteiro.
        </p>

        <h2>Por que esses pesos</h2>
        <p>
          O IMDb pesa três vezes o TMDB no grupo de público porque reúne uma amostra de votos muito
          maior. Crítica e público pesam o mesmo porque nenhum dos dois, sozinho, conta a história
          inteira: só a crítica se afasta do que o público vive, e só o público vira termômetro de
          bilheteria.
        </p>

        <h2>Quando ele aparece</h2>
        <p>
          Só com pelo menos {SCORE_MINIMUM_SOURCES} fontes contadas. Com uma fonte só não há
          composição — o número seria a nota de um terceiro com outro nome —, e o Cinerie Score não
          aparece.
        </p>
        <p>
          Abaixo do número, a página diz de quantas fontes ele foi composto e quais são, por
          exemplo: “Composto de 3 fontes: IMDb, Rotten Tomatoes e Metacritic.”
        </p>

        <h2>Um exemplo</h2>
        <p>Com números hipotéticos, só para mostrar a conta:</p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Fonte</th>
                <th scope="col">Grupo</th>
                <th scope="col">Nota na fonte</th>
                <th scope="col">De 0 a 100</th>
              </tr>
            </thead>
            <tbody>
              {SCORE_EXAMPLE.ratings.map((rating) => (
                <tr key={rating.source}>
                  <td>{rating.label}</td>
                  <td>{rating.group === 'critics' ? 'Crítica' : 'Público'}</td>
                  <td>
                    {formatScoreDecimal(rating.value)} de {rating.best}
                    {rating.count !== null ? ` (${formatScoreCount(rating.count)} votos)` : null}
                  </td>
                  <td>{formatScoreDecimal(rating.normalized)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul>
          <li>Crítica: {steps.critics}</li>
          <li>Público: {steps.audience}</li>
          <li>Cinerie Score: {steps.value}</li>
        </ul>

        <h2>Versão</h2>
        <p>
          Esta é a fórmula {SCORE_FORMULA_VERSION}, aprovada em {SCORE_FORMULA_APPROVED_ON}. Cada
          cálculo guarda a versão da fórmula que o produziu, e uma fórmula diferente ganha versão
          nova. O Cinerie Score é calculado fora do site, a partir das notas guardadas no banco da
          Cinerie — nunca no momento em que a página abre.
        </p>
        <p>
          Como a Cinerie trata notas de terceiros e o conteúdo editorial está na{' '}
          <a href={EDITORIAL_POLICY_PATH}>Política editorial</a>.
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
