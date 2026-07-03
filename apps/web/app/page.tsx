import { permanentRedirect } from "next/navigation";

import { HOME_PATH } from "../src/lib/site";

/**
 * Raiz `/` -> `/pt/` (redirect 308 permanente).
 *
 * A home canonica publica e sempre a versao com prefixo de idioma (`/pt/`,
 * invariante 7). Este encaminhamento fixo leva a raiz nua para a unica home
 * publicada (pt-BR) — nao e redirect por idioma (Accept-Language/geo), e um
 * encaminhamento unico e deterministico, como os aliases /filmes e /series.
 */
export default function RootPage(): never {
  permanentRedirect(HOME_PATH);
}
