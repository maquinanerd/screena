import type { ReactNode } from "react";

import { HOME_PATH } from "../../src/lib/site";
import { allowHomeVisualPlaceholders } from "../../src/lib/home-placeholder-governance";
import { ScreenLogo } from "./screen-logo";

interface FooterColumn {
  readonly links: readonly string[];
  readonly title: string;
}

const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "Filmes",
    links: ["Top 250", "Em breve", "Mais vistos", "Mais premiados"],
  },
  {
    title: "Séries",
    links: ["Top 50", "Mais populares", "Em breve", "Mais vistas"],
  },
  {
    title: "Celebridades",
    links: ["Nascidos hoje", "Mais populares", "Em alta", "Mais buscadas"],
  },
  {
    title: "The Screen",
    links: ["Sobre", "Imprensa", "Vagas", "Contato"],
  },
];

const LEGAL_ITEMS = ["Termos de Uso", "Privacidade", "Índice do site"] as const;

function SocialIcon({
  children,
  size = 18,
}: {
  readonly children: ReactNode;
  readonly size?: 15 | 18;
}): ReactNode {
  return (
    <span className="site-footer__social" aria-hidden="true">
      <svg aria-hidden="true" data-size={size} viewBox="0 0 24 24">
        {children}
      </svg>
    </span>
  );
}

/** Footer do HTML canônico; links inexistentes permanecem texto, não promessa. */
export function SiteFooter(): ReactNode {
  const showNewsletterPlaceholder = allowHomeVisualPlaceholders();

  return (
    <footer className="site-footer">
      <div className="site-footer__main">
        <div className="site-footer__brand">
          <a className="site-footer__wordmark" href={HOME_PATH} aria-label="Screen — início">
            <ScreenLogo
              accent="movie"
              className="site-footer__logo"
              height={44}
              ink="dark"
              width={229}
            />
          </a>
          <p className="site-footer__tagline">
            Filmes, séries, pessoas e notícias de entretenimento — em um só lugar.
          </p>
          <div className="site-footer__socials">
            <SocialIcon>
              <path d="M9 8.2l7 3.8-7 3.8z" fill="#fff" />
            </SocialIcon>
            <SocialIcon size={15}>
              <path
                d="M4 4l16 16M20 4L4 20"
                stroke="#fff"
                strokeLinecap="round"
                strokeWidth="2.4"
              />
            </SocialIcon>
            <SocialIcon>
              <rect
                fill="none"
                height="15"
                rx="4.6"
                stroke="#fff"
                strokeWidth="2"
                width="15"
                x="4.5"
                y="4.5"
              />
              <circle cx="12" cy="12" fill="none" r="3.4" stroke="#fff" strokeWidth="2" />
              <circle cx="17.1" cy="6.9" fill="#fff" r="1.25" />
            </SocialIcon>
            <SocialIcon>
              <path
                d="M14.6 8.4h-1.7c-.5 0-.9.4-.9 1V12h2.6l-.4 2.7h-2.2V21h-2.7v-6.3H7.2V12h2.1V9.1c0-1.9 1.2-3.1 3-3.1h2.3z"
                fill="#fff"
              />
            </SocialIcon>
          </div>
        </div>

        <div className="site-footer__content">
          <div className="site-footer__columns">
            {FOOTER_COLUMNS.map((column) => (
              <section className="site-footer__col" key={column.title}>
                <h2>{column.title}</h2>
                <ul>
                  {column.links.map((label) => (
                    <li key={label}>
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section
            aria-label="Newsletter"
            className={
              showNewsletterPlaceholder
                ? "site-footer__newsletter"
                : "site-footer__newsletter site-footer__newsletter--info"
            }
          >
            <div className="site-footer__newsletter-copy">
              <h2>
                {showNewsletterPlaceholder
                  ? "Receba a newsletter do The Screen"
                  : "Newsletter em breve"}
              </h2>
              <p>
                {showNewsletterPlaceholder
                  ? "Sem spam. Só o que importa em cinema e séries."
                  : "Estamos preparando uma curadoria de cinema e séries."}
              </p>
            </div>
            {showNewsletterPlaceholder ? (
              <div className="site-footer__newsletter-form" aria-hidden="true">
                <span className="site-footer__newsletter-input">Seu melhor e-mail</span>
                <span className="site-footer__newsletter-button">Assinar</span>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <div className="site-footer__meta">
        <p className="site-footer__attribution">
          Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB. Dados e
          imagens fornecidos pelo TMDB.
        </p>
        <div className="site-footer__bottom">
          <span>© 2026 The Screen · thescreen.media</span>
          <div className="site-footer__legal">
            {LEGAL_ITEMS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
