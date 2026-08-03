import type { ReactNode } from 'react'

import { HOME_HREF, NAV_ITEMS, SECONDARY_NAV_ITEMS } from '../../src/lib/navigation'
import { PRIVACY_PATH, TERMS_PATH } from '../../src/lib/routes'

/**
 * SiteFooter — rodape CLARO editorial do design canonico (footer claro por
 * regra transversal do handoff: overlay escuro so em midia/hero, DD-20).
 * Wordmark aprovada + rotas reais + atribuicao obrigatoria do TMDB.
 *
 * Os documentos legais ficam numa linha PROPRIA, separada da navegacao de
 * produto: sao o destino do aceite obrigatorio do cadastro e precisam estar
 * alcancaveis de qualquer pagina, nao diluidos entre Filmes/Series/Listas.
 */
export function SiteFooter(): ReactNode {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__top">
          <a href={HOME_HREF} aria-label="Cinerie — início">
            <img
              alt=""
              className="site-footer__logo"
              height={36}
              src="/brand/cinerie-wordmark-black.svg"
              width={116}
            />
          </a>
          <nav aria-label="Rodapé">
            <ul className="site-footer__links">
              {/* Rodape carrega TODAS as rotas reais: as do menu primario mais
                  Pessoas/Explorar, que ficam fora do header canonico. */}
              {[...NAV_ITEMS, ...SECONDARY_NAV_ITEMS].map((item) => (
                <li key={item.href}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
              <li>
                <a href="/pt/busca/">Buscar</a>
              </li>
              <li>
                <a href="/pt/conta/">Minha conta</a>
              </li>
            </ul>
          </nav>
        </div>
        <nav aria-label="Documentos legais">
          <ul className="site-footer__legal">
            <li>
              <a href={TERMS_PATH}>Termos de Uso</a>
            </li>
            <li>
              <a href={PRIVACY_PATH}>Política de Privacidade</a>
            </li>
          </ul>
        </nav>
        <p className="site-footer__attribution">
          Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.
        </p>
      </div>
    </footer>
  )
}
