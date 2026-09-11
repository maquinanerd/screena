import type { ReactNode } from "react";

import type {
  RatingsPanelItem,
  RatingsPanelView,
} from "../../src/lib/ratings-presenter";

/**
 * RatingsPanel — a fileira "AVALIACOES" do canonico (telas 06 e 07): tres
 * colunas, cada uma com a MARCA da fonte, o valor com a escala em corpo menor
 * ("8.4/10", "88%") e o volume em corpo miudo embaixo.
 *
 * PRESENTACIONAL e PURO: recebe a `RatingsPanelView` ja montada pelo presenter
 * (`ratings-presenter.ts`) e so produz JSX. Nao importa @screena/db nem faz IO
 * (invariantes 3/4).
 *
 * ============================================================================
 * O QUE SAIU DO CARTAO EM 20/08/2026 — decisao do dono, item por item
 * ============================================================================
 * O topo e o canonico e mais nada. Tres linhas que viviam aqui SAIRAM DO
 * CARTAO (nao do produto):
 *
 *  - "IMDb · Publico" (a linha de metrica): o logo/marca ja diz a fonte. A
 *    metrica e a natureza da nota migraram para o `title` (tooltip) e para os
 *    `data-*` do chip — maquina e auditoria continuam lendo.
 *  - "Cada nota esta na escala da propria fonte...": a escala aparece no
 *    proprio valor ("/10", "%").
 *  - "Atualizado em DD/MM/AAAA": a data de coleta vive no `title`/`data-*` de
 *    cada chip.
 *
 * EXCECAO DE DESAMBIGUACAO (tecnica, nao ressalva): se a MESMA fonte aparecer
 * duas vezes na fileira (ex.: Tomatometer critica + Popcornmeter publico do
 * Rotten Tomatoes), a natureza da nota VOLTA a ser visivel nesses chips —
 * duas notas diferentes sob a mesma marca sem rotulo seriam indistinguiveis, e
 * Tomatometer != Popcornmeter e lei (invariante 1). Hoje so a critica do RT e
 * exibida, entao o caminho comum nao mostra a linha.
 *
 * ============================================================================
 * TRES COISAS AQUI NAO SAO ESCOLHA DE DESIGN. Nao "simplifique" nenhuma delas.
 * ============================================================================
 * 1. O CREDITO TEXTUAL mora no RODAPE GLOBAL (decisao de 2026-08-13) — o chip
 *    nao o reintroduz. `attribution` continua viajando no item (proveniencia).
 * 2. A MARCA no slot vem do ARQUIVO que a licenca declara (IMDb e Metacritic
 *    desde 2026-09-11, ordem expressa do proprietario). Sem arquivo presente, o
 *    slot carrega a PALAVRA-MARCA — mesma caixa, mesma ancora (Rotten Tomatoes,
 *    cuja palavra-marca oficial ainda nao entrou). Nenhum SVG de marca alheia e
 *    desenhado aqui: o `src` e o que o presenter repassou da licenca.
 * 3. O ICONE DE ESTADO (tomate Fresh) fica A ESQUERDA DO NUMERO, como o titular
 *    exige, e so existe quando o VALOR esta na faixa do estado (>= 60%). Ele
 *    nunca ocupa o slot da marca: afirma um resultado, e marca nao afirma nada.
 *
 * `fetchPriority="low"` nas imagens NAO e enfeite: o SSR do React 19 emite um
 * `<link rel="preload" as="image">` de prioridade ALTA para toda `<img>` eager
 * — cada marca de fonte disputaria banda com a imagem principal da pagina
 * (LCP). Prioridade baixa mantem o carregamento imediato sem o preload.
 *
 * Governanca de leitura (invariantes 1 e 2): cada nota na escala da PROPRIA
 * fonte; o fornecedor tecnico (OMDb) nunca citado como autor; este painel
 * NUNCA agrega, calcula media ou emite AggregateRating.
 */

interface RatingsPanelProps {
  /** View ja filtrada/creditada pelo presenter; `null` quando nao ha nota. */
  view: RatingsPanelView | null;
}

