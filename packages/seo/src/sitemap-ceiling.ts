/**
 * sitemap-ceiling.ts — o teto do sitemap POR TIPO.
 *
 * O QUE MUDOU (2026-09-11). Havia UM teto para o sitemap INTEIRO
 * (`SITEMAP_TOTAL_URL_CEILING = 300_000`), e estoura-lo fazia o index sair VAZIO.
 * O desenho tinha um bom motivo — publicar milhoes de URLs por engano custa mais
 * que publicar nenhuma por um ciclo — e um defeito que a auditoria de SEO mediu
 * com data: **um tipo que crescesse sozinho apagava todos os outros.** Galerias
 * passando do limite tiravam do indice filmes, series e noticias que nao tinham
 * nada com isso. Em 11/09 eram 161.673 URLs, e a projecao linear punha o estouro
 * entre ~21/10 e ~06/11/2026.
 *
 * AGORA cada tipo tem o SEU teto. Estourar o teto de um tipo tira do sitemap SO
 * aquele tipo; os demais seguem publicados. O detector de fumaca continua, e
 * ficou mais cedo: a mesma leitura que exclui tambem avisa em 80%, 90% e 95%.
 *
 * O QUE NAO MUDOU. Estourar continua sendo fail-closed — so que por tipo. Um
 * tipo acima do teto nao e "cortado nas primeiras N URLs": publicar um recorte
 * arbitrario seria anunciar como valido um subconjunto que ninguem escolheu.
 *
 * MODULO PURO: sem banco, sem IO, sem Date. Quem conta e quem loga e a fronteira
 * (`apps/web/src/server/seo/sitemap-index.ts`). A regra mora aqui para ser
 * testada sem banco — e para que o index e o shard nao possam decidir diferente.
 */

/**
 * Frações do teto em que um tipo passa a gerar ALERTA. O tipo continua
 * publicado; o alerta existe para que alguem olhe antes do corte, e nao depois.
 */
export const SITEMAP_CEILING_ALERT_RATIOS = Object.freeze([0.8, 0.9, 0.95] as const);

/** Nivel de um tipo em relacao ao seu teto. */
export type SitemapCeilingLevel =
  /** Abaixo de 80%. */
  | "ok"
  /** A partir de 80%: publicado, com alerta. */
  | "alert-80"
  /** A partir de 90%: publicado, com alerta. */
  | "alert-90"
  /** A partir de 95%: publicado, com alerta. */
  | "alert-95"
  /** Exatamente no teto: publicado, com alerta. O proximo passo ja corta. */
  | "at-ceiling"
  /** Acima do teto: o tipo SAI do sitemap. Os outros ficam. */
  | "over-ceiling"
  /** Teto ausente ou invalido: o tipo SAI (fail-closed por tipo). */
  | "invalid-ceiling"
  /** Contagem ausente, negativa ou nao numerica: o tipo SAI. */
  | "invalid-count";

/** Veredito de um tipo. */
export interface SitemapTypeCeilingVerdict {
  readonly type: string;
  readonly count: number;
  readonly ceiling: number;
  /** `count / ceiling`; `Infinity` quando o teto e invalido. */
  readonly ratio: number;
  readonly level: SitemapCeilingLevel;
  /** `true` => o tipo NAO entra no sitemap. So ele. */
  readonly excluded: boolean;
}

/** Resultado da avaliacao de todos os tipos de uma vez. */
export interface SitemapCeilingReport {
  /** Um veredito por tipo, na ORDEM em que as contagens chegaram. */
  readonly verdicts: readonly SitemapTypeCeilingVerdict[];
  /** Tipos que seguem publicados. */
  readonly published: readonly string[];
  /** Tipos excluidos (acima do teto ou com dado invalido). */
  readonly excluded: readonly string[];
  /** Tipos publicados que estao em algum nivel de alerta. */
  readonly alerts: readonly SitemapTypeCeilingVerdict[];
}

const EXCLUDING_LEVELS: ReadonlySet<SitemapCeilingLevel> = new Set([
  "over-ceiling",
  "invalid-ceiling",
  "invalid-count",
]);

const ALERT_LEVELS: ReadonlySet<SitemapCeilingLevel> = new Set([
  "alert-80",
  "alert-90",
  "alert-95",
  "at-ceiling",
]);

