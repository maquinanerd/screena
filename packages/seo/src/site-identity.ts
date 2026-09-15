/**
 * site-identity.ts — a identidade UNICA da organizacao e do site no JSON-LD. PURO.
 *
 * AUDITORIA DE SEO (11/09/2026, achado M7): `Organization.url` era `/pt/`,
 * `WebSite.url` era `/` e o `publisher` das materias apontava para a origem sem
 * barra — tres enderecos para a mesma organizacao, e nenhum `@id`. Sem `@id` o
 * buscador nao tem como saber que o `publisher` de cada materia e a MESMA
 * `Organization` da home.
 *
 * Agora ha um `@id` por no (`/#organization`, `/#website`) e UMA URL publica em
 * todos: a home canonica. O `@id` e identificador, nao endereco a visitar — o
 * fragmento o separa de qualquer pagina.
 */

/** A home publica canonica. pt-BR e o unico idioma publicado (invariante 7). */
export const PUBLIC_HOME_PATH = "/pt/";

function trimmedOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/** `@id` do no `Organization`. */
export function organizationId(origin: string): string {
  return `${trimmedOrigin(origin)}/#organization`;
}

/** `@id` do no `WebSite`. */
export function websiteId(origin: string): string {
  return `${trimmedOrigin(origin)}/#website`;
}

/** A URL publica da organizacao e do site: a home canonica. */
export function publicHomeUrl(origin: string): string {
  return `${trimmedOrigin(origin)}${PUBLIC_HOME_PATH}`;
}

/**
 * `@id` da PESSOA de uma pagina de perfil (a pagina de autor): a URL do perfil
 * com fragmento. O MESMO valor vai no `author` de cada materia e no `mainEntity`
 * da pagina de autor — e assim que o buscador sabe que as duas marcacoes falam da
 * mesma pessoa.
 */
export function profilePersonId(profileUrl: string): string {
  return `${profileUrl.trim()}#person`;
}
