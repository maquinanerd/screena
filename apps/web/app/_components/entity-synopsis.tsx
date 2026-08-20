/**
 * entity-synopsis.tsx — A sinopse do hero, e a procedencia do idioma junto.
 *
 * Existe porque filme e serie renderizavam `view.metaDescription` cru, e a
 * politica de idioma do T2 (sob demanda aceita o idioma de origem) nao tinha
 * nenhum lugar na tela onde aparecer. O componente e o unico ponto de render da
 * sinopse nas duas verticais: acrescentar uma terceira sem o aviso exigiria
 * ignorar este arquivo de proposito.
 *
 * DESDE 20/08/2026 o TOPO nao e mais o despejo inteiro da TMDB: com `maxChars`
 * o texto e cortado em PALAVRA INTEIRA (tres linhas na largura do canonico) e o
 * texto completo vive na secao "A OBRA". O CSS ainda aplica `line-clamp: 3`
 * como cinto de seguranca para larguras menores.
 *
 * O aviso de idioma NAO e decorativo, e NAO sai com o corte. Sem ele, o leitor
 * le um paragrafo em ingles numa pagina em portugues e conclui que o site esta
 * quebrado — quando na verdade o texto e o original e a traducao e que ainda
 * nao existe (decisao de 2026-08-17; a marca e TIPO obrigatorio). `lang` no
 * `<p>` e o par tecnico do aviso.
 */

import { truncateAtWord } from "../../src/lib/detail-hero";
import type { SynopsisView } from "../../src/lib/synopsis-language";

export interface EntitySynopsisProps {
  /** `null` = nao ha texto em nenhum idioma; a secao inteira e omitida. */
  readonly synopsis: SynopsisView | null;
  /**
   * Orcamento de caracteres do TOPO (corte em palavra inteira). Sem ele, o
   * texto sai completo — e o modo da secao "A OBRA".
   */
  readonly maxChars?: number;
  /** `work` = corpo da secao "A OBRA" (texto completo); default = hero. */
  readonly variant?: "hero" | "work";
}

export function EntitySynopsis({ synopsis, maxChars, variant = "hero" }: EntitySynopsisProps) {
  if (synopsis === null) return null;

  const cut = maxChars === undefined ? null : truncateAtWord(synopsis.text, maxChars);
  const text = cut === null ? synopsis.text : cut.text;
  const truncated = cut !== null && cut.truncated;
  const textClass = variant === "work" ? "synopsis-body" : "detail-hero__synopsis";
  const noticeClass =
    variant === "work" ? "synopsis-body__notice" : "detail-hero__synopsis-notice";

  // `published_locale` e o caminho comum: nada muda em relacao ao que existia.
  if (synopsis.source === "published_locale") {
    return (
      <p className={textClass} data-synopsis-truncated={truncated ? "true" : undefined}>
        {text}
      </p>
    );
  }

  // `notice` e obrigatorio no tipo — nao ha ramo em que o texto estrangeiro
  // saia sem ele, cortado ou nao.
  return (
    <div className={variant === "work" ? undefined : "detail-hero__synopsis-group"}>
      <p
        className={textClass}
        data-synopsis-source="original_language"
        data-synopsis-truncated={truncated ? "true" : undefined}
        lang={synopsis.languageCode}
      >
        {text}
      </p>
      <p className={noticeClass}>{synopsis.notice}</p>
    </div>
  );
}
