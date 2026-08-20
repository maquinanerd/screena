/**
 * known-for-department.ts — A traducao pt-BR de `known_for_department` do TMDB,
 * em UM lugar so.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Ate 20/08/2026 esta tabela existia DUAS vezes:
 * em `person-presenter.ts` (detalhe de pessoa, criado na PR #13) e em
 * `entity-index-presenter.ts` (indice `/pt/pessoas/`, criado na PR #14). As duas
 * PRs nasceram separadas, dias uma da outra, cada uma precisando do mesmo mapa;
 * nenhuma importou a outra. Quando a PR #186 acentuou os rotulos, acentuou UMA
 * copia — e producao passou a mostrar "Atuação" no detalhe e "Atuacao" no
 * indice, para a mesma pessoa.
 *
 * A copia nao era o defeito: era o VEICULO. O defeito e que nada obrigava as
 * duas a concordarem. Por isso a tabela saiu dos dois presenters e virou modulo
 * proprio — nenhuma tela "possui" um vocabulario compartilhado — e por isso
 * existe `tests/governance/known-for-department-single-source.test.ts`, que
 * reprova a terceira copia no dia em que ela for escrita.
 *
 * Estes valores vao para a TELA e para o `jobTitle` do JSON-LD. Sao texto de
 * interface, nao identificador tecnico: a regra de ASCII deste repositorio vale
 * para migration/SQL, e aqui o acento e obrigatorio.
 */

/**
 * Departamentos conhecidos do TMDB (`known_for_department`) em pt-BR.
 *
 * A lista e FECHADA de proposito: valor fora dela vira `null`, nunca ingles cru
 * na tela nem funcao inventada para preencher o slot.
 */
export const KNOWN_FOR_DEPARTMENT_LABELS: Readonly<Record<string, string>> = {
  Acting: "Atuação",
  Directing: "Direção",
  Writing: "Roteiro",
  Production: "Produção",
  Editing: "Edição",
  Camera: "Fotografia",
  Sound: "Som",
  Art: "Arte",
  "Costume & Make-Up": "Figurino e Maquiagem",
  "Visual Effects": "Efeitos Visuais",
  Lighting: "Iluminação",
  Crew: "Equipe",
};

/**
 * Traduz `known_for_department` para pt-BR. Valor ausente, vazio ou desconhecido
 * -> `null` (nao vaza ingles cru nem inventa funcao).
 */
export function mapKnownForDepartment(
  department: string | null | undefined,
): string | null {
  if (department == null) return null;
  const value = department.trim();
  if (value === "") return null;
  return KNOWN_FOR_DEPARTMENT_LABELS[value] ?? null;
}
