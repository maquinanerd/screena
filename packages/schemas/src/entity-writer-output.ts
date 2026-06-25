/**
 * entity-writer-output.ts — Validacao da saida do Entity Writer.
 *
 * Este modulo e PURO: nao faz rede, DB nem IO. Garante duas coisas antes
 * que um content_block gerado por IA possa ser salvo/revisado:
 *
 *  1. Forma e tipos corretos da saida (validateEntityWriterOutput).
 *  2. Anti-alucinacao basica contra payload controlado do PostgreSQL
 *     (validateAgainstPayload): o Entity Writer so pode escrever fatos
 *     que existem no payload — invariante 12 ("nao inventa fatos").
 *
 * A checagem anti-alucinacao e deliberadamente simples e baseada apenas em
 * comparacao de strings: extrai nomes proprios (sequencias capitalizadas)
 * citados em cast_intro/editorial_intro e exige que cada um exista no
 * payload (director ou cast). Qualquer nome citado fora do payload vira
 * warning. Nao substitui revisao humana; e um gate barato de primeira linha.
 */

/**
 * Item de FAQ gerado pelo Entity Writer.
 */
export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

/**
 * Saida estruturada do Entity Writer. Todos os blocos textuais sao
 * opcionais (o writer pode gerar so um subconjunto); apenas warnings e
 * obrigatorio e sempre um array (mesmo que vazio).
 */
export interface EntityWriterOutput {
  readonly editorial_intro?: string;
  readonly summary_without_spoilers?: string;
  readonly ratings_explanation?: string;
  readonly where_to_watch_text?: string;
  readonly cast_intro?: string;
  readonly similar_titles_intro?: string;
  readonly faq?: FaqItem[];
  readonly warnings: string[];
}

/**
 * Payload controlado (subconjunto vindo do PostgreSQL) usado como unica
 * fonte de fatos permitida para o Entity Writer.
 */
export interface EntityPayload {
  readonly director: string;
  readonly cast: string[];
}

/**
 * Resultado de uma validacao de forma/tipos da saida do Entity Writer.
 *
 * Nome distinto de ratings.ValidationResult para evitar colisao no barrel
 * "@screena/schemas" (ambos os modulos sao reexportados via export *).
 */
export interface EntityWriterValidationResult {
  readonly ok: boolean;
  readonly errors: string[];
}

/**
 * Resultado de uma checagem anti-alucinacao.
 */
export interface WarningsResult {
  readonly warnings: string[];
}

/**
 * Campos textuais opcionais que, quando presentes, devem ser string.
 */
const OPTIONAL_STRING_FIELDS = [
  "editorial_intro",
  "summary_without_spoilers",
  "ratings_explanation",
  "where_to_watch_text",
  "cast_intro",
  "similar_titles_intro",
] as const;

/**
 * Type guard frouxo para inspecionar um valor desconhecido como objeto.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Valida a forma e os tipos de uma saida do Entity Writer.
 *
 * Checa que:
 *  - a saida e um objeto;
 *  - warnings existe e e um array de strings;
 *  - cada campo textual opcional, se presente, e string;
 *  - faq, se presente, e um array de { question: string, answer: string }.
 *
 * Funcao pura. Retorna todos os erros encontrados.
 */
