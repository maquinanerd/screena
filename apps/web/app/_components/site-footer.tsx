import type { ReactNode } from "react";

import {
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "../../src/lib/site";

/**
 * SiteFooter — rodape global do app publico @screena/web.
 *
 * Server component PURO (sem "use client"): so JSX estatico + constantes de
 * rota. Zero rede/DB/API/Gemini (invariantes 3/4). Espelha o footer do design
 * "Screen Screens v4": wordmark S C R [caixa] N, tagline, icones sociais e
 * colunas de links.
 *
 * Honestidade de link (mesma regra do header): as colunas so LINKAM para rotas
 * publicas que EXISTEM (Filmes/Series/Pessoas/Noticias/Explorar). Itens
 * institucionais que ainda nao tem pagina (Sobre, Politica editorial, Contato)
 * aparecem como TEXTO, nunca como link morto. Os icones sociais e o bloco de
 * newsletter sao VISUAIS (como no proprio prototipo) — nenhuma feature de
 * cadastro/rede social e construida aqui.
 */

const NAV_COLUMNS: ReadonlyArray<{
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}> = [
  {
    title: "Navegar",
    links: [
      { label: "Filmes", href: MOVIES_INDEX_PATH },
      { label: "Séries", href: SERIES_INDEX_PATH },
      { label: "Pessoas", href: PEOPLE_INDEX_PATH },
    ],
  },
  {
    title: "Conteúdo",
    links: [
      { label: "Notícias", href: NEWS_INDEX_PATH },
      { label: "Explorar", href: EXPLORE_PATH },
    ],
  },
];

/** Itens institucionais ainda sem pagina propria: texto, nunca link morto. */
const INSTITUTIONAL = ["Sobre o Screen", "Política editorial", "Contato"] as const;

function SocialIcon({ path }: { path: ReactNode }): ReactNode {
  return (
    <span aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {path}
      </svg>
    </span>
  );
}

export function SiteFooter(): ReactNode {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <a className="site-footer__wordmark" href={HOME_PATH} aria-label="Screen — início">
            <span>S</span>
            <span>C</span>
            <span>R</span>
            <span className="site-footer__box" aria-hidden="true" />
            <span>N</span>
          </a>
          <p className="site-footer__tagline">
            Filmes, séries, pessoas, notícias e onde assistir — em um só lugar.
          </p>
          <div className="site-footer__social" aria-hidden="true">
            <SocialIcon path={<path d="M9 8.2l7 3.8-7 3.8z" fill="#fff" />} />
            <SocialIcon
              path={
                <path
                  d="M4 4l16 16M20 4L4 20"
                  stroke="#fff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              }
            />
            <SocialIcon
              path={
                <>
                  <rect
                    x="4.5"
                    y="4.5"
                    width="15"
                    height="15"
                    rx="4.6"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="2"
                  />
                  <circle cx="12" cy="12" r="3.4" fill="none" stroke="#fff" strokeWidth="2" />
                  <circle cx="17.1" cy="6.9" r="1.25" fill="#fff" />
                </>
              }
            />
            <SocialIcon
              path={
                <path
                  d="M14.6 8.4h-1.7c-.5 0-.9.4-.9 1V12h2.6l-.4 2.7h-2.2V21h-2.7v-6.3H7.2V12h2.1V9.1c0-1.9 1.2-3.1 3-3.1h2.3z"
                  fill="#fff"
                />
              }
            />
          </div>
        </div>

        <div>
          <div className="site-footer__cols">
            {NAV_COLUMNS.map((col) => (
              <div key={col.title}>
                <div className="site-footer__col-title">{col.title}</div>
                <div className="site-footer__links">
                  {col.links.map((link) => (
                    <a key={link.href} className="site-footer__link" href={link.href}>
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <div className="site-footer__col-title">The Screen</div>
              <div className="site-footer__links">
                {INSTITUTIONAL.map((item) => (
                  <span key={item} className="site-footer__muted">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="site-footer__bottom">
        <div className="site-footer__bottom-row">
          <span className="site-footer__copy">© 2026 The Screen · thescreen.media</span>
          <div className="site-footer__legal">
            <span>Termos de Uso</span>
            <span>Privacidade</span>
            <span>Índice do site</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
