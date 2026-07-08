import type { ReactNode } from "react";

import {
  HOME_PATH,
  MOVIES_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "../../src/lib/site";
import { allowHomeVisualPlaceholders } from "../../src/lib/home-placeholder-governance";

/**
 * SiteFooter — rodape global do app publico @screena/web (design v4).
 *
 * Server component PURO (sem "use client"): so JSX estatico + constantes de
 * rota. Zero rede/DB/API/Gemini (invariantes 3/4).
 *
 * Honestidade de link (mesma regra do header):
 * - As colunas de catalogo (Filmes/Series/Celebridades) LINKAM para o indice
 *   REAL da vertical (/pt/filmes, /pt/series, /pt/pessoas). Os rotulos de filtro
 *   (Top 250, Em breve, Mais vistos...) sao paginas FUTURAS: apontam para o
 *   indice pai existente — NUNCA rota quebrada.
 * - A coluna "The Screen" (Sobre/Imprensa/Vagas/Contato) e institucional e ainda
 *   nao tem pagina propria: aparece como TEXTO, nunca link morto. Idem os links
 *   legais do rodape (Termos/Privacidade/Indice).
 * - A newsletter e gateada por ambiente (Fase 1.1B, `allowHomeVisualPlaceholders`):
 *   em dev/preview mantem a composicao VISUAL aprovada (spans nao interativos do
 *   pseudo-"formulario", aria-hidden — SEM form/input/button/API/server action/
 *   validacao/envio). Em PRODUCAO vira um bloco HONESTO ("Newsletter em breve"),
 *   sem campo nem botao — nunca aparenta cadastro funcional que nao existe.
 * - Atribuicao obrigatoria ao TMDB (fonte de dados/imagens) mantida.
 */

interface CatalogColumn {
  title: string;
  href: string;
  items: readonly string[];
}

/** Colunas de catalogo — cada rotulo linka ao indice REAL da vertical. */
const CATALOG_COLUMNS: readonly CatalogColumn[] = [
  {
    title: "Filmes",
    href: MOVIES_INDEX_PATH,
    items: ["Top 250", "Em breve", "Mais vistos", "Mais premiados"],
  },
  {
    title: "Séries",
    href: SERIES_INDEX_PATH,
    items: ["Top 50", "Mais populares", "Em breve", "Mais vistas"],
  },
  {
    title: "Celebridades",
    href: PEOPLE_INDEX_PATH,
    items: ["Nascidos hoje", "Mais populares", "Em alta", "Mais buscadas"],
  },
];

/** Coluna institucional — sem pagina propria: TEXTO, nunca link morto. */
const INSTITUTIONAL_ITEMS = ["Sobre", "Imprensa", "Vagas", "Contato"] as const;

/** Links legais — sem pagina propria: TEXTO, nunca link morto. */
const LEGAL_ITEMS = ["Termos de Uso", "Privacidade", "Índice do site"] as const;

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
  // Gate por ambiente: pseudo-form visual só em dev/preview; em produção, bloco
  // honesto sem aparência de formulário funcional.
  const showNewsletterPlaceholder = allowHomeVisualPlaceholders();
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <a
              className="site-footer__wordmark"
              href={HOME_PATH}
              aria-label="Screen — início"
            >
              <img
                className="site-footer__logo"
                src="/brand/screen-logo-black.svg"
                alt="Screen"
                width={406}
                height={78}
              />
            </a>
            <p className="site-footer__tagline">
              Filmes, séries, pessoas, notícias e onde assistir — em um só lugar.
            </p>
            <div className="site-footer__socials" aria-hidden="true">
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

          <div className="site-footer__columns">
            {CATALOG_COLUMNS.map((col) => (
              <div className="site-footer__col" key={col.title}>
                <h3>{col.title}</h3>
                <ul>
                  {col.items.map((label) => (
                    <li key={label}>
                      <a href={col.href}>{label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="site-footer__col">
              <h3>The Screen</h3>
              <ul>
                {INSTITUTIONAL_ITEMS.map((label) => (
                  <li key={label}>
                    <span className="site-footer__muted">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Newsletter — gate por ambiente (Fase 1.1B).
            Dev/preview (`showNewsletterPlaceholder`): faixa FULL-WIDTH com a
            composição visual aprovada (copy à esquerda + pseudo-"formulário" à
            direita). O input/botão são spans não interativos, aria-hidden: sem
            form/input/button/API/server action/validação/envio.
            Produção: bloco HONESTO ("Newsletter em breve"), sem campo/botão — o
            modificador `--info` colapsa o grid p/ 1 coluna (não deixa vão). */}
        <div
          className={
            showNewsletterPlaceholder
              ? "site-footer__newsletter"
              : "site-footer__newsletter site-footer__newsletter--info"
          }
        >
          <div className="site-footer__newsletter-copy">
            {showNewsletterPlaceholder ? (
              <>
                <strong>Receba a newsletter do The Screen</strong>
                <span>Sem spam. Só o que importa em cinema e séries.</span>
              </>
            ) : (
              <>
                <strong>Newsletter em breve</strong>
                <span>
                  Estamos preparando uma curadoria semanal de cinema e séries.
                </span>
              </>
            )}
          </div>
          {showNewsletterPlaceholder ? (
            <div className="site-footer__newsletter-form" aria-hidden="true">
              <span className="site-footer__newsletter-input">
                Seu melhor e-mail
              </span>
              <span className="site-footer__newsletter-button">ASSINAR</span>
            </div>
          ) : null}
        </div>

        <p className="site-footer__attribution">
          Este produto usa a API do TMDB, mas não é endossado ou certificado pelo
          TMDB. Dados e imagens de filmes e séries fornecidos pelo TMDB.
        </p>

        <div className="site-footer__bottom">
          <span className="site-footer__copy">
            © 2026 The Screen · thescreen.media
          </span>
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
