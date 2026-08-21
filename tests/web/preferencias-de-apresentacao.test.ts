/**
 * preferencias-de-apresentacao.test.ts — Densidade e tamanho de pôster,
 * do contrato até o efeito.
 *
 * NÃO HÁ TEMA AQUI. O produto é claro sempre (decisão do dono, 21/08/2026): a
 * coluna, o contrato, o efeito e o controle saíram juntos. O que impede o tema
 * escuro de voltar ao CSS é `tema-unico.test.ts`; o que este arquivo garante é
 * que `data-theme` nunca volte a ser ESCRITO no `<html>`.
 *
 * ============================================================================
 * O QUE ESTAVA ERRADO — E O QUE NÃO ESTAVA
 * ============================================================================
 * Os três controles eram **omitidos** da tela 13. A omissão estava CERTA: o
 * cabeçalho de `settings-panel.tsx` registra a regra da casa — *"sem preferência
 * fake: nunca toggle sem efeito"* — e não havia coluna, contrato nem efeito.
 * Mostrar um `<select>` que não salva teria sido o defeito da newsletter de novo:
 * botão morto.
 *
 * O que faltava era o backend inteiro. Este arquivo prova que ele existe, nas
 * duas pontas: o valor **chega ao banco** e o valor **muda a tela**.
 *
 * ============================================================================
 * OS DOIS LADOS PRECISAM CONCORDAR
 * ============================================================================
 * O vocabulário fechado vive em TRÊS lugares — o CHECK da coluna, o parser do
 * contrato e o módulo de efeito. Divergência entre eles é silenciosa e cara: o
 * parser aceitaria um valor que o CHECK recusa (500 em produção), ou o efeito
 * ignoraria um valor que o parser aceita (preferência salva que não faz nada).
 * O primeiro bloco compara os três.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseUpdateProfileCommand,
  PROFILE_DENSITIES,
  PROFILE_POSTER_SIZES,
} from "../../services/user-platform/src/contracts/account-commands";
import {
  applyPreferences,
  DEFAULT_PREFERENCES,
  DENSITIES,
  POSTER_SIZES,
  preferenceAttributes,
} from "../../apps/web/src/lib/presentation-preferences";

/** Comentário CSS. Guarda mede REGRA, nunca prosa. */
const COMENTARIO_CSS = /\/\*[\s\S]*?\*\//g;

const MIGRATION = readFileSync(
  path.join(
    process.cwd(),
    "packages/db/prisma/migrations/20260820140000_user_presentation_preferences/migration.sql",
  ),
  "utf8",
);

const DROP_TEMA = readFileSync(
  path.join(
    process.cwd(),
    "packages/db/prisma/migrations/20260821120000_drop_user_theme_preference/migration.sql",
  ),
  "utf8",
);

/** Um comando de perfil válido e completo. */
function comando(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: "Titular",
    handle: "titular",
    bio: null,
    locale: "pt-BR",
    countryCode: "BR",
    timezone: "America/Sao_Paulo",
    visibility: "private",
    density: "comfortable",
    posterSize: "medium",
    ...over,
  };
}

describe("o vocabulario e o MESMO nos tres lugares", () => {
  it("contrato e modulo de efeito declaram os mesmos valores", () => {
    expect([...PROFILE_DENSITIES]).toEqual([...DENSITIES]);
    expect([...PROFILE_POSTER_SIZES]).toEqual([...POSTER_SIZES]);
  });

  it("o CHECK da migration lista exatamente os mesmos valores", () => {
    // Sem isto, o parser aceitaria um valor que o banco recusa — e o usuario
    // veria 500 em vez de "dados invalidos".
    for (const [coluna, valores] of [
      ["density", PROFILE_DENSITIES],
      ["poster_size", PROFILE_POSTER_SIZES],
    ] as const) {
      const linha = new RegExp(`CHECK \\("${coluna}" IN \\(([^)]+)\\)\\)`).exec(MIGRATION);
      expect(linha, `CHECK de ${coluna} nao encontrado na migration`).not.toBeNull();
      const naMigration = (linha![1] as string)
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, ""));
      expect(naMigration.sort(), coluna).toEqual([...valores].sort());
    }
  });

  it("os DEFAULTS do modulo sao os mesmos da coluna", () => {
    // Divergencia aqui faria a tela abrir num estado que o banco nunca grava.
    expect(MIGRATION).toContain(`"density" TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.density}'`);
    expect(MIGRATION).toContain(
      `"poster_size" TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.posterSize}'`,
    );
  });
});

