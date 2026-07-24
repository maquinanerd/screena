/**
 * csv.ts — leitor de CSV PURO (C8).
 *
 * Implementa o subconjunto de RFC 4180 que os exports reais usam, sem
 * dependencia externa: campos entre aspas, aspas escapadas por duplicacao,
 * separador e quebra de linha dentro de campo citado, CRLF/LF/CR e BOM.
 *
 * PURO: sem fs, sem rede, sem relogio. Recebe o texto ja decodificado e devolve
 * linhas — quem decodifica bytes e a borda, que tambem impoe o teto de tamanho.
 *
 * FAIL-CLOSED em entrada malformada: aspas nao fechadas viram erro explicito em
 * vez de um campo que engole o resto do arquivo. Um parser tolerante demais
 * transformaria um arquivo corrompido em importacao silenciosamente errada.
 *
 * O QUE ESTE MODULO NAO FAZ, de proposito:
 *  - nao interpreta formulas (`=`, `+`, `-`, `@` no inicio do campo). Elas sao
 *    NEUTRALIZADAS na normalizacao, nao aqui: o parser devolve o texto como
 *    esta e a decisao de sanitizacao fica num lugar so;
 *  - nao le ZIP. A borda recusa arquivos compactados (ver `upload.ts`), o que
 *    elimina por completo a superficie de zip-bomb e path traversal.
 */

import { type DomainResult, err, ok } from "../core/result.js";

/** Teto de colunas por linha — barra um arquivo patologico antes da memoria. */
export const CSV_MAX_COLUMNS = 64;

/** Teto de linhas de dados aceitas em um unico arquivo. */
export const CSV_MAX_ROWS = 20_000;

export interface CsvTable {
  /** Cabecalho normalizado (trim; comparacao case-insensitive fica com quem usa). */
  readonly header: readonly string[];
  /** Linhas de dados, na ordem do arquivo. */
  readonly rows: readonly (readonly string[])[];
}

/** Remove o BOM UTF-8, que aparece em exports gerados no Windows/Excel. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Faz o parse de um CSV completo.
 *
 * A varredura e por CARACTERE, com uma maquina de dois estados (dentro/fora de
 * aspas). Uma abordagem por `split(",")` quebraria em qualquer titulo com
 * virgula — e titulos com virgula sao a regra, nao a excecao, num catalogo de
 * cinema.
 */
export function parseCsv(rawText: string, separator = ","): DomainResult<CsvTable> {
  if (separator.length !== 1) {
    return err("validation_failed", "separador de CSV invalido.");
  }

  const text = stripBom(rawText);
  if (text.trim().length === 0) {
    return err("validation_failed", "arquivo vazio.", ["o CSV nao tem conteudo"]);
  }

  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroDeAspas = false;
  let campoFoiCitado = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    if (dentroDeAspas) {
      if (ch === '"') {
        // `""` dentro de campo citado e uma aspa literal (RFC 4180).
        if (text[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += ch;
      }
      continue;
    }

    if (ch === '"' && campo.length === 0) {
      dentroDeAspas = true;
      campoFoiCitado = true;
      continue;
    }

    if (ch === separator) {
      linha.push(campo);
      campo = "";
      campoFoiCitado = false;
      if (linha.length > CSV_MAX_COLUMNS) {
        return err("validation_failed", "arquivo invalido.", [
          `linha com mais de ${CSV_MAX_COLUMNS} colunas`,
        ]);
      }
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      // CRLF conta como UMA quebra.
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      linha.push(campo);
      campo = "";
      campoFoiCitado = false;
      // Linha totalmente vazia e ignorada (rodape em branco e comum).
      if (!(linha.length === 1 && linha[0] === "")) {
        linhas.push(linha);
        if (linhas.length > CSV_MAX_ROWS + 1) {
          return err("validation_failed", "arquivo grande demais.", [
            `o CSV excede ${CSV_MAX_ROWS} linhas de dados`,
          ]);
        }
      }
      linha = [];
      continue;
    }

    campo += ch;
  }

  if (dentroDeAspas) {
    // Aspas nao fechadas: o resto do arquivo virou um campo so. Recusar e a
    // unica resposta honesta — seguir importaria lixo com cara de dado.
    return err("validation_failed", "arquivo invalido.", ["aspas nao fechadas no CSV"]);
  }

  // Ultima linha sem quebra final.
  linha.push(campo);
  if (!(linha.length === 1 && linha[0] === "")) {
    linhas.push(linha);
  }
  void campoFoiCitado;

  const cabecalho = linhas.shift();
  if (cabecalho === undefined) {
    return err("validation_failed", "arquivo vazio.", ["o CSV nao tem cabecalho"]);
  }
  if (linhas.length > CSV_MAX_ROWS) {
    return err("validation_failed", "arquivo grande demais.", [
      `o CSV excede ${CSV_MAX_ROWS} linhas de dados`,
    ]);
  }

  return ok({
    header: cabecalho.map((h) => h.trim()),
    rows: linhas,
  });
}

/**
 * Indexa o cabecalho por nome normalizado (minusculo, sem espacos nas pontas).
 *
 * Devolve um mapa nome -> indice. Cabecalho duplicado mantem a PRIMEIRA
 * ocorrencia: exports reais as vezes repetem coluna, e escolher a primeira e
 * deterministico.
 */
export function indexHeader(header: readonly string[]): ReadonlyMap<string, number> {
  const mapa = new Map<string, number>();
  header.forEach((nome, indice) => {
    const chave = nome.trim().toLowerCase();
    if (chave.length > 0 && !mapa.has(chave)) {
      mapa.set(chave, indice);
    }
  });
  return mapa;
}

/** Le uma coluna pelo nome normalizado. Ausente ou fora da linha => `null`. */
export function readColumn(
  row: readonly string[],
  header: ReadonlyMap<string, number>,
  name: string,
): string | null {
  const indice = header.get(name.trim().toLowerCase());
  if (indice === undefined) {
    return null;
  }
  const valor = row[indice];
  if (valor === undefined) {
    return null;
  }
  const limpo = valor.trim();
  return limpo.length === 0 ? null : limpo;
}