export function validateEntityWriterOutput(output: unknown): EntityWriterValidationResult {
  const errors: string[] = [];

  if (!isRecord(output)) {
    return { ok: false, errors: ["saida invalida: esperado um objeto."] };
  }

  // warnings: obrigatorio e deve ser array de strings
  const warnings = output["warnings"];
  if (!Array.isArray(warnings)) {
    errors.push("warnings ausente ou invalido: deve ser um array.");
  } else if (!warnings.every((w) => typeof w === "string")) {
    errors.push("warnings invalido: todos os itens devem ser string.");
  }

  // campos textuais opcionais: se presentes, devem ser string
  for (const field of OPTIONAL_STRING_FIELDS) {
    const value = output[field];
    if (value !== undefined && typeof value !== "string") {
      errors.push(`${field} invalido: quando presente deve ser string.`);
    }
  }

  // faq opcional: array de { question, answer } strings
  const faq = output["faq"];
  if (faq !== undefined) {
    if (!Array.isArray(faq)) {
      errors.push("faq invalido: quando presente deve ser um array.");
    } else {
      faq.forEach((item, index) => {
        if (!isRecord(item)) {
          errors.push(`faq[${index}] invalido: esperado um objeto.`);
          return;
        }
        if (typeof item["question"] !== "string") {
          errors.push(`faq[${index}].question invalido: deve ser string.`);
        }
        if (typeof item["answer"] !== "string") {
          errors.push(`faq[${index}].answer invalido: deve ser string.`);
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Conectivos minusculos que podem aparecer DENTRO de um nome proprio
 * (ex.: "Robert De Niro", "Lars von Trier", "Joana da Silva"). O "e"/"and"
 * NAO entra: ele liga pessoas distintas ("X e Y"), nunca une um unico nome —
 * incluir "e" faria "Rebecca Ferguson e Zendaya" virar um so candidato e
 * mascarar a alucinacao.
 */
const NAME_CONNECTIVES = "de|da|do|dos|das|del|della|di|du|von|van|la|le";

/**
 * Palavras-funcao que, mesmo capitalizadas, nunca sao nome proprio. Rede de
 * seguranca para candidatos de uma palavra que escapem da regra de posicao.
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "o", "a", "os", "as", "um", "uma", "no", "na", "nos", "nas", "ao", "aos",
  "de", "do", "da", "em", "e", "ou", "mas", "que", "se", "por", "para", "com",
  "sem", "the", "an", "in", "on", "at", "of", "and", "or",
]);

/**
 * Regex de nome proprio: uma palavra capitalizada seguida de zero ou mais
 * grupos que SEMPRE terminam em outra palavra capitalizada — opcionalmente
 * via um conectivo minusculo de nome. Assim "Robert De Niro" vira um unico
 * nome, mas "Rebecca Ferguson e Zendaya" se quebra no "e".
 */
const NAME_REGEX = new RegExp(
  `[A-ZÀ-Þ][a-zà-ÿ'’-]+(?:\\s+(?:${NAME_CONNECTIVES})\\s+[A-ZÀ-Þ][a-zà-ÿ'’-]+|\\s+[A-ZÀ-Þ][a-zà-ÿ'’-]+)*`,
  "g",
);

/**
 * True quando a posicao `index` em `text` esta no inicio de uma frase (inicio
 * do texto ou logo apos pontuacao final). Candidatos de UMA palavra nessa
 * posicao sao ambiguos (maiuscula por inicio de frase, nao por nome proprio)
 * e por isso descartados — e o que distingue "Zendaya" (no meio da frase) de
 * "No"/"Dirigido" (inicio de frase).
 */
function isSentenceInitial(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && (text.charAt(i) === " " || text.charAt(i) === "\t")) {
    i -= 1;
  }
  if (i < 0) {
    return true;
  }
  return ".!?:;\n\r…".includes(text.charAt(i));
}

/**
 * Extrai candidatos a nome proprio de um texto.
 *
 * Regras:
 *  - sequencias capitalizadas (com conectivos internos de nome) sempre contam;
 *  - um candidato de UMA palavra so conta se aparecer no MEIO da frase;
 *  - palavras-funcao capitalizadas sao descartadas.
 *
 * Heuristica barata de primeira linha; nao substitui revisao humana.
 */
function extractProperNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(NAME_REGEX)) {
    const candidate = match[0].trim();
    const index = match.index ?? 0;
    const isMultiWord = candidate.includes(" ");

    if (!isMultiWord) {
      if (isSentenceInitial(text, index)) {
        continue;
      }
      if (FUNCTION_WORDS.has(candidate.toLowerCase())) {
        continue;
      }
    }
    names.push(candidate);
  }
  return names;
}

/**
 * Normaliza um nome para comparacao: minusculo, sem acentos, espacos
 * colapsados. Mantem a comparacao tolerante a variacoes de caixa/acento.
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detecta alucinacao simples comparando nomes proprios citados em
 * cast_intro e editorial_intro contra os nomes permitidos no payload
 * (director + cast).
 *
 * Para cada nome citado que NAO corresponda (por substring normalizada) a
 * nenhum nome do payload, emite o warning:
 *   "fato fora do payload: <nome>"
 *
 * Funcao pura, baseada apenas em comparacao de strings. Nao deduplica
 * agressivamente alem de evitar o mesmo nome citado repetido.
 */
export function validateAgainstPayload(
  payload: EntityPayload,
  output: EntityWriterOutput,
): WarningsResult {
  const allowedNames = [payload.director, ...payload.cast]
    .map(normalizeName)
    .filter((n) => n.length > 0);

  const citedTexts = [output.cast_intro, output.editorial_intro].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );

  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const text of citedTexts) {
    for (const cited of extractProperNames(text)) {
      const normalizedCited = normalizeName(cited);
      if (seen.has(normalizedCited)) {
        continue;
      }
      seen.add(normalizedCited);

      const existsInPayload = allowedNames.some(
        (allowed) => allowed.includes(normalizedCited) || normalizedCited.includes(allowed),
      );
      if (!existsInPayload) {
        warnings.push(`fato fora do payload: ${cited}`);
      }
    }
  }

  return { warnings };
}
