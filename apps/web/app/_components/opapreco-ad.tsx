/**
 * <OpaPrecoAd slotKey contentId section tags className> — uma posição do
 * OpaPreço Ads (matéria, home, listagens de filmes e séries, fichas de filme e
 * série). SERVER component: só marcação, nenhum JavaScript da Cinerie.
 *
 * O que sai no HTML:
 *  - o `<script async>` e a folha de estilo do SDK, servidos por
 *    `opapreco.com.br`. O React 19 sobe os dois para o `<head>` e não os repete
 *    quando a página tem mais de um slot. Ficam só nas páginas que têm slot:
 *    pessoas, Explorar, Notícias e as demais rotas não carregam nada do
 *    OpaPreço;
 *  - o `<op-slot>`. A folha de estilo do SDK já reserva a altura dele pelo
 *    `slot-key` antes de qualquer JavaScript (sem CLS); o script pede a oferta,
 *    desenha, colapsa sem anúncio e conta impressão e clique. Nada disso é
 *    refeito aqui (`src/lib/opapreco-ads.ts`).
 *
 * DOIS DETALHES QUE NÃO SÃO ENFEITE:
 *  - `dangerouslySetInnerHTML` vazio: o script `async` pode desenhar o anúncio
 *    ANTES de o React hidratar a página. Um elemento sem filhos que aparece com
 *    filhos é divergência de hidratação, e o React refaria a árvore, criando um
 *    `<op-slot>` novo e um segundo pedido. Com o conteúdo declarado como HTML
 *    opaco, o React não hidrata os filhos e não toca neles depois.
 *    `suppressHydrationWarning` cobre os atributos que o script muda
 *    (`data-op-estado`, `data-ad-component`, `style`).
 *  - `key` = id do conteúdo + slot: numa troca de matéria ou de ficha pelo
 *    cliente o slot nasce de novo e pede a oferta com o contexto da página nova.
 *
 * Desligado (`NEXT_PUBLIC_OPAPRECO_ADS_ENABLED=false`, ou fora da produção
 * oficial sem a chave): devolve `null`, e a página sai sem slot, sem script e
 * sem folha de estilo.
 *
 * `className` leva a margem da página. Ela fica no próprio `<op-slot>` e zera
 * quando ele colapsa (`article.css`, `home-like.css`, `detail.css`), para não
 * sobrar buraco.
 */

import type { ClassAttributes, HTMLAttributes, ReactNode } from 'react'

import {
  OPAPRECO_ADS_ENDPOINT,
  OPAPRECO_ADS_SCRIPT_URL,
  OPAPRECO_ADS_SITE_KEY,
  OPAPRECO_ADS_STYLESHEET_URL,
  isOpaPrecoAdsEnabled,
  opaPrecoAdTags,
  type OpaPrecoAdSlotKey,
} from '../../src/lib/opapreco-ads'

/**
 * Os atributos que o `<op-slot>` lê (guia de integração do OpaPreço, §5), mais
 * `key`/`ref` (`ClassAttributes`), como em qualquer elemento nativo.
 */
interface OpSlotAttributes extends HTMLAttributes<HTMLElement>, ClassAttributes<HTMLElement> {
  readonly 'slot-key': OpaPrecoAdSlotKey
  readonly 'site-key': string
  readonly endpoint: string
  readonly section?: string
  readonly tags?: string
  readonly 'content-id'?: string
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'op-slot': OpSlotAttributes
    }
  }
}

/** Conteúdo opaco para o React: os filhos do `<op-slot>` são do script do OpaPreço. */
const SLOT_CONTENT_OWNED_BY_SDK = { __html: '' }

export interface OpaPrecoAdProps {
  readonly slotKey: OpaPrecoAdSlotKey
  /** Id do conteúdo (`content-id`): a matéria, o título ou a rota. Também compõe a `key` do slot. */
  readonly contentId: string
  /** Categoria editorial da matéria, ou a vertical da página ("Filmes", "Séries"). */
  readonly section?: string | null
  /** O que a página cita (títulos, gêneros); vira `tags="a,b"`. */
  readonly tags?: readonly (string | null | undefined)[]
  readonly className?: string
}

export function OpaPrecoAd({ className, contentId, section, slotKey, tags }: OpaPrecoAdProps): ReactNode {
  if (!isOpaPrecoAdsEnabled()) return null
  return (
    <>
      <script
        async
        data-endpoint={OPAPRECO_ADS_ENDPOINT}
        data-site-key={OPAPRECO_ADS_SITE_KEY}
        src={OPAPRECO_ADS_SCRIPT_URL}
      />
      <link href={OPAPRECO_ADS_STYLESHEET_URL} precedence="default" rel="stylesheet" />
      <op-slot
        className={className}
        content-id={contentId}
        dangerouslySetInnerHTML={SLOT_CONTENT_OWNED_BY_SDK}
        endpoint={OPAPRECO_ADS_ENDPOINT}
        key={`${contentId}:${slotKey}`}
        section={section ?? undefined}
        site-key={OPAPRECO_ADS_SITE_KEY}
        slot-key={slotKey}
        suppressHydrationWarning
        tags={opaPrecoAdTags(tags ?? [])}
      />
    </>
  )
}
