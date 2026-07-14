import type { ReactNode } from "react";

import { CinerieLogo } from "./cinerie-logo";
import {
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "../../src/lib/site";

/**
 * Rodape global do app publico cinerie.
 *
 * Server component puro: renderiza somente a marca, rotas publicas reais e a
 * atribuicao obrigatoria ao TMDB. Nao apresenta filtros, redes sociais,
 * newsletter ou paginas institucionais que ainda nao existem.
 */

interface FooterLink {
  label: string;
  href: string;
}

interface FooterColumn {
  title: string;
  links: readonly FooterLink[];
}

const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "Navegar",
    links: [{ label: "Início", href: HOME_PATH }],
  },
  {
    title: "Catálogo",
    links: [
      { label: "Filmes", href: MOVIES_INDEX_PATH },
      { label: "Séries", href: SERIES_INDEX_PATH },
      { label: "Pessoas", href: PEOPLE_INDEX_PATH },
    ],
  },
  {
    title: "Editorial",
    links: [{ label: "Notícias", href: NEWS_INDEX_PATH }],
  },
  {
    title: "Descobrir",
    links: [{ label: "Explorar", href: EXPLORE_PATH }],
  },
];

export function SiteFooter(): ReactNode {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <a className="site-footer__wordmark" href={HOME_PATH} aria-label="cinerie — início">
              <CinerieLogo className="site-footer__logo" />
            </a>
            <p className="site-footer__tagline">
              Filmes, séries, pessoas e notícias de entretenimento em um só lugar.
            </p>
          </div>

          <nav className="site-footer__columns" aria-label="Navegação do rodapé">
            {FOOTER_COLUMNS.map((column) => (
              <div className="site-footer__col" key={column.title}>
                <h3>{column.title}</h3>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href}>{link.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p className="site-footer__attribution">
          Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB. Dados e
          imagens de filmes e séries fornecidos pelo TMDB.
        </p>

        <div className="site-footer__bottom">
          <span className="site-footer__copy">© 2026 cinerie · thescreen.media</span>
        </div>
      </div>
    </footer>
  );
}
