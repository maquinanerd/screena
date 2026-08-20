/**
 * entity-synopsis.tsx — A sinopse do hero, e a procedencia do idioma junto.
 *
 * Existe porque filme e serie renderizavam `view.metaDescription` cru, e a
 * politica de idioma do T2 (sob demanda aceita o idioma de origem) nao tinha
 * nenhum lugar na tela onde aparecer. O componente e o unico ponto de render da
 * sinopse nas duas verticais: acrescentar uma terceira sem o aviso exigiria
 * ignorar este arquivo de proposito.
 *
 * O aviso NAO e decorativo. Sem ele, o leitor le um paragrafo em ingles numa
 * pagina em portugues e conclui que o site esta quebrado — quando na verdade o
 * texto e o original e a traducao e que ainda nao existe. A diferenca entre
 * "quebrado" e "ainda sem traducao" e exatamente o que a frase carrega.
 *
 * `lang` no `<p>` e o par tecnico do aviso: leitor de tela troca a pronuncia
 * para o idioma certo em vez de ler ingles com fonemas de portugues.
 */

import type { SynopsisView } from "../../src/lib/synopsis-language";

export interface EntitySynopsisProps {
  /** `null` = nao ha texto em nenhum idioma; a secao inteira e omitida. */
  readonly synopsis: SynopsisView | null;
}

export function EntitySynopsis({ synopsis }: EntitySynopsisProps) {
  if (synopsis === null) return null;

  // `published_locale` e o caminho comum: nada muda em relacao ao que existia.
  if (synopsis.source === "published_locale") {
    return <p className="detail-hero__synopsis">{synopsis.text}</p>;
  }

  // `notice` e obrigatorio no tipo — nao ha ramo em que o texto estrangeiro
  // saia sem ele.
  return (
    <div className="detail-hero__synopsis-group">
      <p
        className="detail-hero__synopsis"
        lang={synopsis.languageCode}
        data-synopsis-source="original_language"
      >
        {synopsis.text}
      </p>
      <p className="detail-hero__synopsis-notice">{synopsis.notice}</p>
    </div>
  );
}
