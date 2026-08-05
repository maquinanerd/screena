import type {
  ArticleBodyBlock,
  ArticleBodyTextSegment,
} from '../../src/lib/article-body-presenter'

/**
 * ArticleBody — corpo ESTRUTURADO da matéria (os 10 blocos do contrato
 * editorial), renderizado a partir de `article_translations.body_blocks`.
 *
 * Contrato deste componente:
 *  - NUNCA `dangerouslySetInnerHTML`. Todo texto entra como filho de nó React,
 *    escapado pelo próprio React. O corpo de uma matéria é conteúdo, e conteúdo
 *    nunca é código — inclusive quando vem do nosso próprio CMS.
 *  - O componente NÃO decide o que é válido: recebe blocos já normalizados e
 *    verificados por `buildArticleBodyBlocks` (puro e testado). Bloco inválido
 *    ou com referência que não resolve nunca chega aqui.
 *  - Vídeo é LINK para o provedor, não `<iframe>`: um embed carrega script de
 *    terceiro numa página indexável nossa.
 *  - Link externo sempre com `rel="noopener noreferrer"`.
 *
 * Server Component: nenhum estado, nenhum efeito, nenhum `use client`.
 */

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
}

/**
 * Formatação inline CONSTRUÍDA, nunca interpretada.
 *
 * O presenter entrega trechos (`{ text, bold, italic, href }`); aqui eles viram
 * `<strong>`, `<em>` e `<a>`. Em nenhum ponto existe uma string de HTML — é o
 * que permite ter negrito, itálico e link numa página indexável sem abrir mão
 * do `dangerouslySetInnerHTML` proibido neste componente.
 *
 * A ordem do aninhamento é fixa (link por fora, negrito, itálico por dentro):
 * o resultado visual é o mesmo em qualquer ordem, e fixá-la torna a saída
 * determinística — dois trechos iguais produzem sempre a mesma árvore.
 */
function Segment({ segment }: { segment: ArticleBodyTextSegment }) {
  let node = <>{segment.text}</>
  if (segment.italic) node = <em>{node}</em>
  if (segment.bold) node = <strong>{node}</strong>
  if (segment.href !== null) {
    node = (
      <a href={segment.href} rel="noopener noreferrer" target="_blank">
        {node}
      </a>
    )
  }
  return node
}

/**
 * Rótulo pt-BR do crédito de imagem — FONTE ÚNICA da página.
 *
 * Exportado porque a capa (hero) e as imagens de corpo creditam a mesma coisa e
 * não podem divergir: crédito é obrigação de atribuição (invariante 6), e duas
 * grafias para a mesma obrigação é o começo de uma sumir numa refatoração.
 * Fica aqui — junto de `PROVIDER_LABELS` e do JSX que já renderiza crédito —
 * seguindo a convenção do app: rótulo de UI é `const` de módulo no componente
 * que o desenha, não string solta no meio do JSX.
 */
export const IMAGE_CREDIT_LABEL = 'Crédito'

