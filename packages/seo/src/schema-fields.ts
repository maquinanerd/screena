/**
 * schema-fields.ts — campos de schema.org montados a partir do que a pagina
 * MOSTRA. PURO: sem rede, banco ou relogio.
 *
 * AUDITORIA DE SEO (11/09/2026, secao 3.5): `Movie` saia sem `image` —
 * propriedade obrigatoria para o Google — e sem `director`, `genre` e `duration`,
 * todos visiveis na pagina; `TVSeries` e `Person` sem `image`. O unico tipo com
 * `image` era `TVEpisode`: inconsistencia, nao politica.
 *
 * Estes helpers so FORMATAM o que o chamador ja exibe. Nada e buscado, estimado
 * ou completado: entrada vazia vira campo ausente, nunca campo vazio — um
 * `director: []` afirmaria que o filme nao tem direcao.
 */

const ABSOLUTE_URL = /^https?:\/\//i;

/** URL absoluta, caminho do proprio site resolvido na origem, ou `null`. */
function absoluteUrl(src: string | null | undefined, siteUrl: string): string | null {
  const value = (src ?? "").trim();
  if (value === "") return null;
  if (ABSOLUTE_URL.test(value)) return value;
  // So caminho absoluto do proprio site (`/media/...`). Protocolo-relativo e
  // caminho relativo nao sao resolvidos: adivinhar a base publicaria URL errada.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return `${siteUrl.trim().replace(/\/+$/, "")}${value}`;
}

/** As imagens que a pagina exibe, absolutas e sem repeticao, na ordem recebida. */
export function schemaImageUrls(
  sources: readonly (string | null | undefined)[],
  siteUrl: string,
): string[] {
  const urls: string[] = [];
  for (const source of sources) {
    const url = absoluteUrl(source, siteUrl);
    if (url !== null && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

export interface SchemaPersonInput {
  readonly name: string;
  /** Caminho da pagina da pessoa no site, quando ela existe. */
  readonly href: string | null;
}

export interface SchemaPerson {
  "@type": "Person";
  name: string;
  url?: string;
}

/**
 * As pessoas que a pagina cita, com o nome exibido. `url` so quando a pagina da
 * pessoa existe — pessoa sem pagina sai so com o nome, nunca com link inventado.
 * A mesma pagina citada duas vezes entra uma vez; homonimos sem pagina, nao se
 * fundem (o nome sozinho nao prova que sao a mesma pessoa).
 */
export function schemaPeople(people: readonly SchemaPersonInput[], siteUrl: string): SchemaPerson[] {
  const out: SchemaPerson[] = [];
  const seenUrls = new Set<string>();
  for (const person of people) {
    const name = person.name.trim();
    if (name === "") continue;
    const url = absoluteUrl(person.href, siteUrl);
    if (url !== null) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      out.push({ "@type": "Person", name, url });
    } else {
      out.push({ "@type": "Person", name });
    }
  }
  return out;
}

/**
 * Minutos -> duracao ISO 8601 (`PT2H28M`). Zero, negativo ou nao inteiro nao e
 * duracao: o campo sai ausente.
 */
export function toIsoDuration(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${rest > 0 ? `${rest}M` : ""}`;
}
