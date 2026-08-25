/**
 * args.ts — Parser PURO dos argumentos do calculo do Cinerie Score. Sem IO.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------------------------------------------------------
 * O parser vivia dentro de `bin/compute-cinerie-score.ts`, que chama `main()`
 * no topo do modulo — importar o arquivo para testar o parser conectaria o
 * Prisma e rodaria o CLI. Por isso ele nunca teve teste, e por isso o defeito
 * abaixo sobreviveu.
 *
 * Os dois CLIs irmaos ja tinham o parser separado e testado:
 * `src/omdb/args.ts` e `src/awards/args.ts`. Este arquivo fecha a assimetria.
 *
 * O DEFEITO QUE ISTO FECHA (medido em producao, 2026-08-25 03:35 UTC)
 * ---------------------------------------------------------------------------
 * O parser antigo so aceitava `--flag=valor`. O agendador
 * (`services/sync/src/scheduler/runtime/runners.ts`), escrito contra a
 * convencao dos irmaos, chamava com `['--type', 'all']` — dois tokens. O parser
 * respondia `argumento desconhecido: "--type"` e o processo saia com codigo 1.
 *
 * Resultado: a fila `cinerie_score` reportava **FALHOU todo tique, desde que
 * nasceu**. `cinerie_score_calculations` = 0 no banco, e a auditoria concluiu
 * que "o motor nunca rodou". Ele rodava — morria no parse de argumento.
 *
 * Ninguem viu por dias porque o agendador descartava o `stderr` do filho. O
 * motivo so apareceu no primeiro tique depois da PR #218:
 *
 *   causa: compute-cinerie-score saiu com codigo 1:
 *          Argumentos invalidos: argumento desconhecido: "--type"
 *
 * FAIL-LOUD, sempre: valor faltante, flag desconhecida ou valor invalido geram
 * erro explicito. Nunca fallback silencioso — sob `--apply` isso seria critico.
 */

/** Escopo do calculo. */
export type ScoreArgsType = 'movie' | 'tv' | 'all';

/** Argumentos parseados. */
export interface ScoreArgs {
  /** `true` so quando `--apply` foi passado explicitamente. */
  readonly apply: boolean;
  /** Escopo; default `all` quando nao informado. */
  readonly type: ScoreArgsType;
  /** Teto de entidades; `null` = sem teto (o CLI aplica o default dele). */
  readonly limit: number | null;
}

/** Resultado do parse: sucesso com args, ou falha com mensagem clara. */
export type ScoreArgsResult =
  | { readonly ok: true; readonly args: ScoreArgs }
  | { readonly ok: false; readonly error: string };

/** Flags que aceitam valor (nas duas formas: `--flag=v` e `--flag v`). */
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--type', '--limit']);

function isScoreType(value: string | undefined): value is ScoreArgsType {
  return value === 'movie' || value === 'tv' || value === 'all';
}

/**
 * Parseia `argv` (sem o `node` e sem o caminho do script).
 *
 * Aceita `--flag=valor` E `--flag valor`, como os dois CLIs irmaos. Uma
 * divergencia de convencao entre irmaos e uma armadilha para o proximo
 * chamador — foi exatamente o que aconteceu com o agendador.
 */
export function parseScoreArgs(argv: readonly string[]): ScoreArgsResult {
  let apply = false;
  let type: ScoreArgsType = 'all';
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (token === '--apply') {
      apply = true;
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    let value: string | undefined = eq === -1 ? undefined : token.slice(eq + 1);

    // Forma separada: consome o proximo token como valor. Recusa quando o
    // proximo e outra flag ou nao existe — `--type --apply` seria um valor
    // engolido em silencio, e silencio aqui e o defeito que este arquivo fecha.
    if (value === undefined && VALUE_FLAGS.has(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { ok: false, error: `${name} exige um valor (use ${name}=VALOR ou ${name} VALOR)` };
      }
      value = next;
      i += 1;
    }

    if (name === '--type') {
      if (!isScoreType(value)) {
        return { ok: false, error: `--type invalido: "${String(value)}" (use movie | tv | all)` };
      }
      type = value;
      continue;
    }

    if (name === '--limit') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: `--limit invalido: "${String(value)}" (inteiro positivo)` };
      }
      limit = parsed;
      continue;
    }

    return { ok: false, error: `argumento desconhecido: "${token}"` };
  }

  return { ok: true, args: { apply, type, limit } };
}