/**
 * A COLUNA DE TEMA FOI DERRUBADA NO BANCO.
 *
 * Tirar `theme` do TypeScript nao tira a coluna do PostgreSQL. Sem esta
 * migration, a coluna sobreviveria guardando escolha que nenhum seletor le —
 * exatamente a "preferencia fake" que a regra desta tela proibe, so que
 * invisivel porque nao ha mais controle mostrando ela.
 */
describe("a coluna de tema foi DERRUBADA no banco", () => {
  it("a migration derruba o CHECK e a coluna, NESSA ordem", () => {
    // Ordem importa: o CHECK referencia a coluna. Invertido, o DROP falha em
    // cluster que resolva a dependencia de forma estrita.
    const iCheck = DROP_TEMA.indexOf('DROP CONSTRAINT IF EXISTS "user_profiles_theme_check"');
    const iColuna = DROP_TEMA.indexOf('DROP COLUMN IF EXISTS "theme"');
    expect(iCheck, "DROP CONSTRAINT ausente").toBeGreaterThan(-1);
    expect(iColuna, "DROP COLUMN ausente").toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iColuna);
  });

  it("a migration e 100% ASCII — WIN1252 ja quebrou deploy aqui", () => {
    // `codePointAt` em vez de regex com escape hexadecimal: escrever a classe
    // classe de caracteres por escape hexadecimal, escrita por gerador, ja
    // gravou os bytes CRUS num arquivo deste repositorio, e ele virou
    // "binary" para o git.
    const foraDeAscii = [...DROP_TEMA].filter((ch) => (ch.codePointAt(0) ?? 0) > 127);
    expect(foraDeAscii, "byte fora de ASCII na migration").toEqual([]);
  });

  it("CONTROLE POSITIVO: a migration ANTERIOR continua criando o que FICOU", () => {
    // Se o caminho do arquivo acima mudar, os dois testes de cima passariam
    // medindo string vazia. Este ancora o par.
    expect(MIGRATION).toContain('ADD COLUMN "density"');
    expect(MIGRATION).toContain('ADD COLUMN "poster_size"');
  });
});

describe("o contrato ACEITA os valores validos e RECUSA o resto", () => {
  it("POSITIVO: todo valor do vocabulario passa", () => {
    for (const density of PROFILE_DENSITIES) {
      for (const posterSize of PROFILE_POSTER_SIZES) {
        const r = parseUpdateProfileCommand(comando({ density, posterSize }));
        expect(r.ok, `${density}/${posterSize}`).toBe(true);
      }
    }
  });

  it("NEGATIVO: valor fora do vocabulario e recusado na FRONTEIRA", () => {
    // Na fronteira, com a lista no erro — nunca virando 500 quando o CHECK
    // dispara, que e o mesmo defeito visto de mais longe.
    for (const [campo, ruim] of [
      ["density", "apertadissima"],
      ["posterSize", "gigante"],
    ] as const) {
      const r = parseUpdateProfileCommand(comando({ [campo]: ruim }));
      expect(r.ok, campo).toBe(false);
    }
  });

  it("NEGATIVO: campo AUSENTE e recusado — o perfil e substituido inteiro", () => {
    // Aceitar ausencia tornaria impossivel distinguir "voltar ao default" de
    // "nao mexer" — a mesma razao pela qual o resto do comando nao e parcial.
    for (const campo of ["density", "posterSize"]) {
      const corpo = comando();
      delete corpo[campo];
      expect(parseUpdateProfileCommand(corpo).ok, campo).toBe(false);
    }
  });
});

