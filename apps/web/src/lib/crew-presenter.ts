/**
 * crew-presenter.ts — A EQUIPE TÉCNICA de um episódio, agrupada por função.
 * PURO: sem rede, sem Prisma, sem `Date` próprio.
 *
 * ============================================================================
 * POR QUE ISTO NÃO EXISTIA
 * ============================================================================
 * `crew_members` aceita `entity_type='episode'` desde a Fase 1, e o
 * normalizador de episódio sabe ler equipe desde a Fase 2. O que faltava era
 * a coleta: até 2026-08-27 `syncEpisodes` lia o item de `episodes[]` da
 * temporada e procurava a equipe em `credits.crew` — bloco que aquele objeto
 * nunca teve. O TMDB mandava `crew` no TOPO, com direção e roteiro dentro, e
 * ele era descartado na leitura.
 *
 * Resultado: a página de episódio da Cinerie tinha título, data, duração e um
 * parágrafo, enquanto a mesma página no TMDB tinha 13 pessoas na equipe.
 *
 * ============================================================================
 * AGRUPADO POR FUNÇÃO, NÃO POR PESSOA
 * ============================================================================
 * "Direção: Declan Lowney" é a forma que o leitor procura, e é a forma que o
 * TMDB usa. Uma pessoa que acumula funções aparece em DUAS linhas — é o que
 * `dedupeCrew` já preserva no normalizador, e colapsar aqui desfaria aquele
 * cuidado.
 *
 * O RÓTULO de uma função desconhecida é o próprio nome cru do TMDB, nunca
 * "Outro": inventar um rótulo esconderia uma função nova do fornecedor, e sumir
 * com a linha esconderia gente que trabalhou no episódio. Mesma política dos
 * tipos de vídeo em `gallery-presenter.ts`.
 */

import { detailPath, PEOPLE_INDEX_PATH } from "./site";

/** Uma linha de `crew_members` (+ `people`), no subconjunto que a ficha usa. */
export interface CrewMemberInput {
  /** `people.name`. Sem nome válido a entrada cai fora — nunca vira "?". */
  readonly name: string;
  /** `crew_members.department` (ex.: `Directing`) ou null. */
  readonly department: string | null;
  /** `crew_members.job` (ex.: `Director`) ou null. */
  readonly job: string | null;
  /** Slug canônico pt-BR da pessoa, quando ela tem página pública. */
  readonly slug: string | null;
}

/** Uma pessoa dentro de um grupo de função. */
export interface CrewPersonView {
  readonly name: string;
  /** `/pt/pessoas/{slug}/` quando há slug; null vira texto sem link. */
  readonly href: string | null;
}

/** Um grupo de função, com todas as pessoas que a exercem no episódio. */
export interface CrewGroupView {
  /** O `job` cru, preservado para depuração e para o `data-` da tela. */
  readonly job: string;
  /** `Direção`, `Roteiro`… ou o próprio `job` quando não há tradução. */
  readonly label: string;
  readonly people: readonly CrewPersonView[];
}

/**
 * Rótulos em pt-BR das funções que a página de episódio nomeia.
 *
 * Deliberadamente CURTO. Traduzir as ~400 funções do TMDB seria um dicionário
 * que envelhece sozinho; as que importam numa ficha de episódio são poucas, e
 * o resto aparece com o nome original — que é informação verdadeira, só não
 * traduzida.
 */
const JOB_LABELS: Readonly<Record<string, string>> = {
  Director: "Direção",
  Writer: "Roteiro",
  Screenplay: "Roteiro",
  Story: "Argumento",
  "Executive Producer": "Produção executiva",
  Producer: "Produção",
  "Director of Photography": "Direção de fotografia",
  Editor: "Montagem",
  "Original Music Composer": "Trilha sonora",
  "Series Composition": "Composição da série",
  Teleplay: "Teleplay",
  "Co-Executive Producer": "Coprodução executiva",
};

/**
 * Ordem de exibição das funções.
 *
 * Direção e roteiro primeiro porque são a autoria do episódio — é o que muda
 * de um episódio para o outro e o que o leitor veio conferir. O resto segue em
 * ordem alfabética do rótulo, que é estável e não exige manter uma lista
 * completa.
 */
const JOB_ORDER: readonly string[] = [
  "Director",
  "Writer",
  "Screenplay",
  "Teleplay",
  "Story",
];

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Rótulo pt-BR da função, ou o próprio nome cru quando não há tradução. */
export function crewJobLabel(job: string): string {
  return JOB_LABELS[job] ?? job;
}

/**
 * Agrupa a equipe por função, na ordem de {@link JOB_ORDER}.
 *
 * Entradas sem nome ou sem `job` são DESCARTADAS: uma linha "função
 * desconhecida" não informa nada e ocuparia o lugar de quem tem crédito real.
 * Dentro de um grupo a ordem de entrada é preservada (o TMDB já entrega a
 * equipe numa ordem editorial), e a mesma pessoa não repete no MESMO grupo.
 *
 * `limit` corta GRUPOS, não pessoas: cortar pessoas dentro de "Direção"
 * esconderia um dos dois diretores de um episódio sem dizer que escondeu.
 */
export function buildCrewGroups(
  inputs: readonly CrewMemberInput[],
  limit: number,
): readonly CrewGroupView[] {
  const porFuncao = new Map<string, CrewPersonView[]>();
  const vistos = new Map<string, Set<string>>();

  for (const input of inputs) {
    const name = trimToNull(input.name);
    const job = trimToNull(input.job);
    if (name === null || job === null) continue;

    const slug = trimToNull(input.slug);
    const pessoas = porFuncao.get(job) ?? [];
    const nomesVistos = vistos.get(job) ?? new Set<string>();
    // Mesma pessoa, mesma função, duas linhas (credit_id diferente) não vira
    // nome repetido na tela.
    if (nomesVistos.has(name)) continue;
    nomesVistos.add(name);
    pessoas.push({ name, href: slug === null ? null : detailPath(PEOPLE_INDEX_PATH, slug) });
    porFuncao.set(job, pessoas);
    vistos.set(job, nomesVistos);
  }

  const grupos: CrewGroupView[] = [...porFuncao.entries()].map(([job, people]) => ({
    job,
    label: crewJobLabel(job),
    people,
  }));

  grupos.sort((a, b) => {
    const ordemA = JOB_ORDER.indexOf(a.job);
    const ordemB = JOB_ORDER.indexOf(b.job);
    // Fora da lista de prioridade vai depois de TODA a lista, não antes.
    const rankA = ordemA === -1 ? JOB_ORDER.length : ordemA;
    const rankB = ordemB === -1 ? JOB_ORDER.length : ordemB;
    if (rankA !== rankB) return rankA - rankB;
    // Desempate por rótulo e depois por `job`: ordem TOTAL, sem resultado que
    // muda entre dois renders da mesma entrada.
    const porRotulo = a.label.localeCompare(b.label, "pt-BR");
    return porRotulo !== 0 ? porRotulo : a.job.localeCompare(b.job);
  });

  const teto = Number.isInteger(limit) && limit > 0 ? limit : grupos.length;
  return grupos.slice(0, teto);
}

/** Quantas PESSOAS há na equipe, somando os grupos. É a contagem que a tela mostra. */
export function countCrewPeople(groups: readonly CrewGroupView[]): number {
  return groups.reduce((total, group) => total + group.people.length, 0);
}
