/**
 * json-ld.ts — Serializador central HTML-safe para JSON-LD.
 *
 * Prompt 3 (§7): substituir `JSON.stringify` cru injetado em
 * `<script type="application/ld+json">` por um serializador que escapa as
 * sequencias capazes de:
 *  - encerrar o `<script>` prematuramente (`</script>`, `<!--`, `<![CDATA[`);
 *  - introduzir HTML/JS via `<`, `>`, `&`;
 *  - quebrar o parser JS com separadores Unicode de linha (U+2028/U+2029), que
 *    sao validos em JSON mas ILEGAIS como quebra de linha em string JS.
 *
 * A tecnica e escapar esses caracteres para seus escapes `\uXXXX`. O resultado
 * continua JSON valido (equivalente semantico), mas nao pode fechar o script
 * nem injetar markup. E o mesmo hardening usado por frameworks maduros.
 *
 * IMPORTANTE: o codigo-fonte deste modulo e ASCII puro. Os caracteres perigosos
 * sao detectados por CODE POINT NUMERICO (`0x2028`/`0x2029`), nunca por
 * caractere cru — que editores/git podem corromper, justamente o bug que este
 * modulo previne.
 *
 * PURO: sem rede, banco, IO, `Date` ou `Math.random`.
 */

/** Code points perigosos dentro de `<script>`. */
const LESS_THAN = 0x3c; // <
const GREATER_THAN = 0x3e; // >
const AMPERSAND = 0x26; // &
const LINE_SEPARATOR = 0x2028; // U+2028
const PARAGRAPH_SEPARATOR = 0x2029; // U+2029

/**
 * Escapa uma string JSON ja serializada para ser segura dentro de um
 * `<script>`. Aplicavel a qualquer JSON, nao so JSON-LD.
 */
export function escapeJsonForHtml(json: string): string {
  let out = "";
  for (const ch of json) {
    switch (ch.charCodeAt(0)) {
      case LESS_THAN:
        out += "\\u003c";
        break;
      case GREATER_THAN:
        out += "\\u003e";
        break;
      case AMPERSAND:
        out += "\\u0026";
        break;
      case LINE_SEPARATOR:
        out += "\\u2028";
        break;
      case PARAGRAPH_SEPARATOR:
        out += "\\u2029";
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/**
 * Serializa um objeto JSON-LD (ou grafo) em string HTML-safe pronta para
 * `dangerouslySetInnerHTML={{ __html: serializeJsonLd(node) }}`.
 *
 * @param value Objeto/array JSON-LD (ex.: `{ '@context': ..., '@type': ... }`).
 * @returns String JSON escapada; nunca capaz de encerrar o `<script>`.
 */
export function serializeJsonLd(value: unknown): string {
  return escapeJsonForHtml(JSON.stringify(value));
}
