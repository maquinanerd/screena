import type { ReactNode } from "react";

import { FooterNewsletter } from "./footer-newsletter";
import { SectionBoundary } from "./section-boundary";
import {
  buildChromeSectionAbsence,
  type SectionDecision,
} from "../../src/lib/section-absence";
import type { PublicCreditLogo } from "@screena/legal/public-credits";
import { isNewsletterEnabled } from "../../src/lib/site";
import {
  DATA_CREDITS,
  DATA_CREDITS_PATH,
  FOOTER_COLUMNS,
  FOOTER_SOCIAL_LINKS,
  SITE_INDEX_PATH,
  TMDB_DISCLAIMER,
} from "../../src/config/footer";
import { HOME_HREF } from "../../src/lib/navigation";
import { PRIVACY_PATH, TERMS_PATH } from "../../src/lib/routes";

/**
 * SiteFooter — rodapé global escuro, montado no layout raiz.
 *
 * ============================================================================
 * ESTE RODAPÉ É O ÚNICO LUGAR ONDE O CRÉDITO DE FONTE ACONTECE
 * ============================================================================
 * Decisão do proprietário (Pablo Eduardo, 2026-08-13): todo crédito de fonte
 * saiu do corpo das páginas e passou a viver aqui. Antes o crédito ficava colado
 * no dado (dentro do chip da nota, sob o painel de streaming) e a PROXIMIDADE
 * era a prova de que a licença estava cumprida.
 *
 * Agora a prova é outra, e ela tem duas metades — as duas precisam existir:
 *   1. o rodapé nomeia TODA fonte autorizada, com o texto verbatim da licença;
 *   2. o rodapé está em TODA página que exibe dado licenciado.
 *
 * A metade (1) é estrutural: `DATA_CREDITS` é derivado de
 * `services/legal/authorization-spec.ts`, então este componente não conhece — e
 * não pode esquecer — nenhum nome de fonte. A metade (2) é o layout raiz
 * (`app/layout.tsx`) mais os testes por rota em `tests/web/footer-credits.test.tsx`.
 *
 * Remover o bloco de créditos daqui derruba os dois lados: é o controle negativo
 * do teste, e ele reprova.
 *
 * ============================================================================
 * DIVERGÊNCIAS DELIBERADAS EM RELAÇÃO À `FOOTER-SPEC.md`
 * ============================================================================
 * 1. LOGO DE FONTE: agora POR FONTE, não mais "nenhum". A razão (b) desta nota
 *    — "`logoAllowed` é o literal `false` no TIPO" — caiu em 20/08/2026, quando
 *    a leitura dos termos mostrou que o TMDB **exige** o logo dele
 *    ("You must use the TMDB logo to identify Your use of TMDB, the TMDB APIs,
 *    or TMDB Content"). O `false` global não era zelo: era descumprimento de uma
 *    fonte e zelo com cinco.
 *
 *    O que este componente faz mudou pouco, e de propósito: ele continua sem
 *    conhecer nome de fonte nenhum. Ele desenha `credit.logo` quando a PROJEÇÃO
 *    traz um — e a projeção só traz quando a licença autoriza E o arquivo
 *    oficial existe. Nenhum SVG de terceiro é escrito aqui dentro.
 *
 *    A razão (a) continua de pé e é hoje o único bloqueio: o arquivo oficial do
 *    TMDB não está no repositório. Enquanto não estiver, a licença fica em
 *    `pending_official_file`, o crédito sai textual, e a ausência é REGISTRADA
 *    (`SectionBoundary`, motivo `source_logo_asset_missing`) em vez de muda.
 *    Desenhar uma aproximação de marca registrada seria pior que a ausência.
 * 2. WORDMARK. A spec pede `uploads/5f-logo-branca-sublinhado-branco.svg`, que
 *    não existe aqui. Usamos `/brand/cinerie-wordmark-white.svg`, a variante
 *    branca aprovada do repositório para fundo escuro. Ela não tem o sublinhado
 *    (esse dispositivo pertencia ao logo antigo, "Screen").
 * 3. WIKIDATA não aparece: não há licença de Wikidata em `authorization-spec.ts`.
 *    Creditar uma fonte que o registro legal não conhece seria inventar
 *    procedência. Registre a licença e o crédito aparece sozinho.
 */

/**
 * A decisao de renderizar (ou nao) a marca grafica de UM credito.
 *
 * So e chamada quando a licenca autoriza o logo. O `null` que chega aqui nunca
 * significa "esta fonte nao tem logo" — significa "tem, e o arquivo oficial
 * falta". Por isso o caminho `rendered: false` carrega motivo acionavel em vez
 * de sumir calado.
 */
