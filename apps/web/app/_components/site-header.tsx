'use client'

/**
 * SiteHeader — navegacao global do design canonico (Screen Screens v4).
 *
 * Comportamento do handoff:
 *  - barra FIXA de 72px (container nav 1380/80px);
 *  - TRANSPARENTE de verdade sobre o hero das telas home-like (sem faixa nem
 *    scrim proprio: quem escurece o topo e o `hero__scrim-v`) e SOLIDA ao
 *    rolar (transicao .35s), com wordmark branca -> preta;
 *  - MESMA transparencia sobre a capa da materia (`/pt/noticias/{slug}`), com
 *    duas diferencas: quem liga o estado e o CSS lendo o HTML do servidor (nao
 *    este componente), e a volta ao solido e MEDIDA no layout — acontece quando
 *    o primeiro texto do hero encosta na barra, nao num limiar fixo de 24px.
 *    Materia sem capa nunca entra nesse estado;
 *  - logo por contexto: sublinhado vermelho em /pt/filmes, verde em
 *    /pt/series, neutro no resto (o contexto NUNCA e so a cor: a rota, o
 *    breadcrumb e os labels continuam carregando o sinal — invariante 11);
 *  - paginas sem hero recebem um spacer de 72px (o `{{ showSpacer }}` do
 *    canonico) para o conteudo nao nascer embaixo da barra.
 *
 * Menu mobile usa <dialog> nativo: foco preso, Escape e backdrop de graca.
 * Nenhum acesso a rede/banco: navegacao pura.
 */

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  HOME_HREF,
  isActiveNavigationPath,
  NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
} from '../../src/lib/navigation'
// O icone de busca aponta para a rota que SOBREVIVEU a unificacao. Constante,
// nunca literal: `/pt/busca/` agora responde 301 e um literal esquecido aqui
// mandaria todo clique de busca por um salto extra.
import { EXPLORE_PATH } from '../../src/lib/routes'

/** Rotas cujo topo e um hero full-bleed (header transparente ate rolar). */
const HERO_ROUTES = ['/pt', '/pt/filmes', '/pt/series']

function isHeroRoute(pathname: string | null): boolean {
  if (pathname === null) return false
  const clean = pathname.replace(/\/+$/, '') || '/'
  return HERO_ROUTES.includes(clean)
}

/**
 * Seletor do hero de CAPA da matéria (tela 05).
 *
 * A matéria não entra em `HERO_ROUTES` de propósito: lá o overlay é decidido em
 * JS, e aqui ele precisa estar certo no PRIMEIRO PAINT — matéria sem capa é
 * página clara, e um quadro de logo/menu branco sobre ela seria ilegível. Quem
 * pinta o overlay da matéria é o CSS (`body:has(...)`), lendo o mesmo atributo
 * que a página emite no HTML do servidor. O JS abaixo só faz o inverso: marca
 * quando o hero JÁ PASSOU, para a barra voltar a ser sólida.
 */
const ARTICLE_HERO_SELECTOR = '.art-hero[data-hero-media="true"]'

/** Altura da barra fixa (`--nav-height`), em px. */
const NAV_HEIGHT_PX = 72

type LogoContext = 'movie' | 'series' | 'neutral'

function logoContextOf(pathname: string | null): LogoContext {
  if (pathname === null) return 'neutral'
  if (pathname.startsWith('/pt/filmes')) return 'movie'
  if (pathname.startsWith('/pt/series')) return 'series'
  return 'neutral'
}

/** Wordmark para barra SÓLIDA (fundo claro), com o sublinhado do contexto. */
function solidLogoSrc(context: LogoContext): string {
  if (context === 'movie') return '/brand/cinerie-wordmark-black-cinema.svg'
  if (context === 'series') return '/brand/cinerie-wordmark-black-serie.svg'
  return '/brand/cinerie-wordmark-black.svg'
}

/** Wordmark para barra TRANSPARENTE (sobre imagem escurecida). */
const INVERSE_LOGO_SRC = '/brand/cinerie-wordmark-white.svg'