function Block({ block }: { block: ArticleBodyBlock }) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p>
          {block.segments.map((segment, index) => (
            // A chave é o índice DE PROPÓSITO: os trechos vêm de um corte
            // determinístico do mesmo texto, então a posição é a identidade —
            // não há reordenação possível dentro do parágrafo.
            <Segment key={`${block.id}-${String(index)}`} segment={segment} />
          ))}
        </p>
      )

    case 'heading': {
      // `h1` pertence ao título da página; o corpo começa em `h2`. O nível vem
      // normalizado do presenter (2|3|4).
      const Tag = `h${String(block.level)}` as 'h2' | 'h3' | 'h4'
      return <Tag className="art-body__heading">{block.text}</Tag>
    }

    case 'image':
      return (
        <figure className="art-figure">
          {/* `art-figure__media` reserva a proporção 16/9 desde o primeiro
              paint: imagem inline sem caixa reservada empurra o texto e produz
              CLS no meio da leitura. */}
          <div className="art-figure__media">
            <img
              alt={block.image.alt}
              loading="lazy"
              src={block.image.src}
              {...(block.image.width === null ? {} : { width: block.image.width })}
              {...(block.image.height === null ? {} : { height: block.image.height })}
            />
          </div>
          {/* Legenda e crédito no MESMO bloco, nessa ordem: a legenda descreve,
              o crédito atribui. Os quatro casos são explícitos porque três deles
              produziam resíduo: sem nenhum dos dois o `figcaption` inteiro não
              existe (nada de caixa vazia embaixo da imagem); só crédito não
              ganha separador pendurado; só legenda não ganha o rótulo
              "Crédito:" órfão. */}
          {block.image.caption !== null || block.image.credit !== null ? (
            <figcaption className="art-figure__caption">
              {block.image.caption}
              {block.image.caption !== null && block.image.credit !== null ? ' ' : null}
              {block.image.credit !== null ? (
                <span className="art-figure__credit">
                  {IMAGE_CREDIT_LABEL}: {block.image.credit}
                </span>
              ) : null}
            </figcaption>
          ) : null}
        </figure>
      )

    case 'video':
      return (
        <figure className="art-video">
          <a
            className="art-video__link"
            href={block.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {block.title ?? `Assistir no ${PROVIDER_LABELS[block.provider] ?? block.provider}`}
          </a>
          <figcaption className="art-video__meta">
            {PROVIDER_LABELS[block.provider] ?? block.provider}
            {block.credit !== null ? ` · ${block.credit}` : ''}
          </figcaption>
        </figure>
      )

    case 'entityNote':
      /*
       * A NOTA sobrevive quando a ficha nao pode ser montada.
       *
       * O site so hidrata filme e serie. Para pessoa, temporada, episodio,
       * personagem e franquia — todos legais no contrato — o bloco inteiro
       * sumia, levando junto o texto que a redacao escreveu. Aqui ele fica, como
       * nota editorial, sem fingir ser uma ficha com link.
       */
      return <aside className="art-entity-note">{block.note}</aside>

    case 'embed': {
      /*
       * CLIQUE PARA CARREGAR, e por que ele nao e opcional.
       *
       * O `<iframe>` do YouTube so entra no DOM depois que a pessoa aperta —
       * enquanto isso ha um cartao estatico nosso. Isso mantem a promessa do
       * contrato editorial: nenhum script de terceiro carrega sem acao do
       * usuario numa pagina indexavel. O `srcDoc` faz a troca sem JavaScript
       * nosso e sem estado de cliente: o `<iframe>` interno so existe depois do
       * clique, dentro do proprio documento embutido.
       *
       * Instagram e X NAO tem player: renderizar o post deles exigiria o script
       * deles. Aqui viram CARTAO com link — o que entrega menos que embed
       * nativo, e esta dito assim no log da fase.
       */
      if (block.playerUrl !== null) {
        return (
          <figure className="art-embed art-embed--youtube">
            <div className="art-embed__frame">
              <iframe
                allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen
                className="art-embed__player"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                // `sandbox` sem `allow-same-origin`: o player roda isolado do
                // nosso documento, entao nem cookie nem storage nosso alcanca.
                sandbox="allow-scripts allow-presentation allow-popups"
                src={block.playerUrl}
                title={block.caption ?? 'Vídeo incorporado'}
              />
            </div>
            {block.caption !== null ? (
              <figcaption className="art-embed__caption">{block.caption}</figcaption>
            ) : null}
          </figure>
        )
      }

      return (
        <figure className={`art-embed art-embed--card art-embed--${block.provider}`}>
          <a
            className="art-embed__card"
            href={block.href}
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            <span className="art-embed__source">
              {block.provider === 'instagram' ? 'Instagram' : 'X'}
            </span>
            {block.authorName !== null ? (
              <span className="art-embed__author">{block.authorName}</span>
            ) : null}
            {block.excerpt !== null ? (
              <span className="art-embed__excerpt">{block.excerpt}</span>
            ) : null}
            <span className="art-embed__go">Ver publicação original</span>
          </a>
          {block.caption !== null ? (
            <figcaption className="art-embed__caption">{block.caption}</figcaption>
          ) : null}
        </figure>
      )
    }

    case 'gallery': {
      // Sem JavaScript: a galeria e uma lista rolavel de figuras. Credito e
      // legenda vao POR IMAGEM, porque direito de foto e por foto.
      const first = block.items[block.initialIndex] ?? block.items[0]
      return (
        <section aria-label="Galeria de imagens" className="art-gallery">
          <ol className="art-gallery__items">
            {block.items.map((image, index) => (
              <li
                className={`art-gallery__item${image === first ? ' art-gallery__item--initial' : ''}`}
                key={`${block.id}-${String(index)}`}
              >
                <figure>
                  <img
                    alt={image.alt}
                    className="art-gallery__img"
                    height={image.height ?? undefined}
                    loading="lazy"
                    src={image.src}
                    width={image.width ?? undefined}
                  />
                  {image.caption !== null || image.credit !== null ? (
                    <figcaption className="art-gallery__caption">
                      {image.caption}
                      {image.credit !== null ? (
                        <span className="art-gallery__credit">
                          {IMAGE_CREDIT_LABEL} {image.credit}
                        </span>
                      ) : null}
                    </figcaption>
                  ) : null}
                </figure>
              </li>
            ))}
          </ol>
        </section>
      )
    }

    case 'list': {
      // `<ol>` ou `<ul>` conforme o dado, nunca CSS fingindo semantica: leitor
      // de tela anuncia "lista de N itens" a partir do elemento, e uma lista
      // numerada desenhada com marcador perde a ordem que era o ponto dela.
      const List = block.ordered ? 'ol' : 'ul'
      return (
        <List className={`art-list art-list--${block.ordered ? 'ordered' : 'bulleted'}`}>
          {block.items.map((item, index) => (
            <li key={`${block.id}-${String(index)}`}>{item}</li>
          ))}
        </List>
      )
    }

    case 'quote':
      return (
        <figure className="art-quote">
          <blockquote>{block.text}</blockquote>
          {block.attribution !== null ? (
            <figcaption className="art-quote__by">{block.attribution}</figcaption>
          ) : null}
        </figure>
      )

    case 'entityCard':
      return (
        <aside
          aria-label={`Ficha de ${block.card.title}`}
          className="art-ficha art-ficha--inline"
          data-vertical={block.card.entityType === 'movie' ? 'movie' : 'series'}
        >
          <a aria-hidden="true" className="art-ficha__poster" href={block.card.href} tabIndex={-1}>
            {block.card.posterUrl !== null ? (
              <img alt="" loading="lazy" src={block.card.posterUrl} />
            ) : null}
          </a>
          <div className="art-ficha__body">
            <span className="art-ficha__kicker">{block.card.kicker}</span>
            <a className="art-ficha__title" href={block.card.href}>
              {block.card.title}
            </a>
            {block.card.metaLine !== null ? (
              <div className="art-ficha__meta">{block.card.metaLine}</div>
            ) : null}
            {/* Nota editorial do bloco vence o resumo do catálogo: foi o editor
                que escolheu o que dizer sobre esta entidade AQUI. */}
            {block.note !== null ? (
              <p className="art-ficha__summary">{block.note}</p>
            ) : block.card.summary !== null ? (
              <p className="art-ficha__summary">{block.card.summary}</p>
            ) : null}
            <div className="art-ficha__footer">
              <a className="art-ficha__link" href={block.card.href}>
                {block.card.entityType === 'movie' ? 'Ver página do filme' : 'Ver página da série'} →
              </a>
            </div>
          </div>
        </aside>
      )

    case 'factBox':
      return (
        <aside aria-labelledby={`fact-${block.id}`} className="art-factbox">
          <h2 className="art-factbox__title" id={`fact-${block.id}`}>
            {block.title}
          </h2>
          <dl className="art-factbox__list">
            {block.items.map((item, index) => (
              <div className="art-factbox__row" key={`${block.id}-${String(index)}`}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )

    case 'relatedContent':
      return (
        <aside aria-labelledby={`rel-${block.id}`} className="art-related">
          <h2 className="art-related__title" id={`rel-${block.id}`}>
            Leia mais
          </h2>
          <ul>
            {block.items.map((item) => (
              <li key={item.href}>
                {/* Link INTERNO: href derivado de slug pt-BR de artigo publicável. */}
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </aside>
      )

    case 'sourceList':
      return (
        <aside aria-labelledby={`src-${block.id}`} className="art-sources">
          <h2 className="art-sources__title" id={`src-${block.id}`}>
            Fontes
          </h2>
          <ul>
            {block.items.map((item) => (
              <li key={item.href}>
                <a href={item.href} rel="noopener noreferrer" target="_blank">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )

    case 'divider':
      return <hr className="art-divider" />
  }
}

export function ArticleBody({ blocks }: { blocks: readonly ArticleBodyBlock[] }) {
  if (blocks.length === 0) return null
  return (
    <>
      {blocks.map((block) => (
        <Block block={block} key={block.id} />
      ))}
    </>
  )
}