function decisaoDeLogo(logo: PublicCreditLogo | null): SectionDecision<PublicCreditLogo> {
  if (logo !== null) return { rendered: true, value: logo, absence: null };
  return {
    rendered: false,
    value: null,
    absence: buildChromeSectionAbsence({
      section: "creditos-de-dados",
      reason: "source_logo_asset_missing",
      surface: "footer",
    }),
  };
}

/** Ícones oficiais das redes. Decorativos: o nome vem do `aria-label` do link. */
const SOCIAL_ICONS: Readonly<Record<string, ReactNode>> = {
  youtube: (
    <svg aria-hidden="true" height="17" viewBox="0 0 24 24" width="17">
      <path
        d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z"
        fill="currentColor"
      />
    </svg>
  ),
  instagram: (
    <svg aria-hidden="true" height="17" viewBox="0 0 24 24" width="17">
      <rect
        fill="none"
        height="18"
        rx="5"
        stroke="currentColor"
        strokeWidth="2"
        width="18"
        x="3"
        y="3"
      />
      <circle cx="12" cy="12" fill="none" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" fill="currentColor" r="1.4" />
    </svg>
  ),
  x: (
    <svg aria-hidden="true" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M18.2 2.3h3.4l-7.4 8.5 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9.1L.9 2.3h7l4.8 6.4 5.5-6.4Zm-1.2 18h1.9L7.1 4.2H5.1L17 20.3Z"
        fill="currentColor"
      />
    </svg>
  ),
  facebook: (
    <svg aria-hidden="true" height="17" viewBox="0 0 24 24" width="17">
      <path
        d="M14.6 8.4h-1.7c-.5 0-.9.4-.9 1V12h2.6l-.4 2.7h-2.2V21h-2.7v-6.3H7.2V12h2.1V9.1c0-1.9 1.2-3.1 3-3.1h2.3z"
        fill="currentColor"
      />
    </svg>
  ),
};

