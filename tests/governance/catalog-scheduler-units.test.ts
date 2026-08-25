/**
 * Governanca ESTRUTURAL das units systemd do ciclo de catalogo.
 *
 * Nao ha systemd nesta maquina (Windows) e a CI nao instala units. Estes testes
 * travam as propriedades que, se caissem, so apareceriam em producao: rodar o
 * runner ERRADO, rodar como root, ou permitir dois ciclos concorrentes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8");

const service = read("services/ingestion/systemd/cinerie-catalog-cycle.service");

/**
 * Apenas as DIRETIVAS da unit, sem comentarios.
 *
 * O cabecalho do arquivo cita o runner legado de proposito (para explicar o que
 * esta unit substitui e como fazer rollback). Assertar sobre o arquivo inteiro
 * confundiria essa mencao em prosa com a unit realmente executando o runner
 * errado — a diferenca entre documentar e agendar.
 */
const serviceDirectives = service
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const timer = read("services/ingestion/systemd/cinerie-catalog-cycle.timer");
const wrapper = read("scripts/catalog/catalog-cycle-with-alert.sh");

/**
 * Apenas os COMANDOS do wrapper, sem comentarios — mesma razao de
 * `serviceDirectives` acima.
 *
 * O cabecalho da secao de indexabilidade cita a forma manual
 * (`index-decisions` com aplicacao forcada) para dizer como aplicar
 * deliberadamente. Assertar sobre o arquivo inteiro confundiria essa mencao em
 * prosa com o ciclo realmente aplicando sozinho — de novo, a diferenca entre
 * documentar e agendar.
 */
const wrapperCommands = wrapper
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const legacyService = read("services/sync/systemd/screena-tmdb-catalog.service");

describe("cinerie-catalog-cycle.service", () => {
  it("(1) executa o ciclo da FILA, nao o runner legado de stale-refresh", () => {
    expect(serviceDirectives).toContain("scripts/catalog/catalog-cycle-with-alert.sh");
    // O runner legado e `@screena/sync bin/run.ts`. Se ele aparecer numa
    // DIRETIVA, a unit nova estaria agendando exatamente o que veio substituir.
    expect(serviceDirectives).not.toContain("@screena/sync");
    expect(serviceDirectives).not.toMatch(/bin\/run\.ts/);
  });

  it("(2) NAO roda como root", () => {
    expect(service).toMatch(/^User=(?!root)\S+/m);
    expect(service).toContain("NoNewPrivileges=true");
  });

  it("(3) credenciais vem de EnvironmentFile, nunca inline na unit", () => {
    expect(service).toContain("EnvironmentFile=");
    // Um segredo literal numa unit vaza para `systemctl cat` e para o journal.
    expect(service).not.toMatch(/Environment=.*(TOKEN|KEY|PASSWORD|SECRET)=/i);
  });

  it("(4) tem teto de execucao (fila patologica nao segura a unit para sempre)", () => {
    expect(service).toMatch(/TimeoutStartSec=\d+/);
  });

  it("(5) nao reinicia sozinho — falha por FK/credencial repetiria igual", () => {
    expect(service).toContain("Restart=no");
  });

  it("(6) endurecimento de filesystem ativo", () => {
    for (const directive of ["ProtectSystem=strict", "ProtectHome=true", "PrivateTmp=true"]) {
      expect(service).toContain(directive);
    }
  });
});

describe("cinerie-catalog-cycle.timer", () => {
  it("(7) recupera execucoes perdidas apos downtime", () => {
    expect(timer).toContain("Persistent=true");
  });

  it("(8) tem agenda declarada e jitter (nao bate junto com backup)", () => {
    expect(timer).toMatch(/OnCalendar=\S+/);
    expect(timer).toMatch(/RandomizedDelaySec=\d+/);
  });

  it("(9) a frequencia esta JUSTIFICADA no proprio arquivo", () => {
    // Frequencia sem justificativa e numero inventado; o proximo operador nao
    // saberia se pode mudar.
    expect(timer.toLowerCase()).toContain("justificativa");
  });
});

