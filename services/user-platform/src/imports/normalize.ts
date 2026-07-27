/**
 * normalize.ts — normalizacao PURA das linhas importadas (C8).
 *
 * Transforma texto de terceiro em valores que o resto do sistema aceita. Tudo
 * aqui e defensivo por padrao: um export real traz celula vazia, ano com
 * asterisco, data em formato local, nota em escala alheia e — com frequencia —
 * texto que o Excel interpretaria como formula.
 */

import type { WatchableEntityType } from "../core/types.js";

/** Teto de tamanho de um titulo aceito do arquivo (guarda de memoria). */
export const IMPORT_TITLE_MAX_LENGTH = 500;

/** Faixa de anos plausivel para cinema/TV; fora disso o ano e descartado. */
export const IMPORT_MIN_YEAR = 1870;
export const IMPORT_MAX_YEAR = 2200;

/**
 * Prefixos que uma planilha interpreta como FORMULA.
 *
 * Um titulo comecando com `=` vira execucao quando o usuario abre o arquivo
 * exportado de volta no Excel/Sheets (CSV injection). A neutralizacao acontece
 * AQUI, num lugar so, e nao no parser — o parser devolve o texto como esta.
 */
const FORMULA_PREFIXES = ["=", "+", "@", "\t", "\r"] as const;

/**
 * Neutraliza um valor que iria para uma planilha.
 *
 * Prefixa com apostrofo quando o texto comeca por caractere de formula. O
 * apostrofo e a convencao que Excel/Sheets tratam como "texto literal".
 *
 * `-` NAO entra na lista: titulos legitimos comecam com hifen ("-30-"), e
 * numeros negativos sao dado valido. O risco residual de `-1+1` e aceito e
 * registrado; barrar hifen quebraria dado real.
 */
export function neutralizeSpreadsheetFormula(value: string): string {
  if (value.length === 0) {
    return value;
  }
  const primeiro = value[0]!;
  return (FORMULA_PREFIXES as readonly string[]).includes(primeiro) ? `'${value}` : value;
}

/**
 * Normaliza um titulo para COMPARACAO (nunca para exibicao).
 *
 * Minusculo, sem diacriticos, pontuacao colapsada em espaco, espacos
 * colapsados. E o que faz "WALL·E" e "Wall-E" casarem sem recorrer a
 * similaridade difusa — que e justamente o que a missao proibe usar como
 * criterio de match automatico.
 */
export function normalizeTitleForMatch(title: string): string {
  return title
    .normalize("NFD")
    // Escape unicode, nunca o caractere combinante cru: o cru sobrevive
    // invisivel no editor e no diff (mesma classe de armadilha do byte de
    // controle ja registrada em tests/governance).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Le um ano de texto livre. Fora da faixa plausivel devolve `null`. */
export function parseYear(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const match = /(\d{4})/.exec(raw);
  if (match === null) {
    return null;
  }
  const ano = Number(match[1]);
  if (!Number.isInteger(ano) || ano < IMPORT_MIN_YEAR || ano > IMPORT_MAX_YEAR) {
    return null;
  }
  return ano;
}

/**
 * Le uma data de export.
 *
 * Aceita `YYYY-MM-DD` (o formato do Letterboxd e do nosso CSV canonico) e
 * ISO completo. Interpreta em UTC de proposito: uma data sem fuso convertida
 * pelo fuso do SERVIDOR faria o mesmo arquivo importar dias diferentes em
 * maquinas diferentes.
 *
 * Data invalida devolve `null` — e a linha segue valida sem carimbo, em vez de
 * ganhar `now()` (o que inventaria historico que o usuario nao declarou).
 */
export function parseImportDate(raw: string | null): Date | null {
  if (raw === null) {
    return null;
  }
  const somenteData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (somenteData !== null) {
    const ano = Number(somenteData[1]);
    const mes = Number(somenteData[2]);
    const dia = Number(somenteData[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return null;
    }
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    // Rejeita data que "transbordou" (31/02 viraria 03/03).
    if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
      return null;
    }
    return data;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Converte uma nota externa para a escala da Cinerie (0.5..5.0, passo 0.5).
 *
 * `sourceScale` e OBRIGATORIO e explicito: o Letterboxd exporta 0.5..5 e o IMDb
 * exportaria 1..10. Converter sem saber a escala de origem produziria a mesma
 * classe de erro que as invariantes 1 e 2 proibem para ratings externos —
 * tratar duas escalas como se fossem uma.
 *
 * Fora da faixa ou nao numerico devolve `null` (a nota e ignorada; a linha
 * continua valida para watchlist/watched).
 */
export function parseRating(raw: string | null, sourceScale: 5 | 10): number | null {
  if (raw === null) {
    return null;
  }
  const bruto = Number(raw.replace(",", "."));
  if (!Number.isFinite(bruto) || bruto <= 0) {
    return null;
  }
  const emCinco = sourceScale === 5 ? bruto : bruto / 2;
  // Arredonda para o passo 0.5 que o CHECK do banco exige.
  const passo = Math.round(emCinco * 2) / 2;
  if (passo < 0.5 || passo > 5) {
    return null;
  }
  return passo;
}

/** Extrai o id numerico do TMDB de texto livre. */
export function parseTmdbId(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const match = /^(\d{1,9})$/.exec(raw.trim());
  if (match === null) {
    return null;
  }
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Valida um id do IMDb (`tt` + digitos), que e UNIQUE no catalogo. */
export function parseImdbId(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const limpo = raw.trim().toLowerCase();
  return /^tt\d{5,12}$/.test(limpo) ? limpo : null;
}

/** Le o tipo de entidade declarado. Ausente/desconhecido => `movie`. */
export function parseEntityType(raw: string | null): WatchableEntityType {
  if (raw === null) {
    return "movie";
  }
  const valor = raw.trim().toLowerCase();
  if (valor === "tv" || valor === "series" || valor === "serie" || valor === "show") {
    return "tv";
  }
  return "movie";
}

/** Corta e neutraliza um titulo vindo do arquivo. Vazio => `null`. */
export function sanitizeTitle(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const limpo = neutralizeSpreadsheetFormula(raw.trim()).slice(0, IMPORT_TITLE_MAX_LENGTH);
  return limpo.length === 0 ? null : limpo;
}
