/**
 * llms-txt.ts — o `/llms.txt` da Cinerie. PURO.
 *
 * O QUE E: um indice em Markdown para ferramentas de IA que leem sites (a
 * proposta de llmstxt.org): o que o site e, onde ficam as secoes e de onde vem os
 * dados. Auditoria de SEO de 11/09/2026: o arquivo nao existia.
 *
 * O QUE NAO E: permissao de uso. A politica de rastreamento — e de treinamento —
 * vive no `robots.txt`, inclusive no bloco que a borda acrescenta a ele. Este
 * arquivo so aponta para la e nao afirma nada que o `robots.txt` nao diga.
 *
 * Nada aqui e escrito para o arquivo: as descricoes sao as das proprias paginas,
 * e os creditos sao o texto VERBATIM das licencas (`DATA_CREDITS`, o mesmo do
 * rodape) — registrar uma fonte nova faz ela aparecer aqui sem editar este modulo.
 */

import { DATA_CREDITS, DATA_CREDITS_PATH } from "../config/footer";
import {
  EXPLORE_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  PRIVACY_PATH,
  SERIES_INDEX_PATH,
  TERMS_PATH,
  WATCH_PATH,
} from "./routes";

/** O minimo de um credito de fonte: o papel e o texto verbatim da licenca. */
export interface LlmsTxtCredit {
  readonly roleLabel: string;
  readonly text: string;
}

export function buildLlmsTxt(siteUrl: string, credits: readonly LlmsTxtCredit[] = DATA_CREDITS): string {
  const origin = siteUrl.trim().replace(/\/+$/, "");
  const link = (label: string, path: string, description?: string): string =>
    `- [${label}](${origin}${path})${description === undefined ? "" : `: ${description}`}`;

  return [
    "# Cinerie",
    "",
    "> Base de entretenimento em português do Brasil: fichas de filmes e séries, perfis de pessoas e notícias de cinema e TV.",
    "",
    "Todo o conteúdo publicado está em português do Brasil (pt-BR).",
    "",
    "## Seções",
    "",
    link("Filmes", MOVIES_INDEX_PATH, "os filmes catalogados na Cinerie"),
    link("Séries", SERIES_INDEX_PATH, "as séries catalogadas na Cinerie"),
    link("Pessoas", PEOPLE_INDEX_PATH, "atores, diretores e equipe"),
    link("Notícias", NEWS_INDEX_PATH, "notícias e análises editoriais sobre cinema e séries"),
    link(
      "Onde assistir",
      WATCH_PATH,
      "filmes e séries com disponibilidade legal de streaming no Brasil, organizados por provedor",
    ),
    link("Explorar", EXPLORE_PATH, "estreias, títulos em alta e populares"),
    "",
    "## Fontes de dados",
    "",
    ...credits.map((credit) => `- ${credit.roleLabel}: ${credit.text}`),
    "",
    "## Documentos",
    "",
    link("Créditos de dados", DATA_CREDITS_PATH),
    link("Termos de Uso", TERMS_PATH),
    link("Política de Privacidade", PRIVACY_PATH),
    link("Sitemap", "/sitemap.xml"),
    link("robots.txt", "/robots.txt", "a política de rastreamento"),
    "",
  ].join("\n");
}