describe("catalog-cycle-with-alert.sh", () => {
  it("(10) impede dois ciclos concorrentes (flock nao-bloqueante)", () => {
    expect(wrapper).toContain("flock -n");
  });

  it("(11) reusa a infra de alerta do Prompt 02 — nao cria outro cliente", () => {
    expect(wrapper).toContain("scripts/backup/lib/alert.mjs");
    // Um segundo cliente de webhook divergiria em timeout e redacao de segredo.
    expect(wrapper).not.toMatch(/fetch\(\s*["'`]https/);
  });

  it("(12) o alerta NUNCA mascara o exit code do trabalho", () => {
    // Quem decide a saida do script e o resultado do CICLO, nunca o do alerta.
    expect(wrapper).toMatch(/exit \$\?|return "\$code"/);
  });

  it("(12b) falha do proprio alerta e REPORTADA, nunca engolida", () => {
    // Ate 2026-08 este teste exigia a string "(ignorada)" — ou seja, ele
    // TRAVAVA o defeito: o wrapper engolia a falha do alerta e seguia. Um canal
    // de notificacao fora do ar ficava invisivel e o operador seguia achando
    // que estava coberto. A propriedade correta e a oposta: nao mascarar o exit
    // code do trabalho E, ainda assim, deixar rastro quando o alerta nao sai.
    expect(wrapper).not.toContain("(ignorada)");
    expect(wrapper).toContain("ALERTA NAO ENTREGUE");
    // O `catch` do subprocesso Node existe para transformar o throw de
    // `dispatchAlert` em diagnostico legivel no journal da unit.
    expect(wrapper).toMatch(/catch\s*\(err\)/);
  });

  it("(13) roda o sentinela de saude entre os dois snapshots", () => {
    expect(wrapper).toContain("queue-health.mjs");
    expect(wrapper).toContain("evaluateCycleHealth");
  });

  it("(14) o ciclo inclui busca e indexabilidade, nao so o worker", () => {
    expect(wrapperCommands).toContain("search-reindex");
    expect(wrapperCommands).toContain("index-decisions");
  });

  it("(14b) o ciclo aplica a DERIVA, e nunca assina a mudanca em massa", () => {
    // ESTE TESTE JA FOI O CONTRARIO, e o porque importa mais que o veredito.
    //
    // Indexacao em massa exige revisao humana (CLAUDE.md secao 6). Com a
    // politica v2, a primeira aplicacao tira ~51 mil URLs do sitemap: 22.385
    // pessoas (nenhuma tem biografia), ~28 mil episodios (1.257 de 30.803 tem
    // sinopse) e ~40 series. Um timer horario decidindo isso sozinho e a
    // decisao mais cara do sistema tomada por um cron. Pior: o ciclo nunca
    // rodou (626 jobs `pending`, zero `succeeded`), e quem o liga e a criacao
    // do catalog worker — entao subir o worker dispararia a desindexacao como
    // EFEITO COLATERAL de uma tarefa de ingestao.
    //
    // Na ausencia de trava, a mitigacao foi rebaixar a linha para `--dry-run`,
    // e este teste travava "nenhuma linha com --apply". O comentario de la
    // dizia o que faltava: "aplicacao automatica precisa de uma trava PROPRIA
    // de mudanca em massa". Essa trava existe agora (`catalog-mass-change.ts`
    // + exit 5 tratado no wrapper), entao `--apply` volta — e a propriedade
    // de seguranca MUDA DE LUGAR, em vez de sumir:
    //
    //   antes: o ciclo nao pode APLICAR nada.
    //   agora: o ciclo pode aplicar a DERIVA; o que ele nao pode e ASSINAR
    //          pelo humano, e o freio e quem separa uma coisa da outra.
    //
    // Decisao do dono, 2026-08-25, ciente de que isto inverte a #219.
    const linhasIndexDecisions = wrapperCommands
      .split("\n")
      .filter((l) => l.includes("index-decisions"));
    expect(linhasIndexDecisions.length).toBeGreaterThan(0);

    // (a) o ciclo APLICA — senao entidade nova nunca ganha decisao registrada.
    expect(wrapperCommands).toContain("index-decisions --apply");

    // (b) a propriedade de seguranca: NENHUMA linha que invoque a CLI pode
    // carregar `--confirm-mass-change`. Linha a linha porque e a invocacao que
    // importa. A mensagem do alerta cita a flag de proposito (ensina o operador
    // a destravar), entao filtramos so as linhas de invocacao.
    const invocacoes = linhasIndexDecisions.filter((l) => /catalog_(read|write)\b/.test(l));
    expect(invocacoes.length).toBeGreaterThan(0);
    for (const linha of invocacoes) {
      expect(
        linha,
        `o ciclo assinaria a mudanca em massa sozinho: ${linha.trim()}`,
      ).not.toContain("--confirm-mass-change");
    }

    // (c) e o wrapper TRATA o exit do freio — sem isso o freio dispararia e o
    // ciclo registraria "index-decisions falhou", escondendo a recusa atras de
    // uma falha generica.
    expect(wrapperCommands).toContain("INDEX_DECISIONS_BRAKE_EXIT");
  });
});

describe("runner legado", () => {
  it("(15) continua existindo e apontando para o runner antigo (rollback possivel)", () => {
    // A unit nova NAO remove a legada. Este teste documenta que o rollback
    // existe: se ele falhar, alguem apagou o caminho de volta.
    expect(legacyService).toContain("@screena/sync");
  });
});
