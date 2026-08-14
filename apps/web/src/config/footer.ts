/**
 * footer.ts — Colunas, redes e créditos do rodapé global, COMO DADO.
 *
 * O componente não carrega link, nome de rede nem nome de fonte: ele itera sobre
 * o que está aqui. Isso não é preferência de organização — é o que torna a
 * decisão de 2026-08-13 (todo crédito de fonte vive no rodapé) segura:
 * um crédito que nasce de um literal no JSX é um crédito que alguém esquece de
 * atualizar.
 *
 * PURO: sem rede, banco, env ou IO. Importável por client component.
 *
 * ============================================================================
 * OS CRÉDITOS NÃO ESTÃO NESTE ARQUIVO — E ISSO É DE PROPÓSITO
 * ============================================================================
 * `DATA_CREDITS` é uma REEXPORTAÇÃO da projeção de `@screena/legal`, derivada de
 * `authorization-spec.ts`. Nenhum texto de atribuição é escrito aqui. Registrar
 * uma fonte nova na licença faz o crédito dela aparecer no rodapé sem tocar
 * neste arquivo nem no componente — travado por
 * `services/legal/src/__tests__/public-credits.test.ts` e por
 * `tests/web/footer-credits.test.tsx`.
 *
 * ============================================================================
 * POR QUE AS COLUNAS NÃO SÃO AS DA `FOOTER-SPEC.md` LETRA POR LETRA
 * ============================================================================
 * A spec lista 24 links ("Top 250", "Mais vistos", "Mais premiados", "Nascidos
 * hoje", "Imprensa", "Vagas"...). Dessas rotas, a maioria NÃO EXISTE no app.
 *
 * O rodapé anterior já tinha esses rótulos, e eles foram REMOVIDOS de propósito:
 * `docs/SCREEN_MASTER_PROJECT_AUDIT_AND_PRODUCT_ROADMAP.md` registra "12 âncoras
 * com texto distinto apontando para 3 URLs — para o usuário é uma armadilha;
 * para o crawler é diluição de sinal de anchor text". Reintroduzi-los para
 * "cumprir a spec" seria refazer um defeito que uma decisão anterior desfez.
 *
 * Então: a ESTRUTURA é a da spec (5 colunas, Filmes vermelho, Séries e TV
 * verde); o CONTEÚDO é só destino que existe. Cada rota aparece em UMA coluna —
 * repetir o mesmo href sob rótulos diferentes é o defeito acima em miniatura.
 * Área privada (listas, tracker, histórico, conta) fica fora: exige sessão e é
 * noindex.
 */

import {
  publicSourceCredits,
  tmdbNonEndorsementDisclaimer,
  type PublicSourceCredit,
} from "@screena/legal/public-credits";

import {
  EXPLORE_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
  WATCH_PATH,
} from "../lib/routes";

/** Acento do sublinhado do título de coluna. Nunca decide sozinho a vertical. */
export type FooterAccent = "movies" | "series" | "neutral";

export interface FooterLink {
  readonly label: string;
  readonly href: string;
}

export interface FooterColumn {
  readonly title: string;
  readonly accent: FooterAccent;
  readonly links: readonly FooterLink[];
}

export interface FooterSocialLink {
  readonly network: "youtube" | "instagram" | "x" | "facebook";
  readonly label: string;
  readonly href: string;
}

/** Caminho da página de créditos de dados (destino do link do rodapé). */
export const DATA_CREDITS_PATH = "/pt/creditos-de-dados/";

/** Caminho do índice do site (sitemap XML público). */
export const SITE_INDEX_PATH = "/sitemap.xml";

/**
 * As 5 colunas, na ordem da spec.
 *
 * O acento vermelho/verde é APOIO. A diferenciação filme/série continua vindo de
 * label + badge + breadcrumb + schema + URL (invariante 11) — aqui o que carrega
 * o significado é o TÍTULO da coluna e o segmento da URL, não a cor.
 */
export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "Filmes",
    accent: "movies",
    links: [
      { label: "Todos os filmes", href: MOVIES_INDEX_PATH },
      // A rota se chama `/pt/em-breve/` e a tela se intitula "Mais Aguardados".
      // O rótulo aqui acompanha a TELA, não a URL: prometer "Em breve" e entregar
      // um título diferente é a mesma desonestidade dos rótulos removidos.
      { label: "Mais Aguardados", href: "/pt/em-breve/" },
    ],
  },
  {
    title: "Séries e TV",
    accent: "series",
    links: [{ label: "Todas as séries", href: SERIES_INDEX_PATH }],
  },
  {
    title: "Celebridades",
    accent: "neutral",
    links: [{ label: "Todas as pessoas", href: PEOPLE_INDEX_PATH }],
  },
  {
    title: "Notícias",
    accent: "neutral",
    links: [{ label: "Últimas notícias", href: NEWS_INDEX_PATH }],
  },
  {
    title: "Cinerie",
    accent: "neutral",
    links: [
      { label: "Explorar", href: EXPLORE_PATH },
      { label: "Onde assistir", href: WATCH_PATH },
      { label: "Busca", href: "/pt/busca/" },
    ],
  },
];

/**
 * Redes sociais. Perfis REAIS da marca; nenhum link inventado.
 *
 * Enquanto a lista estiver vazia, a faixa de redes simplesmente não renderiza —
 * um círculo que leva a `#` ou a um perfil inexistente é pior que a ausência.
 * Preencher aqui liga a faixa inteira, sem tocar no componente.
 */
export const FOOTER_SOCIAL_LINKS: readonly FooterSocialLink[] = [];

/**
 * Créditos de fonte. DERIVADOS de `services/legal` — ver o cabeçalho.
 * Nenhum texto de atribuição é escrito neste arquivo.
 */
export const DATA_CREDITS: readonly PublicSourceCredit[] = publicSourceCredits();

/**
 * Disclaimer de não-endosso do TMDB, extraído da própria licença.
 * Exigência dos termos da API: não pode ser parafraseado nem omitido.
 */
export const TMDB_DISCLAIMER: string = tmdbNonEndorsementDisclaimer();