export function SiteFooter(): ReactNode {
  const year = new Date().getFullYear();

  /**
   * A faixa de newsletter existe? Não é decisão de layout — é de capacidade.
   *
   * Não há modelo de inscrição no schema, então com a faixa no ar o formulário
   * só poderia mentir (`200 OK` sem guardar) ou errar sempre. Um formulário que
   * nunca consegue ter sucesso é pior que ausência: o leitor digita o e-mail,
   * aperta, e recebe erro — o gesto foi gasto à toa.
   *
   * O `<form>`, os três estados, o `aria-live` e os testes continuam existindo:
   * é trabalho feito e testado, e vai ao ar ligando a flag no dia em que a
   * tabela existir. A rota `/api/newsletter` também fica, com o 503 honesto —
   * quem chegar nela por outro caminho continua recebendo a verdade.
   *
   * `decideSection` não serve aqui: ele decide por dado VAZIO, e o que decide
   * isto é uma CAPACIDADE. Por isso a decisão é montada à mão — e o tipo
   * continua obrigando o motivo a existir quando `rendered: false`.
   */
  const newsletterSection = isNewsletterEnabled()
    ? ({ rendered: true, value: null, absence: null } as const)
    : ({
        rendered: false,
        value: null,
        absence: buildChromeSectionAbsence({
          section: "newsletter",
          reason: "newsletter_storage_unavailable",
          surface: "footer",
        }),
      } as const);

  return (
    <footer className="footer" role="contentinfo">
      <div className="footer__inner">
        {/* ---- 1 · Topo: marca + redes ------------------------------------ */}
        <div className="footer__top">
          <a aria-label="Cinerie" className="footer__brand" href={HOME_HREF}>
            <img
              alt=""
              className="footer__wordmark"
              height={46}
              src="/brand/cinerie-wordmark-white.svg"
              width={150}
            />
          </a>
          {/* Sem perfil real cadastrado, a faixa some inteira. Um círculo que
              leva a lugar nenhum é pior que a ausência dele. */}
          {FOOTER_SOCIAL_LINKS.length > 0 ? (
            <nav aria-label="Cinerie nas redes sociais">
              <ul className="footer__social">
                {FOOTER_SOCIAL_LINKS.map((social) => (
                  <li key={social.network}>
                    <a
                      aria-label={social.label}
                      className="footer__social-link"
                      href={social.href}
                      rel="noopener"
                      target="_blank"
                    >
                      {SOCIAL_ICONS[social.network]}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>

        {/* ---- 2 · Colunas de navegação ------------------------------------ */}
        <div className="footer__columns">
          {FOOTER_COLUMNS.map((column) => (
            <nav aria-label={column.title} className="footer__column" key={column.title}>
              {/* `<p>`, não `<h2>`: o rodapé vive fora do `<main>` e não pode
                  competir com a hierarquia de títulos da página (spec §8). */}
              <p className="footer__column-title" data-accent={column.accent}>
                {column.title}
              </p>
              <ul className="footer__column-links">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* ---- 3 · Newsletter ---------------------------------------------
            A faixa só existe quando a inscrição PODE dar certo. Ver a decisão
            no cabeçalho e `docs/frontend/newsletter.md`. A ausência não é muda:
            o `SectionBoundary` decide e loga na MESMA linha. */}
        <SectionBoundary decision={newsletterSection} once>
          {() => <FooterNewsletter />}
        </SectionBoundary>

        {/* ---- 4 · Legal + créditos de fonte ------------------------------- */}
        <div className="footer__legal">
          <nav aria-label="Documentos legais">
            <ul className="footer__legal-links">
              <li>
                <a href={TERMS_PATH}>Termos e Condições</a>
              </li>
              <li>
                <a href={PRIVACY_PATH}>Política de Privacidade</a>
              </li>
              <li>
                <a href={DATA_CREDITS_PATH}>Créditos de dados</a>
              </li>
              <li>
                <a href={SITE_INDEX_PATH}>Índice do site</a>
              </li>
            </ul>
          </nav>

          {/*
            OS CRÉDITOS. Texto, nunca logo (ver o cabeçalho, divergência 1).
            Cada item sai verbatim de `services/legal`; este componente não sabe
            o nome de nenhuma fonte. Uma licença nova aparece aqui sozinha.
          */}
          <div className="footer__credits">
            <p className="footer__credits-label" id="footer-credits-label">
              Dados por
            </p>
            <ul aria-labelledby="footer-credits-label" className="footer__credits-list">
              {DATA_CREDITS.map((credit) => (
                <li
                  className="footer__credit"
                  data-credit-logo-pending={credit.logoPending ? "true" : undefined}
                  data-credit-role={credit.role}
                  key={credit.creditKey}
                >
                  {/*
                    O LOGO VEM ANTES DO TEXTO, e NUNCA no lugar dele.

                    Os termos do TMDB exigem as DUAS coisas (a marca e o
                    disclaimer de nao-endosso); um credito que virasse so imagem
                    tambem sumiria para leitor de tela e para quem bloqueia
                    imagem. `credit.text` nao e condicional em lugar nenhum
                    deste bloco — e o teste reprova se alguem o tornar.

                    `alt=""` + `aria-hidden`: a marca ja esta escrita ao lado,
                    em texto real. Um `alt="TMDB"` aqui faria o leitor de tela
                    anunciar a fonte duas vezes seguidas.
                  */}
                  {credit.logo === null && !credit.logoPending ? null : (
                    <SectionBoundary decision={decisaoDeLogo(credit.logo)} once>
                      {(logo) => (
                        <img
                          alt=""
                          aria-hidden="true"
                          className="footer__credit-logo"
                          data-credit-logo={credit.creditKey}
                          height={logo.heightPx}
                          src={logo.src}
                        />
                      )}
                    </SectionBoundary>
                  )}
                  <span className="footer__credit-text">{credit.text}</span>
                  <span className="footer__credit-role">{credit.roleLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---- 5 · Base: copyright + disclaimer do TMDB -------------------- */}
        <div className="footer__base">
          <div className="footer__base-text">
            <p className="footer__copyright">
              © {year} Cinerie · cinerie.com · Todos os direitos reservados.
            </p>
            {/*
              Exigência dos termos da API do TMDB. Sai da PRÓPRIA licença
              (`tmdbNonEndorsementDisclaimer`), então não pode divergir do que o
              registro legal declara nem ser parafraseado por engano.
            */}
            <p className="footer__disclaimer">
              {TMDB_DISCLAIMER} Imagens, pôsteres e marcas pertencem aos respectivos
              titulares. Detalhes em{" "}
              <a href={DATA_CREDITS_PATH}>Créditos de dados</a>.
            </p>
          </div>
          <img
            aria-hidden="true"
            alt=""
            className="footer__wordmark footer__wordmark--base"
            height={30}
            src="/brand/cinerie-wordmark-white.svg"
            width={120}
          />
        </div>
      </div>
    </footer>
  );
}
