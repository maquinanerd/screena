/**
 * known-for-department-single-source.test.ts — A TRAVA contra a terceira copia.
 *
 * O HISTORICO QUE ESTE ARQUIVO EXISTE PARA NAO REPETIR. A traducao pt-BR de
 * `known_for_department` nasceu duas vezes: na PR #13 (detalhe de pessoa) e na
 * PR #14 (indice `/pt/pessoas/`), dias uma da outra. As duas copias conviveram
 * por meses sem ninguem notar — ate a PR #186 acentuar UMA delas. Producao
 * passou a escrever "Atuação" no detalhe e "Atuacao" no indice, para a MESMA
 * pessoa, e o teste do indice AFIRMAVA a grafia errada como esperada.
 *
 * Consertar as duas copias nao resolve nada: resolve ate a terceira. O que
 * faltava era uma regra que reprovasse a copia no momento em que ela e escrita.
 *
 * Esta trava e deliberadamente ESTRUTURAL, nao textual: ela conta em quantos
 * arquivos a TABELA existe. Um teste que comparasse os rotulos ("os dois dizem
 * Atuação?") passaria feliz com duas tabelas que por acaso concordam hoje — e
 * voltaria a divergir na proxima vez que alguem editar so uma.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const LIB = path.join(ROOT, "apps", "web", "src", "lib");
const CANONICO = path.join(LIB, "known-for-department.ts");

/**
 * Marcadores que so aparecem onde a tabela e DECLARADA.
 *
 * Sao os VALORES pt-BR, nao as chaves do TMDB: chave curta (`Acting`) aparece
 * solta em fixture de teste, e chave sem aspas (`Directing:`) nao casa com
 * busca por string entre aspas — foi exatamente assim que a primeira versao
 * desta trava nasceu vacua, e o controle positivo a reprovou.
 */
const MARCADORES_DA_TABELA = ["Figurino e Maquiagem", "Efeitos Visuais"] as const;

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    if (statSync(cheio).isDirectory()) {
      saida.push(...arquivosTs(cheio));
      continue;
    }
    if (nome.endsWith(".ts") || nome.endsWith(".tsx")) saida.push(cheio);
  }
  return saida;
}

/** Arquivos que declaram a tabela (nao apenas mencionam o nome dela). */
function arquivosQueDeclaramATabela(): string[] {
  return arquivosTs(LIB).filter((arquivo) => {
    const fonte = readFileSync(arquivo, "utf8");
    // Declarar = trazer os rotulos da tabela. Importar/reexportar o simbolo nao
    // traz nenhum deles, entao um alias nunca conta como copia.
    return MARCADORES_DA_TABELA.every((marcador) => fonte.includes(marcador));
  });
}

describe("a tabela de departamentos existe UMA vez", () => {
  it("CONTROLE POSITIVO: a varredura acha o arquivo canonico (senao seria vacua)", () => {
    // Sem isto, um erro de caminho faria o teste abaixo passar com zero
    // arquivos — o modo classico de uma trava morrer sem avisar.
    const declaram = arquivosQueDeclaramATabela();
    expect(declaram).toContain(CANONICO);
  });

  it("NEGATIVO: nenhum OUTRO arquivo declara a mesma tabela", () => {
    const declaram = arquivosQueDeclaramATabela();
    const intrusos = declaram.filter((arquivo) => arquivo !== CANONICO);
    expect(
      intrusos.map((arquivo) => path.relative(ROOT, arquivo)),
      "uma segunda copia da tabela de departamentos foi criada; importe de " +
        "apps/web/src/lib/known-for-department.ts em vez de redeclarar",
    ).toEqual([]);
  });
});

describe("os consumidores apontam para o simbolo unico", () => {
  it("indice, detalhe e materia resolvem para a MESMA funcao", async () => {
    const canonico = await import("../../apps/web/src/lib/known-for-department");
    const indice = await import("../../apps/web/src/lib/entity-index-presenter");
    const detalhe = await import("../../apps/web/src/lib/person-presenter");

    expect(indice.mapKnownForDepartment).toBe(canonico.mapKnownForDepartment);
    expect(detalhe.mapKnownForDepartment).toBe(canonico.mapKnownForDepartment);
  });

  it("e traduzem ACENTUADO nos tres caminhos", async () => {
    const canonico = await import("../../apps/web/src/lib/known-for-department");
    const indice = await import("../../apps/web/src/lib/entity-index-presenter");
    const detalhe = await import("../../apps/web/src/lib/person-presenter");

    for (const mapear of [
      canonico.mapKnownForDepartment,
      indice.mapKnownForDepartment,
      detalhe.mapKnownForDepartment,
    ]) {
      expect(mapear("Acting")).toBe("Atuação");
      expect(mapear("Directing")).toBe("Direção");
      expect(mapear("Production")).toBe("Produção");
    }
  });
});
