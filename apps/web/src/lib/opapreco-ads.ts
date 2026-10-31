/**
 * opapreco-ads.ts — o OpaPreço Ads da Cinerie: endereço do SDK, chave do site,
 * slots aceitos e a chave de liga/desliga. PURO: só leitura de `process.env`,
 * POR REQUISIÇÃO.
 *
 * ============================================================================
 * QUEM FAZ O QUÊ
 * ============================================================================
 * O servidor da página renderiza só o `<op-slot>` com a chave do slot e o
 * contexto da página (seção, tags, id). O script do OpaPreço, carregado de
 * `opapreco.com.br`, reserva a altura, pede a oferta (`POST /v1/ads/serve`),
 * desenha, colapsa sem anúncio e conta impressão e clique por beacon. Nada disso
 * é refeito aqui. O pedido sai do NAVEGADOR depois do render, então a página
 * continua sem API externa no render (invariante 3).
 *
 * Os slots são os que o contrato do OpaPreço aceita (ele recusa outro valor):
 *
 *  - matéria: `article-top`, `article-inline-01`, `article-inline-02` e
 *    `article-bottom`. A coluna única de 720px não tem barra lateral; `sidebar`
 *    fica no tipo para quando houver coluna lateral no desktop.
 *  - home (`/pt/`): `home-01`, `home-02` e `home-03`, três grades entre as
 *    seções (`home-like.tsx`).
 *  - listagens de filmes e de séries (`/pt/filmes/`, `/pt/series/`):
 *    `listing-01`, `listing-02` e `listing-03`, nas mesmas três posições.
 *  - fichas de filme e de série: `detail-01` (card, entre a obra e o elenco) e
 *    `detail-02` (grade, depois de "Mais como este").
 *
 * As chaves fora da matéria entraram em 2026-10-31 (contrato v1.2.0 do
 * OpaPreço). Antes de o OpaPreço aceitá-las, o servidor recusa o pedido e o
 * script colapsa o slot: nada sobra na página.
 *
 * ============================================================================
 * A CHAVE: `NEXT_PUBLIC_OPAPRECO_ADS_ENABLED`, LIDA NO SERVIDOR
 * ============================================================================
 * O nome é o do guia de integração do OpaPreço, para operar os sites da rede
 * do mesmo jeito. Mas o release constrói a imagem SEM env pública (ver o
 * `Dockerfile`): um `process.env.NEXT_PUBLIC_…` escrito literalmente seria
 * congelado no build e nunca desligaria nada em produção. Por isso a leitura é
 * `env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED`, num parâmetro, e só no servidor: o
 * Next não substitui esse acesso, e o valor do painel vale na requisição
 * seguinte, sem rebuild.
 *
 *  - `false` (ou `0`, `off`, `no`): desliga em qualquer ambiente. É a chave de
 *    emergência: some o slot, o script e a folha de estilo.
 *  - `true`: liga em qualquer ambiente. Fora de `cinerie.com` o servidor do
 *    OpaPreço recusa a origem (403) e o slot colapsa; serve para conferir a
 *    posição e o colapso numa máquina local.
 *  - ausente: liga só na produção oficial (`isOfficialProductionSurface`), a
 *    mesma condição do GA4. Assim o anúncio entra no ar junto com o código, e
 *    CI, testes e máquinas locais não falam com o OpaPreço.
 */

import { isOfficialProductionSurface, type SiteUrlEnv } from "./site";

/** A origem que atende `/v1/ads/*` e serve o SDK. */
export const OPAPRECO_ADS_ENDPOINT = "https://opapreco.com.br";

/** A chave do site no OpaPreço (cadastrado e aprovado para a Shopee). */
export const OPAPRECO_ADS_SITE_KEY = "cinerie";

export const OPAPRECO_ADS_SCRIPT_URL = `${OPAPRECO_ADS_ENDPOINT}/v1/ads/sdk/opapreco-ads.js`;
export const OPAPRECO_ADS_STYLESHEET_URL = `${OPAPRECO_ADS_ENDPOINT}/v1/ads/sdk/opapreco-ads.css`;

/**
 * De onde vem a imagem do produto: o próprio OpaPreço (`/media/…`) ou o CDN de
 * imagem da Shopee. É a lista de hosts que o servidor do OpaPreço aceita para
 * imagem (`HOSTS_DE_IMAGEM_SHOPEE` + o host do site); o CSP libera os dois.
 */
export const OPAPRECO_ADS_IMAGE_ORIGINS = [OPAPRECO_ADS_ENDPOINT, "https://cf.shopee.com.br"] as const;

export const OPAPRECO_ADS_SLOT_KEYS = [
  "article-top",
  "article-inline-01",
  "article-inline-02",
  "article-bottom",
  "sidebar",
  "home-01",
  "home-02",
  "home-03",
  "listing-01",
  "listing-02",
  "listing-03",
  "detail-01",
  "detail-02",
] as const;

export type OpaPrecoAdSlotKey = (typeof OPAPRECO_ADS_SLOT_KEYS)[number];

export const OPAPRECO_ADS_ENABLED_ENV = "NEXT_PUBLIC_OPAPRECO_ADS_ENABLED";

export interface OpaPrecoAdsEnv extends SiteUrlEnv {
  readonly NEXT_PUBLIC_OPAPRECO_ADS_ENABLED?: string;
}

const OFF_VALUES = new Set(["false", "0", "off", "no"]);
const ON_VALUES = new Set(["true", "1", "on", "yes"]);

/** O OpaPreço Ads está ligado nesta requisição? */
export function isOpaPrecoAdsEnabled(env: OpaPrecoAdsEnv = process.env): boolean {
  const flag = env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED?.trim().toLowerCase() ?? "";
  if (OFF_VALUES.has(flag)) return false;
  if (ON_VALUES.has(flag)) return true;
  return isOfficialProductionSurface(env);
}

/**
 * O atributo `tags` do `<op-slot>`: valores separados por vírgula, sem vírgula
 * DENTRO de um valor (ela é o separador), sem repetição e sem vazio. `undefined`
 * quando não sobra nada, para o atributo nem sair no HTML.
 */
export function opaPrecoAdTags(values: readonly (string | null | undefined)[]): string | undefined {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const tag = (value ?? "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (tag === "") continue;
    const key = tag.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags.length > 0 ? tags.join(",") : undefined;
}
