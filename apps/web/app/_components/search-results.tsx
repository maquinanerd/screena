/**
 * search-results.tsx — O estado COM TERMO de `/pt/explorar/`.
 *
 * O canônico tem duas telas, BROWSE (10) e DISCOVER (11), e elas não são duas
 * páginas: são dois ESTADOS da mesma superfície. Sem termo, a página é
 * navegação (as seções curadas do DISCOVER, indexáveis). Com termo, este bloco
 * aparece no topo e a página vira resultado — e passa a `noindex`, porque
 * resultado de busca é infinito e fino por natureza.
 *
 * TIPO NUNCA SÓ POR FORMATAÇÃO (invariante 11): cada card carrega o rótulo
 * textual da vertical, o atributo de tipo e a URL do segmento correspondente.
 * Notícia vai em seção PRÓPRIA, com título explícito — misturá-la na lista de
 * entidades apagaria a distinção.
 */

import type { ReactNode } from 'react'

import type { SearchPageView } from '../../src/lib/search-presenter'

const KIND_LABEL: Record<string, string> = {
  movie: 'Filme',
  tv: 'Série',
  person: 'Pessoa',
}

export function SearchResults({ view }: { view: SearchPageView }): ReactNode {
  const nothingFound = view.results.length === 0 && view.news.length === 0

  return (
    <section aria-labelledby="explore-results-title" className="disc-section explore-results">
      <div className="disc-section-head">
        <div className="eyebrow-bar">
          <span aria-hidden="true" className="eyebrow-bar__mark" />
          <h2 className="section-title section-title--sm" id="explore-results-title">
            <strong>Resultados</strong> <span>para “{view.query}”</span>
          </h2>
        </div>
        {nothingFound ? null : (
          <span className="disc-note">
            {view.total} resultado{view.total === 1 ? '' : 's'}
            {view.hasMore ? ' (há mais)' : ''}
          </span>
        )}
      </div>

      {nothingFound ? (
        <p className="muted">
          Nada encontrado para “{view.query}”. Continue pelas seções abaixo.
        </p>
      ) : null}

      {view.results.length > 0 ? (
        <div className="explore-results__grid">
          {view.results.map((result) => (
            <a
              className="explore-result"
              data-entity-type={result.kind}
              href={result.href}
              key={`${result.kind}:${result.entityId}`}
            >
              <span className="explore-result__thumb">
                {result.imageUrl !== null ? (
                  <img alt="" loading="lazy" src={result.imageUrl} />
                ) : null}
                <span className="explore-result__kind">{KIND_LABEL[result.kind] ?? 'Título'}</span>
              </span>
              <span className="explore-result__title">{result.title}</span>
              <span className="explore-result__meta">
                {[result.subtitle, result.year === null ? null : String(result.year)]
                  .filter((part): part is string => part !== null && part !== '')
                  .join(' · ')}
              </span>
            </a>
          ))}
        </div>
      ) : null}

      {view.news.length > 0 ? (
        <div className="explore-results__news">
          <h3 className="explore-results__news-title">Notícias</h3>
          <ul>
            {view.news.map((item) => (
              <li key={`article:${item.articleId}`}>
                <a href={item.href}>{item.title}</a>
                {item.subtitle !== null ? (
                  <span className="explore-results__news-sub">{item.subtitle}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
