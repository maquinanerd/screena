import type { ReactNode } from "react";

import type {
  RatingsPanelItem,
  RatingsPanelView,
} from "../../src/lib/ratings-presenter";

/**
 * RatingsPanel — a fileira de chips "Avaliacoes" do canonico (telas 06 e 07).
 *
 * PRESENTACIONAL e PURO: recebe a `RatingsPanelView` ja montada pelo presenter
 * (`ratings-presenter.ts`) e so produz JSX. Nao importa @screena/db nem faz IO
 * (invariantes 3/4).
 *
 * ============================================================================
 * DUAS COISAS AQUI NAO SAO ESCOLHA DE DESIGN. Nao "simplifique" nenhuma delas.
 * ============================================================================
 *
 * 1. O CREDITO MORA DENTRO DO CHIP. Nao no rodape da pagina, nao numa secao
 *    "Fontes" no fim, nao num tooltip de hover, nao num `aria-label` sem texto
 *    visivel. A autorizacao das cinco fontes (2026-08-12) e condicionada a uso
 *    jornalistico COM CREDITO VISIVEL A FONTE EM TODA EXIBICAO
 *    (`requires_attribution = true` em `source_licenses`). Separar o credito da
 *    nota nao "perde o credito": derruba a NOTA, porque quem decide exibir e a
 *    mesma cadeia que obriga a creditar. Travado por
 *    `tests/governance/credit-required-on-display.test.ts` (presenter) e
 *    `ratings-panel.test.tsx` (contencao no DOM).
 *
 * 2. NAO HA LOGO. O canonico desenha a marca grafica de cada fonte (a caixa
 *    amarela do IMDb, o tomate do Rotten Tomatoes). Nao podemos: `logoAllowed`
 *    e o literal `false` no tipo de `services/legal/src/authorization-spec.ts`
 *    ("Liberar logo ou citacao exige decisao humana e mudanca de tipo"), e a
 *    propria nota das licencas diz "Logo e citacao integral de critica NAO
 *    autorizados". O slot da marca carrega o NOME da fonte em texto, com a
 *    tipografia da pagina — nunca a cor, a forma ou o desenho da marca alheia.
 *    Esta divergencia esta registrada em docs/frontend/DESIGN-DELTA-detalhe.md.
 *
 * Governanca de leitura (invariantes 1 e 2):
 *  - Cada nota aparece na escala/medida da PROPRIA fonte. O sufixo vem da fonte
 *    ("%" para Tomatometer, "/100" para Metascore) — nunca da escala nem do
 *    `score_type`, que sao iguais nos dois.
 *  - O fornecedor tecnico (OMDb) nunca e citado como autor da nota.
 *  - Este painel NUNCA agrega, calcula media ou emite AggregateRating.
 */

interface RatingsPanelProps {
  /** View ja filtrada/creditada pelo presenter; `null` quando nao ha nota. */
  view: RatingsPanelView | null;
}

/**
 * Slot da marca da fonte — TEXTO, nunca logo (ver o cabecalho, ponto 2).
 *
 * Ocupa a mesma faixa vertical que o SVG do canonico para a fileira nao mudar
 * de ritmo, mas com a tipografia da Cinerie.
 */
function RatingSourceMark({ item }: { item: RatingsPanelItem }): ReactNode {
  return (
    <span className="rating-chip__mark" data-rating-mark={item.sourceKey}>
      {item.sourceLabel}
    </span>
  );
}

/**
 * Um chip: marca, numero com o sufixo da fonte, e a linha meta.
 *
 * A linha meta e onde o canonico poe "8,1 mil" / "31 criticas". Esse volume so
 * existe para o IMDb (a OMDb devolve `imdbVotes`; Rotten Tomatoes e Metacritic
 * nao trazem contagem nenhuma no payload). Quando nao ha contagem, a linha
 * carrega SO o credito — nunca um numero de criticas fabricado para preencher
 * o desenho.
 */
function RatingChip({ item }: { item: RatingsPanelItem }): ReactNode {
  const credit =
    item.attribution.url !== null ? (
      // Linkback quando a licenca o exige E ha URL canonica derivavel do
      // payload (so o IMDb: a OMDb entrega `imdbID`). Rotten Tomatoes e
      // Metacritic nao trazem identificador — derivar um slug do titulo
      // fabricaria um link que pode nao existir, entao ali o credito e textual.
      <a
        className="rating-chip__credit-link"
        href={item.attribution.url}
        rel="nofollow noopener"
        target="_blank"
      >
        {item.attribution.text}
      </a>
    ) : (
      item.attribution.text
    );

  return (
    <li
      className="rating-chip"
      data-rating-source={item.sourceKey}
      data-score-type={item.scoreType}
    >
      {/* Divisoria LIDERANTE (do 2o chip em diante). Decorativa: o que separa
          as notas para leitor de tela e o proprio item da lista. */}
      {item.leadingDivider ? (
        <span aria-hidden="true" className="rating-chip__divider" />
      ) : null}
      <span className="rating-chip__body">
        <RatingSourceMark item={item} />
        <span className="rating-chip__score">
          {item.valueLabel}
          <span className="rating-chip__suffix">{item.valueSuffix}</span>
        </span>
        {/* Natureza da nota: Tomatometer (crítica) e Popcornmeter (público) sao
            medidas de coisas diferentes e nunca podem se confundir. */}
        <span className="rating-chip__metric">
          {item.metricLabel} · {item.scoreTypeLabel}
        </span>
        <span className="rating-chip__meta">
          {item.countLabel !== null ? (
            <span className="rating-chip__count">{item.countLabel} votos</span>
          ) : null}
          {/* O CREDITO. Dentro do chip, sempre. Ver cabecalho, ponto 1. */}
          <span className="rating-chip__credit">{credit}</span>
        </span>
      </span>
    </li>
  );
}

export function RatingsPanel({ view }: RatingsPanelProps): ReactNode {
  // Zero notas exibiveis => a fileira inteira nao renderiza. Nunca um heading
  // vazio, nunca "sem avaliacoes" (que seria uma afirmacao sobre o MUNDO; a
  // verdade e sobre NOS: nao ha nota creditada para exibir). Quem registra o
  // motivo e a pagina, via `section-absence` — a ausencia nunca e muda.
  if (view === null || view.items.length === 0) return null;

  return (
    <div className="rating-chips">
      <ul className="rating-chips__row">
        {view.items.map((item) => (
          <RatingChip
            item={item}
            key={`${item.sourceKey}:${item.scoreType}:${item.metricLabel}`}
          />
        ))}
      </ul>
      <p className="rating-chips__note">
        Cada nota está na escala da própria fonte e não é comparável entre
        fontes.
      </p>
      {view.updatedAtLabel !== null ? (
        <p className="rating-chips__updated">{view.updatedAtLabel}</p>
      ) : null}
    </div>
  );
}
