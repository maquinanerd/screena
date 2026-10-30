import type { Metadata } from "next";
import type { ReactNode } from "react";
import { preload } from "react-dom";

import { SiteHeader } from "./_components/site-header";
import { SiteFooter } from "./_components/site-footer";
import { CINERIE_SOCIAL_CARD } from "../src/lib/brand-logos";
import { SITE_URL } from "../src/lib/site";
import "./globals.css";

/**
 * Layout raiz do app publico @screena/web.
 *
 * Define <html>/<body> e o idioma de publicacao do MVP (pt-BR; invariante 7).
 * Importa o estilo global minimo (`globals.css`): tema claro com tokens de cor
 * da Screena, sem framework de CSS nem fontes externas. Server component puro —
 * nenhum acesso a banco ou rede aqui.
 *
 * Renderiza o `SiteHeader` (navegacao global) acima do conteudo de cada rota,
 * de forma que ele aparece em todas as telas sem alterar as paginas em si.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Cinerie", template: "%s | Cinerie" },
  // O cartao PADRAO, para a rota que nao monta o seu (conta, listas, entrar). As
  // paginas publicas montam o cartao completo em `src/lib/social-metadata.ts` — e
  // precisam: o `openGraph` de uma pagina SUBSTITUI este inteiro. A imagem e o
  // cartao da marca, derivado da arte entregue pelo dono (decisao D4).
  openGraph: {
    siteName: "Cinerie",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: CINERIE_SOCIAL_CARD.src,
        width: CINERIE_SOCIAL_CARD.width,
        height: CINERIE_SOCIAL_CARD.height,
        alt: "Cinerie",
      },
    ],
  },
  twitter: { card: "summary_large_image", images: [CINERIE_SOCIAL_CARD.src] },
};

/** O MESMO arquivo do `src` da `@font-face` em `globals.css` (travado por teste). */
const FONT_PATH = "/fonts/montserrat-latin-variable.woff2";

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  // PRELOAD DA FONTE (2026-09-11). A Montserrat variavel so era descoberta DEPOIS
  // de o navegador baixar e analisar a folha global — e entrava no lugar do
  // fallback com o texto ja pintado. Medido na auditoria de SEO: o CLS 0,088 da
  // noticia no desktop e um unico deslocamento logo apos `fonts.ready`, com a
  // navegacao do cabecalho mudando de 446 px para 461 px.
  //
  // `crossOrigin: "anonymous"` NAO e opcional, mesmo na mesma origem: fonte e
  // buscada em modo CORS, e um preload sem ele nao casa com a requisicao da
  // `@font-face` — o navegador baixaria a fonte DUAS vezes.
  preload(FONT_PATH, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <html lang="pt-BR">
      <body>
        <a className="skip-link" href="#main-content">
          Pular para o conteúdo
        </a>
        <SiteHeader />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