/**
 * Slot da marca da fonte. O ARQUIVO declarado pela licenca quando presente;
 * senao a PALAVRA-MARCA em texto. Caixa de altura fixa via CSS.
 *
 * Com logo, o `alt` e o nome da fonte: aqui a imagem SUBSTITUI o texto do slot
 * (diferente do rodape, onde o logo acompanha um credito escrito ao lado).
 */
function RatingSourceMark({ item }: { item: RatingsPanelItem }): ReactNode {
  if (item.logo !== null) {
    return (
      <span
        className="rating-chip__mark rating-chip__mark--logo"
        data-rating-mark={item.sourceKey}
      >
        <img
          alt={item.sourceLabel}
          className="rating-chip__logo"
          decoding="async"
          fetchPriority="low"
          height={item.logo.heightPx}
          src={item.logo.src}
          style={{ height: `${item.logo.heightPx}px` }}
          width={item.logo.widthPx ?? undefined}
        />
      </span>
    );
  }
  return (
    <span className="rating-chip__mark" data-rating-mark={item.sourceKey}>
      {item.sourceLabel}
    </span>
  );
}

/**
 * Um chip: marca, numero com o sufixo da fonte em corpo menor, volume embaixo.
 *
 * A proveniencia que saiu do cartao viaja no `title` (tooltip) e nos `data-*`:
 * metrica, natureza, data de coleta e URL da fonte. Nao e credito (o credito e
 * do rodape) — e o rastro de auditoria que o leitor pode inspecionar.
 */
function RatingChip({
  item,
  showTypeLabel,
  updatedAtLabel,
}: {
  item: RatingsPanelItem;
  showTypeLabel: boolean;
  updatedAtLabel: string | null;
}): ReactNode {
  const provenance = [
    `${item.metricLabel} · ${item.scoreTypeLabel}`,
    updatedAtLabel,
    item.attribution.url,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
  return (
    <li
      className="rating-chip"
      data-rating-source={item.sourceKey}
      data-rating-metric={item.metricLabel}
      data-rating-updated={updatedAtLabel ?? undefined}
      data-rating-url={item.attribution.url ?? undefined}
      data-score-type={item.scoreType}
      title={provenance}
    >
      {/* Divisoria LIDERANTE (do 2o chip em diante). Decorativa: o que separa
          as notas para leitor de tela e o proprio item da lista. */}
      {item.leadingDivider ? (
        <span aria-hidden="true" className="rating-chip__divider" />
      ) : null}
      <span className="rating-chip__body">
        <RatingSourceMark item={item} />
        <span className="rating-chip__score">
          {item.stateIcon !== null ? (
            <img
              alt={item.stateIcon.alt}
              className="rating-chip__state"
              data-rating-state={item.stateIcon.alt}
              decoding="async"
              fetchPriority="low"
              height={item.stateIcon.heightPx}
              src={item.stateIcon.src}
              style={{ height: `${item.stateIcon.heightPx}px` }}
              width={item.stateIcon.widthPx ?? undefined}
            />
          ) : null}
          {item.valueLabel}
          <span className="rating-chip__suffix">{item.valueSuffix}</span>
        </span>
        {showTypeLabel ? (
          <span className="rating-chip__metric">{item.scoreTypeLabel}</span>
        ) : null}
        {item.countLabel !== null ? (
          <span className="rating-chip__meta">
            <span className="rating-chip__count">{item.countLabel}</span>
          </span>
        ) : null}
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

  // Desambiguacao: a natureza da nota so e visivel quando a MESMA fonte tem
  // mais de um chip na fileira (ver o cabecalho).
  const sourceCounts = new Map<string, number>();
  for (const item of view.items) {
    sourceCounts.set(item.sourceKey, (sourceCounts.get(item.sourceKey) ?? 0) + 1);
  }

  return (
    <div className="rating-chips">
      <ul className="rating-chips__row">
        {view.items.map((item) => (
          <RatingChip
            item={item}
            key={`${item.sourceKey}:${item.scoreType}:${item.metricLabel}`}
            showTypeLabel={(sourceCounts.get(item.sourceKey) ?? 0) > 1}
            updatedAtLabel={view.updatedAtLabel}
          />
        ))}
      </ul>
    </div>
  );
}