export function SiteHeader(): ReactNode {
  const pathname = usePathname()
  const heroRoute = isHeroRoute(pathname)
  const [scrolled, setScrolled] = useState(false)
  /**
   * Rota de hero sem hero renderizado (catalogo vazio) existe: como o overlay
   * agora e TRANSPARENTE de verdade, texto branco cairia sobre pagina clara.
   * Comeca `true` (caso comum, sem flash no SSR) e o efeito corrige quando o
   * hero de fato nao esta no documento.
   */
  const [hasHero, setHasHero] = useState(true)
  /**
   * Só para a matéria: o hero de capa já saiu de baixo da barra.
   *
   * Começa `false` (barra transparente) porque esse é o estado de quem abre a
   * página no topo, e é o mesmo que o CSS pinta no primeiro paint — assim JS e
   * CSS nunca discordam num quadro. O único caminho é false -> true.
   */
  const [pastHero, setPastHero] = useState(false)
  const menuRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!heroRoute) return
    setHasHero(document.querySelector('#main-content .hero') !== null)
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [heroRoute, pathname])

  useEffect(() => {
    if (document.querySelector(ARTICLE_HERO_SELECTOR) === null) {
      setPastHero(false)
      return
    }
    /**
     * A barra fica transparente enquanto tem SÓ IMAGEM por baixo, e vira sólida
     * no instante em que o primeiro texto do hero encosta nela.
     *
     * Não é o mesmo que "quando o hero inteiro passar", e a diferença não é
     * teórica: com a barra transparente até o fim do hero, a manchete de 52px
     * sobe POR CIMA do menu e as duas camadas de texto se sobrepõem no meio da
     * tela. Contraste não resolve isso — os dois lados estão legíveis, e ainda
     * assim ilegíveis juntos. O limite honesto do estado transparente é o ponto
     * em que ele deixaria de flutuar sobre imagem.
     *
     * A medida é feita UMA vez (e a cada `resize`), não a cada scroll: ler
     * geometria dentro do handler forçaria reflow a cada quadro. O evento em si
     * só compara dois números.
     */
    const firstText = document.querySelector(`${ARTICLE_HERO_SELECTOR} .art-crumb`)
    if (firstText === null) {
      setPastHero(false)
      return
    }
    let flipAt = 0
    const measure = () => {
      flipAt = Math.max(
        0,
        firstText.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT_PX,
      )
    }
    const onScroll = () => setPastHero(window.scrollY >= flipAt)
    const onResize = () => {
      measure()
      onScroll()
    }
    measure()
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [pathname])

  const overlay = heroRoute && hasHero && !scrolled
  const context = logoContextOf(pathname)
  const inNews = pathname !== null && pathname.startsWith('/pt/noticias')

  return (
    <>
      <header
        className="site-header"
        data-context={context}
        data-overlay={overlay ? 'true' : 'false'}
        data-past-hero={pastHero ? 'true' : undefined}
      >
        <div className="site-header__inner">
          <a className="site-header__brand" href={HOME_HREF} aria-label="Cinerie — início">
            {/* Wordmark aprovada do handoff (uploads/5a–5j); alt vazio: o
                aria-label do link ja nomeia.

                As DUAS versoes vao no HTML e quem escolhe e o CSS. Trocar o
                `src` em JS custaria um quadro com a wordmark preta sobre a capa
                escura da materia, porque a decisao de transparencia da materia
                nasce do proprio HTML e nao espera hidratacao. Apenas uma esta
                visivel; a outra e `display:none`. */}
            <img
              alt=""
              className="site-header__logo site-header__logo--solid"
              height={30}
              src={solidLogoSrc(context)}
              width={97}
            />
            <img
              alt=""
              className="site-header__logo site-header__logo--inverse"
              height={30}
              src={INVERSE_LOGO_SRC}
              width={97}
            />
            {inNews ? <span aria-hidden="true" className="site-header__news">NEWS</span> : null}
          </a>

          <nav aria-label="Principal" className="site-header__nav">
            {NAV_ITEMS.map((item) => {
              const active = isActiveNavigationPath(pathname, item.href)
              return (
                <a
                  aria-current={active ? 'page' : undefined}
                  className="site-header__link"
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </a>
              )
            })}
          </nav>

          <div className="site-header__actions">
            <a aria-label="Buscar" className="site-header__icon-link" href={EXPLORE_PATH}>
              <svg aria-hidden="true" fill="none" height="19" viewBox="0 0 24 24" width="19">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.8-3.8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
            </a>
            <a aria-label="Minha conta" className="site-header__icon-link" href="/pt/conta/">
              <span aria-hidden="true" className="site-header__avatar">
                <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
                  <path d="M4 20c1.6-3.5 4.4-5 8-5s6.4 1.5 8 5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                </svg>
              </span>
            </a>
            <button
              aria-label="Abrir menu"
              className="site-header__menu-btn"
              onClick={() => menuRef.current?.showModal()}
              type="button"
            >
              <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <dialog aria-label="Menu principal" className="mobile-menu" ref={menuRef}>
        <button
          className="mobile-menu__close"
          onClick={() => menuRef.current?.close()}
          type="button"
        >
          Fechar menu
        </button>
        <ul className="mobile-menu__list">
          {[...NAV_ITEMS, ...SECONDARY_NAV_ITEMS].map((item) => (
            <li key={item.href}>
              <a href={item.href} onClick={() => menuRef.current?.close()}>
                {item.label}
              </a>
            </li>
          ))}
          <li>
            <a href={EXPLORE_PATH} onClick={() => menuRef.current?.close()}>
              Buscar
            </a>
          </li>
          <li>
            <a href="/pt/conta/" onClick={() => menuRef.current?.close()}>
              Minha conta
            </a>
          </li>
        </ul>
      </dialog>

      {/* Spacer do canonico ({{ showSpacer }}): so quando NAO ha hero por baixo. */}
      {heroRoute ? null : <div aria-hidden="true" className="site-header__spacer" />}
    </>
  )
}