describe("o EFEITO: a preferencia vira atributo no <html>", () => {
  it("NEGATIVO: `data-theme` NUNCA e escrito — nao ha tema", () => {
    // O produto e claro sempre. Um `data-theme` no <html> seria atributo que
    // nenhum seletor le: preferencia fake pela definicao literal da regra da
    // tela 13. Se um dia houver tema, ele volta pelo CSS primeiro.
    const attrs = preferenceAttributes(DEFAULT_PREFERENCES);
    expect(attrs.map((a) => a.name)).not.toContain("data-theme");
  });

  it("densidade e tamanho de poster escrevem os proprios atributos", () => {
    const attrs = preferenceAttributes({
      density: "compact",
      posterSize: "large",
    });
    expect(attrs).toContainEqual({ name: "data-density", value: "compact" });
    expect(attrs).toContainEqual({ name: "data-poster-size", value: "large" });
  });

  it("FAIL-SAFE: valor corrompido cai no default, nao derruba a pagina", () => {
    // Pior caso aceitavel: o leitor ve a aparencia padrao. Lancar aqui deixaria
    // uma preferencia estragada quebrar a renderizacao inteira.
    const attrs = preferenceAttributes({ density: "?", posterSize: "?" });
    expect(attrs).toContainEqual({ name: "data-density", value: "comfortable" });
    expect(attrs).toContainEqual({ name: "data-poster-size", value: "medium" });
  });
});

describe("applyPreferences escreve e APAGA de verdade", () => {
  /** Elemento mínimo, sem jsdom: só o contrato de atributo que a função usa. */
  function fakeRoot(): Element & { readonly attrs: Map<string, string> } {
    const attrs = new Map<string, string>();
    return {
      attrs,
      setAttribute: (n: string, v: string) => {
        attrs.set(n, v);
      },
      removeAttribute: (n: string) => {
        attrs.delete(n);
      },
    } as unknown as Element & { readonly attrs: Map<string, string> };
  }

  it("aplica os dois atributos, e SO os dois", () => {
    const root = fakeRoot();
    applyPreferences(root, { density: "compact", posterSize: "small" });
    expect([...root.attrs.entries()].sort()).toEqual([
      ["data-density", "compact"],
      ["data-poster-size", "small"],
    ]);
  });
});

describe("o CSS existe para os atributos que a funcao escreve", () => {
  // SEM COMENTARIOS. O bloco "TEMA UNICO" no topo do globals.css EXPLICA por
  // que nao ha tema, e cita `data-theme` na prosa — uma varredura de texto cru
  // acusaria justamente a documentacao da decisao. Guarda mede REGRA.
  const CSS = readFileSync(path.join(process.cwd(), "apps/web/app/globals.css"), "utf8").replace(
    COMENTARIO_CSS,
    "",
  );

  it("cada valor de densidade/poster tem regra correspondente", () => {
    // Atributo sem regra e preferencia salva que nao faz nada — o meio-caminho
    // entre o controle real e o botao morto.
    expect(CSS).toContain("[data-density='compact']");
    expect(CSS).toContain("[data-poster-size='small']");
    expect(CSS).toContain("[data-poster-size='large']");
  });

  it("NEGATIVO: nao ha regra de tema — nenhum seletor le `data-theme`", () => {
    // O par do teste acima. Atributo sem regra e preferencia morta; REGRA sem
    // atributo e o tema escuro voltando pela porta dos fundos.
    expect(CSS).not.toContain("data-theme");
  });
});

/**
 * O ADAPTER REAL grava as colunas de apresentacao — e este bloco existe porque a ausencia
 * dele deixou um controle negativo passar.
 *
 * Reaplicado o defeito (tirar `density`/`posterSize` do `upsert` do
 * `profile-store.ts`), a suite inteira do `user-platform` continuou VERDE: os
 * testes de servico usam o duble em memoria, e o duble eu tinha atualizado. O
 * adapter Prisma — o unico que fala com o banco de verdade — nao era coberto
 * por nada.
 *
 * A medida e ESTRUTURAL sobre o fonte do adapter, e vale dizer o que ela NAO e:
 * ela nao prova que o Postgres aceitou a escrita (isso exige banco, e ha
 * validadores `*-real-postgres.ts` para essa classe de prova). Ela prova o elo
 * que faltava: que os campos estao no `create`, no `update` e no `select`. Sem
 * qualquer um dos tres o valor se perde em silencio — no primeiro caso para
 * contas novas, no segundo para as existentes, no terceiro na leitura de volta.
 */
