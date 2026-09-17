import type { ReactNode } from 'react'

import { HOME_PATH, MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SERIES_INDEX_PATH } from '../src/lib/routes'

/**
 * 404 da Cinerie — em pt-BR, com H1 e caminho de volta.
 *
 * O DEFEITO (auditoria de SEO, 11/09/2026): sem este arquivo, a ficha inexistente
 * saia sem H1, e o 404 generico era o texto padrao do Next, em ingles, num site em
 * pt-BR. O `lang="pt-BR"` vem do layout raiz, que envolve esta pagina junto com o
 * cabecalho e o rodape.
 *
 * Sem `robots` e sem canonical aqui, de proposito: a resposta continua com status
 * 404, e o Next ja marca a pagina nao encontrada como `noindex`. Esta pagina muda o
 * que o LEITOR ve, nao o que o buscador indexa.
 */
export default function NotFound(): ReactNode {
  return (
    <main className="entity-index" data-vertical="home">
      <div className="container">
        <header className="compact-hero page-header">
          <p className="compact-hero__eyebrow">Erro 404</p>
          <h1>Página não encontrada</h1>
          <p>O endereço pode ter mudado, ou esta página não existe na Cinerie.</p>
        </header>
        <p>
          <a href={HOME_PATH}>Voltar ao início</a> · <a href={MOVIES_INDEX_PATH}>Filmes</a> ·{' '}
          <a href={SERIES_INDEX_PATH}>Séries</a> · <a href={NEWS_INDEX_PATH}>Notícias</a>
        </p>
      </div>
    </main>
  )
}