function verdict(
  type: string,
  count: number,
  ceiling: number,
  ratio: number,
  level: SitemapCeilingLevel,
): SitemapTypeCeilingVerdict {
  return { type, count, ceiling, ratio, level, excluded: EXCLUDING_LEVELS.has(level) };
}

/**
 * Avalia UM tipo contra o seu teto.
 *
 * Ordem das checagens, da mais tecnica para a mais editorial: um teto que nao
 * existe nao pode aprovar nada; uma contagem que nao e numero nao pode ser
 * comparada; so entao se compara.
 */
export function evaluateSitemapTypeCeiling(
  type: string,
  count: number,
  ceiling: number | undefined,
): SitemapTypeCeilingVerdict {
  if (ceiling === undefined || !Number.isFinite(ceiling) || ceiling <= 0) {
    return verdict(type, count, ceiling ?? 0, Number.POSITIVE_INFINITY, "invalid-ceiling");
  }
  if (!Number.isFinite(count) || count < 0) {
    return verdict(type, count, ceiling, Number.NaN, "invalid-count");
  }

  const ratio = count / ceiling;
  if (count > ceiling) return verdict(type, count, ceiling, ratio, "over-ceiling");
  if (count === ceiling) return verdict(type, count, ceiling, ratio, "at-ceiling");

  const [alerta80, alerta90, alerta95] = SITEMAP_CEILING_ALERT_RATIOS;
  if (ratio >= alerta95) return verdict(type, count, ceiling, ratio, "alert-95");
  if (ratio >= alerta90) return verdict(type, count, ceiling, ratio, "alert-90");
  if (ratio >= alerta80) return verdict(type, count, ceiling, ratio, "alert-80");
  return verdict(type, count, ceiling, ratio, "ok");
}

/**
 * Avalia TODOS os tipos. Cada um e decidido sozinho: nenhum veredito depende da
 * contagem de outro tipo — e essa independencia e a correcao inteira.
 */
export function evaluateSitemapCeilings(
  counts: Readonly<Record<string, number>>,
  ceilings: Readonly<Record<string, number>>,
): SitemapCeilingReport {
  const verdicts = Object.entries(counts).map(([type, count]) =>
    evaluateSitemapTypeCeiling(type, count, ceilings[type]),
  );
  return {
    verdicts,
    published: verdicts.filter((v) => !v.excluded).map((v) => v.type),
    excluded: verdicts.filter((v) => v.excluded).map((v) => v.type),
    alerts: verdicts.filter((v) => ALERT_LEVELS.has(v.level)),
  };
}

/**
 * Linha de log em pt-BR para um veredito. Uma so funcao para o index e para o
 * shard: se cada um escrevesse a sua, a mesma causa apareceria com duas
 * redacoes no painel e ninguem saberia que e o mesmo evento.
 */
export function describeSitemapCeilingVerdict(v: SitemapTypeCeilingVerdict): string {
  const percentual = Number.isFinite(v.ratio) ? `${(v.ratio * 100).toFixed(1)}%` : "n/d";
  switch (v.level) {
    case "over-ceiling":
      return (
        `sitemap: o tipo ${v.type} tem ${v.count} URLs, acima do teto de ${v.ceiling} ` +
        `(${percentual}). SO este tipo sai do sitemap; os demais seguem publicados. ` +
        "Ou a politica de indexabilidade deste tipo parou de filtrar, ou ele mudou de ordem de grandeza."
      );
    case "invalid-ceiling":
      return `sitemap: o tipo ${v.type} nao tem teto declarado valido; fica FORA do sitemap ate ter.`;
    case "invalid-count":
      return `sitemap: a contagem do tipo ${v.type} e invalida (${String(v.count)}); fica FORA do sitemap.`;
    case "at-ceiling":
      return `sitemap: o tipo ${v.type} esta EXATAMENTE no teto (${v.count} de ${v.ceiling}); a proxima URL tira o tipo do sitemap.`;
    case "alert-95":
    case "alert-90":
    case "alert-80":
      return `sitemap: o tipo ${v.type} esta em ${percentual} do teto (${v.count} de ${v.ceiling}); publicado, mas perto do corte.`;
    case "ok":
      return `sitemap: o tipo ${v.type} esta em ${percentual} do teto (${v.count} de ${v.ceiling}).`;
  }
}