describe("o adapter Prisma escreve E le as colunas de apresentacao", () => {
  const STORE = readFileSync(
    path.join(process.cwd(), "services/user-platform/src/persistence/prisma/profile-store.ts"),
    "utf8",
  );

  const CAMPOS = ["density", "posterSize"] as const;

  it("CONTROLE POSITIVO: o arquivo tem um upsert com create e update", () => {
    // Sem isto, um caminho de arquivo errado faria as contagens abaixo darem
    // zero e o bloco passaria por vacuidade.
    expect(STORE).toContain("userProfile.upsert(");
    expect(STORE).toMatch(/create:\s*\{/);
    expect(STORE).toMatch(/update:\s*\{/);
  });

  it("cada campo aparece DUAS vezes no upsert (create e update)", () => {
    for (const campo of CAMPOS) {
      const ocorrencias = STORE.split(`${campo}: input.${campo},`).length - 1;
      expect(ocorrencias, `${campo} em create+update`).toBe(2);
    }
  });

  it("o PROFILE_SELECT le todas — senao a tela nunca receberia de volta", () => {
    const select = /const PROFILE_SELECT = \{([\s\S]*?)\} as const;/.exec(STORE);
    expect(select, "PROFILE_SELECT nao encontrado").not.toBeNull();
    for (const campo of CAMPOS) {
      expect(select![1], campo).toContain(`${campo}: true`);
    }
  });

  it("a exportacao LGPD inclui as preferencias — sao dado pessoal", () => {
    // Copia incompleta dos proprios dados e um defeito de conformidade, nao um
    // detalhe de produto.
    const EXPORT = readFileSync(
      path.join(process.cwd(), "services/user-platform/src/persistence/prisma/export-read-store.ts"),
      "utf8",
    );
    for (const campo of CAMPOS) {
      expect(EXPORT, campo).toContain(`${campo}: true`);
    }
  });
});

/**
 * O PAINEL faz as DUAS metades: salva e aplica.
 *
 * Este bloco tambem nasceu de um controle negativo que passou. Tirando a
 * chamada de `applyPreferences` do caminho de salvamento, tudo continuou verde:
 * o valor ia ao banco e a tela nao mudava — que e a metade errada de "controle
 * que faz efeito de verdade", e indistinguivel, para quem usa, de nao ter
 * salvo.
 *
 * Sao DOIS pontos de chamada, e cada um cobre um buraco diferente:
 *   - no CARREGAMENTO: sem ele, o leitor abre a tela na aparencia padrao e ve a
 *     propria escolha "sumir";
 *   - no SALVAMENTO: sem ele, a escolha so aparece no proximo carregamento.
 */
describe("o painel salva E aplica — as duas metades", () => {
  const PANEL = readFileSync(
    path.join(process.cwd(), "apps/web/app/pt/conta/settings-panel.tsx"),
    "utf8",
  );

  it("as preferencias vao no corpo do POST", () => {
    for (const campo of ["density", "posterSize"] as const) {
      expect(PANEL, campo).toContain(`${campo}: next.${campo},`);
    }
  });

  it("`applyPreferences` e chamado no carregamento E no salvamento", () => {
    const chamadas = PANEL.split("applyPreferences(document.documentElement").length - 1;
    expect(chamadas, "esperado 2: uma no load, uma no save").toBe(2);
  });

  it("NEGATIVO: o efeito so e aplicado DEPOIS do `response.ok`", () => {
    // Aplicar otimista mostraria a mudanca e a deixaria la mesmo quando o
    // servidor recusasse — o leitor acreditaria ter salvo o que nao salvou.
    const depoisDoOk = PANEL.slice(PANEL.indexOf("if (response.ok) {"));
    expect(depoisDoOk).toContain("applyPreferences(document.documentElement, next)");
    const antesDoOk = PANEL.slice(
      PANEL.indexOf("async function salvarPerfil"),
      PANEL.indexOf("if (response.ok) {"),
    );
    expect(antesDoOk, "nada de aplicar antes da resposta").not.toContain("applyPreferences(");
  });

  it("a lista de secoes OMITIDAS encolheu, e as que sobraram continuam la", () => {
    // A regra nao mudou ("nunca toggle sem efeito"); a lista e que encolheu.
    // Se alguem trouxer notificacoes para a tela sem backend, o cabecalho para
    // de bater com a realidade — e este teste e onde isso aparece.
    // A frase quebra em duas linhas de comentario; a asserçao mede as duas
    // metades separadamente em vez de depender da largura da coluna.
    expect(PANEL).toContain("assinatura, notificações,");
    expect(PANEL).toContain("comportamento, gêneros e bloqueados");
  });
});
