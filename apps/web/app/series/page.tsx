import { permanentRedirect } from "next/navigation";

import { SERIES_INDEX_PATH } from "../../src/lib/site";

/**
 * Alias de conveniencia /series/ -> /pt/series/ (redirect 308 permanente).
 *
 * A rota canonica publica e sempre a versao com prefixo de idioma
 * (`/pt/series/`, invariante 7). Este alias sem prefixo apenas encaminha para
 * ela — nunca serve conteudo proprio e nunca entra em sitemap/canonical. Nao e
 * redirect por idioma (Accept-Language/geo): e um encaminhamento fixo para a
 * unica listagem publicada (pt-BR).
 */
export default function SeriesAliasPage(): never {
  permanentRedirect(SERIES_INDEX_PATH);
}
