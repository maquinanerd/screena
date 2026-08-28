/**
 * crew-presenter.test.ts — A equipe técnica do episódio.
 *
 * Foco: direção e roteiro vêm PRIMEIRO (é a autoria do episódio, o que muda de
 * um para o outro); função desconhecida aparece com o próprio nome e não some;
 * a mesma pessoa em duas funções ocupa duas linhas; o teto corta GRUPOS e nunca
 * pessoas dentro de um grupo.
 */

import { describe, expect, it } from "vitest";

import {
  buildCrewGroups,
  countCrewPeople,
  crewJobLabel,
  type CrewMemberInput,
} from "../crew-presenter";

/** Uma entrada mínima, para os testes só declararem o que importa. */
function membro(over: Partial<CrewMemberInput> = {}): CrewMemberInput {
  return { name: "Pessoa", department: "Directing", job: "Director", slug: null, ...over };
}

describe("buildCrewGroups: ordem", () => {
  it("Direção e Roteiro vêm antes de qualquer outra função", () => {
    // O TMDB entrega a equipe numa ordem qualquer. Quem abre a página de
    // episódio veio ver quem dirigiu e quem escreveu ESTE episódio.
    const grupos = buildCrewGroups(
      [
        membro({ name: "Ana", department: "Production", job: "Executive Producer" }),
        membro({ name: "Bia", department: "Editing", job: "Editor" }),
        membro({ name: "Caio", department: "Writing", job: "Writer" }),
        membro({ name: "Dora", department: "Directing", job: "Director" }),
      ],
      10,
    );

    expect(grupos.map((g) => g.job)).toEqual(["Director", "Writer", "Editor", "Executive Producer"]);
  });

  it("função FORA da lista de prioridade vai depois de TODA a lista, não antes", () => {
    // O bug clássico do `indexOf`: `-1` ordena antes de `0`. Uma função
    // desconhecida saltaria na frente da direção.
    const grupos = buildCrewGroups(
      [
        membro({ name: "Zeca", department: "Sound", job: "Foley Artist" }),
        membro({ name: "Dora", department: "Directing", job: "Director" }),
      ],
      10,
    );

    expect(grupos[0]?.job).toBe("Director");
    expect(grupos[1]?.job).toBe("Foley Artist");
  });

  it("empate fora da lista resolve por rótulo e depois por job: ordem TOTAL", () => {
    // Sem desempate determinístico, dois renders da MESMA entrada poderiam sair
    // em ordens diferentes.
    const entrada = [
      membro({ name: "A", job: "Gaffer" }),
      membro({ name: "B", job: "Best Boy" }),
      membro({ name: "C", job: "Dolly Grip" }),
    ];
    const uma = buildCrewGroups(entrada, 10).map((g) => g.job);
    const outra = buildCrewGroups([...entrada].reverse(), 10).map((g) => g.job);

    expect(uma).toEqual(["Best Boy", "Dolly Grip", "Gaffer"]);
    expect(uma).toEqual(outra);
  });
});

describe("buildCrewGroups: rótulos", () => {
  it("traduz as funções que a ficha de episódio nomeia", () => {
    expect(crewJobLabel("Director")).toBe("Direção");
    expect(crewJobLabel("Writer")).toBe("Roteiro");
  });

  it("função DESCONHECIDA aparece com o próprio nome, nunca como 'Outro'", () => {
    // Inventar um rótulo esconderia uma função nova do fornecedor; sumir com a
    // linha esconderia gente que trabalhou no episódio.
    expect(crewJobLabel("Foley Artist")).toBe("Foley Artist");

    const grupos = buildCrewGroups([membro({ name: "Zeca", job: "Foley Artist" })], 10);
    expect(grupos[0]?.label).toBe("Foley Artist");
  });
});

describe("buildCrewGroups: agrupamento", () => {
  it("duas pessoas na MESMA função ficam no mesmo grupo", () => {
    const grupos = buildCrewGroups(
      [
        membro({ name: "Ana", job: "Writer" }),
        membro({ name: "Bia", job: "Writer" }),
      ],
      10,
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.people.map((p) => p.name)).toEqual(["Ana", "Bia"]);
  });

  it("a MESMA pessoa em duas funções ocupa DUAS linhas", () => {
    // Brendan Hunt escreve e dirige. Colapsar por pessoa apagaria uma das duas
    // funções da ficha — e é o cuidado que `dedupeCrew` já toma na ingestão.
    const grupos = buildCrewGroups(
      [
        membro({ name: "Brendan Hunt", department: "Writing", job: "Writer" }),
        membro({ name: "Brendan Hunt", department: "Directing", job: "Director" }),
      ],
      10,
    );

    expect(grupos.map((g) => g.job)).toEqual(["Director", "Writer"]);
    expect(countCrewPeople(grupos)).toBe(2);
  });

  it("a mesma pessoa DUAS vezes na mesma função não vira nome repetido", () => {
    // Dois `credit_id` para o mesmo par pessoa/função existem no TMDB.
    const grupos = buildCrewGroups(
      [
        membro({ name: "Ana", job: "Writer" }),
        membro({ name: "Ana", job: "Writer" }),
      ],
      10,
    );

    expect(grupos[0]?.people).toHaveLength(1);
  });

  it("o link só existe com slug; sem slug o nome é TEXTO, nunca link quebrado", () => {
    const grupos = buildCrewGroups(
      [
        membro({ name: "Com página", job: "Director", slug: "declan-lowney" }),
        membro({ name: "Sem página", job: "Writer", slug: null }),
      ],
      10,
    );

    expect(grupos[0]?.people[0]?.href).toBe("/pt/pessoas/declan-lowney/");
    expect(grupos[1]?.people[0]?.href).toBeNull();
  });
});

describe("buildCrewGroups: descartes e teto", () => {
  it("entrada sem NOME ou sem JOB é descartada — nunca vira 'função desconhecida'", () => {
    const grupos = buildCrewGroups(
      [
        membro({ name: "   ", job: "Director" }),
        membro({ name: "Ana", job: null }),
        membro({ name: "Bia", job: "   " }),
        membro({ name: "Caio", job: "Director" }),
      ],
      10,
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.people.map((p) => p.name)).toEqual(["Caio"]);
  });

  it("o teto corta GRUPOS e NUNCA pessoas dentro de um grupo", () => {
    // Cortar dentro de "Direção" esconderia um dos dois diretores de um
    // episódio sem dizer que escondeu.
    const grupos = buildCrewGroups(
      [
        membro({ name: "Ana", job: "Director" }),
        membro({ name: "Bia", job: "Director" }),
        membro({ name: "Caio", job: "Writer" }),
        membro({ name: "Dora", job: "Editor" }),
      ],
      1,
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.job).toBe("Director");
    // Os DOIS diretores continuam lá.
    expect(grupos[0]?.people).toHaveLength(2);
  });

  it("teto inválido (0, negativo, não-inteiro) devolve TUDO em vez de nada", () => {
    // Um teto inválido virando 0 apagaria a seção inteira em silêncio.
    const entrada = [membro({ name: "Ana", job: "Director" }), membro({ name: "Bia", job: "Writer" })];
    for (const teto of [0, -3, 1.5, Number.NaN]) {
      expect(buildCrewGroups(entrada, teto)).toHaveLength(2);
    }
  });

  it("lista vazia devolve [] — a seção é omitida, nunca desenhada vazia", () => {
    expect(buildCrewGroups([], 10)).toEqual([]);
    expect(countCrewPeople([])).toBe(0);
  });
});
