/**
 * config.ts — o sistema de anuncios OpaPreco esta ligado nesta instalacao?
 * PURO: so leitura de `process.env`, POR REQUISICAO (nunca no build; nenhuma
 * variavel `NEXT_PUBLIC_`). Server-only por uso: client component nao importa.
 *
 * ============================================================================
 * DESLIGADO POR PADRAO
 * ============================================================================
 * Sem configuracao, `<AdSlot>` devolve `null` e as rotas `/api/opapreco/**`
 * respondem 204: a pagina sai exatamente como antes. Ha dois jeitos de ligar:
 *
 *  - `live`: `OPAPRECO_AD_SERVER_URL` (https) + `OPAPRECO_PUBLISHER_ID`. As
 *    imagens de produto so aparecem para os hosts de `OPAPRECO_IMAGE_HOSTS`
 *    (lista separada por virgula; `*.dominio` aceita subdominios) — fora dela a
 *    oferta mostra o icone neutro.
 *  - `fixtures`: `OPAPRECO_MODE=fixtures`, so para QA visual. Serve as ofertas
 *    ficticias do canonico. RECUSADO na origem oficial (`https://cinerie.com`):
 *    oferta inventada no site publico seria anuncio falso.
 *
 * `OPAPRECO_MODE=off` desliga tudo, mesmo com o ad server configurado (chave de
 * emergencia, lida a cada requisicao como as outras).
 *
 * ANTES DE LIGAR `live` EM PRODUCAO: ver `docs/opapreco/DECISIONS.md` — a
 * Politica de Privacidade nao muda enquanto imagem e impressao passam pela
 * origem da Cinerie, mas o ad server precisa aceitar os ids de slot da Cinerie.
 */

import { OFFICIAL_SITE_URL, configuredSiteUrl } from "../site";

export const OPAPRECO_AD_SERVER_URL_ENV = "OPAPRECO_AD_SERVER_URL";
export const OPAPRECO_PUBLISHER_ID_ENV = "OPAPRECO_PUBLISHER_ID";
export const OPAPRECO_IMAGE_HOSTS_ENV = "OPAPRECO_IMAGE_HOSTS";
export const OPAPRECO_MODE_ENV = "OPAPRECO_MODE";

export interface OpaPrecoEnv {
  /** `process.env` inteiro cabe aqui (sem a assinatura, o TS o recusa como "tipo fraco"). */
  readonly [key: string]: string | undefined;
  readonly OPAPRECO_AD_SERVER_URL?: string;
  readonly OPAPRECO_PUBLISHER_ID?: string;
  readonly OPAPRECO_IMAGE_HOSTS?: string;
  readonly OPAPRECO_MODE?: string;
  readonly CINERIE_PUBLIC_SITE_URL?: string;
  readonly THE_SCREEN_PUBLIC_SITE_URL?: string;
}

export type OpaPrecoConfig =
  | { readonly mode: "off" }
  | {
      readonly mode: "live";
      readonly adServerUrl: string;
      readonly publisher: string;
      readonly imageHosts: readonly string[];
    }
  | { readonly mode: "fixtures" };

function trimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const text = value.trim();
  return text === "" ? null : text;
}

function httpsUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** `a.com, *.b.com` -> `["a.com", "*.b.com"]` (minusculas, sem esquema nem barra). */
export function parseImageHosts(value: string | undefined): readonly string[] {
  const raw = trimmed(value);
  if (raw === null) return [];
  return raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => /^(?:\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/.test(host));
}

export function readOpaPrecoConfig(env: OpaPrecoEnv = process.env): OpaPrecoConfig {
  const mode = trimmed(env.OPAPRECO_MODE)?.toLowerCase() ?? null;
  if (mode === "off") return { mode: "off" };

  if (mode === "fixtures") {
    // Oferta ficticia nunca no site publico, nem por engano de painel.
    if (configuredSiteUrl(env) === OFFICIAL_SITE_URL) return { mode: "off" };
    return { mode: "fixtures" };
  }

  const adServerUrl = httpsUrl(trimmed(env.OPAPRECO_AD_SERVER_URL));
  const publisher = trimmed(env.OPAPRECO_PUBLISHER_ID);
  if (adServerUrl === null || publisher === null) return { mode: "off" };
  return { mode: "live", adServerUrl, publisher, imageHosts: parseImageHosts(env.OPAPRECO_IMAGE_HOSTS) };
}

/** `<AdSlot>` renderiza alguma coisa? */
export function isOpaPrecoEnabled(env: OpaPrecoEnv = process.env): boolean {
  return readOpaPrecoConfig(env).mode !== "off";
}

/** O host da imagem esta na lista? (`*.x.com` casa `a.x.com`, nunca `x.com.evil`) */
export function isAllowedImageHost(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) =>
    entry.startsWith("*.") ? host.endsWith(entry.slice(1)) && host.length > entry.length - 1 : host === entry,
  );
}

/** Caminho do proxy de imagem de mesma origem. */
export const OPAPRECO_IMAGE_PROXY_PATH = "/api/opapreco/img";

/** Placeholders locais do modo `fixtures` (servidos por `public/`). */
export const OPAPRECO_FIXTURE_IMAGE_PREFIX = "/media/demo/opapreco/";

/**
 * A URL de imagem que o navegador pode pedir: o proxy, para host liberado e
 * https; o placeholder local, no modo fixtures; nada (icone neutro) no resto.
 */
export function resolveOfferImage(src: string, config: OpaPrecoConfig): string | null {
  if (config.mode === "fixtures") {
    return src.startsWith(OPAPRECO_FIXTURE_IMAGE_PREFIX) && !src.includes("..") ? src : null;
  }
  if (config.mode !== "live") return null;
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
    if (!isAllowedImageHost(url.hostname, config.imageHosts)) return null;
    return `${OPAPRECO_IMAGE_PROXY_PATH}?src=${encodeURIComponent(url.toString())}`;
  } catch {
    return null;
  }
}
