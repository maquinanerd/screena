import type { Metadata } from 'next'

import { canonicalPublicUrl } from '../../../src/lib/site'
import { getSearchPageData } from '../../../src/server/search-page'

/**
 * Busca publica TECNICA: shell minimo (form GET + lista de resultados), sem
 * trabalho de design. Le apenas PostgreSQL via getter server-only (invariantes
 * 3 e 4: zero API externa, zero Gemini no render).
 *
 * SEO: pagina de busca NUNCA e indexada (robots noindex,nofollow) e o canonical
 * aponta sempre para a rota BASE, sem o termo — combinacoes de query nao viram
 * URLs canonicas nem entram em sitemap.
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Busca'
const DESCRIPTION = 'Busque filmes, series e pessoas ja publicados na Cinerie.'
const SEARCH_PATH = '/pt/busca/'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  alternates: { canonical: canonicalPublicUrl(SEARCH_PATH) },
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const view = await getSearchPageData(q ?? '')

  return (
    <main data-vertical="search">
      <div className="container">
        <header>
          <h1>{TITLE}</h1>
        </header>

        <form method="get" action={SEARCH_PATH} role="search">
          <label htmlFor="search-term">Termo</label>
          <input id="search-term" name="q" type="search" defaultValue={view.query} />
          <button type="submit">Buscar</button>
        </form>

        {view.isEmptyQuery ? (
          <p>Digite um termo para buscar filmes, series, pessoas e noticias.</p>
        ) : view.results.length === 0 && view.news.length === 0 ? (
          <p>Nenhum resultado para &ldquo;{view.query}&rdquo;.</p>
        ) : (
          <>
            {view.results.length > 0 ? (
              <section aria-labelledby="search-results-title">
                <h2 id="search-results-title">Resultados</h2>
                <p>
                  {view.total} resultado{view.total === 1 ? '' : 's'}
                  {view.hasMore ? ' (ha mais)' : ''}
                </p>
                <ul>
                  {view.results.map((result) => (
                    <li key={`${result.kind}:${result.entityId}`}>
                      <a href={result.href}>{result.title}</a>
                      {result.subtitle !== null ? <span> — {result.subtitle}</span> : null}
                      {result.year !== null ? <span> ({result.year})</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/*
              Noticias em SECAO PROPRIA, com titulo explicito. Misturar artigo na
              lista de entidades apagaria a distincao de tipo — que nunca pode
              depender so de formatacao (invariante 11).
            */}
            {view.news.length > 0 ? (
              <section aria-labelledby="search-news-title">
                <h2 id="search-news-title">Noticias</h2>
                <ul>
                  {view.news.map((item) => (
                    <li key={`article:${item.articleId}`}>
                      <a href={item.href}>{item.title}</a>
                      {item.subtitle !== null ? <span> — {item.subtitle}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  )
}
