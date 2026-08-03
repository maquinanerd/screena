/**
 * legal.ts — estado e vocabulario dos documentos juridicos publicos. PURO.
 *
 * POR QUE UM MODULO SO PARA ISTO.
 *
 * `/pt/termos` e `/pt/privacidade` davam 404 enquanto `/pt/criar-conta` — que
 * esta no ar — exige aceite obrigatorio e linka para os dois. Quem se cadastrou
 * aceitou documentos que nao existiam. Resolver isso e mais do que criar duas
 * paginas: e deixar explicito, num lugar so, que o texto ainda NAO passou por
 * revisao juridica e que ninguem deve trata-lo como se tivesse.
 *
 * O texto foi redigido a partir do que o CODIGO REALMENTE FAZ — as bases legais
 * de `CONSENT_LEGAL_BASIS`, as categorias de `DATA_CLASSIFICATION` e os prazos
 * de `PRIVACY_DURATIONS`, todos no modulo de privacidade da plataforma de
 * usuario. Nao e um modelo generico copiado: cada afirmacao sobre exportar,
 * excluir, anonimizar ou reter corresponde a uma linha daquelas tabelas, e
 * `tests/governance/legal-documents.test.ts` trava a correspondencia para que o
 * documento nao envelheca sozinho quando o codigo mudar.
 *
 * ESTE MODULO NAO IMPORTA A PLATAFORMA DE USUARIO, e nao pode. Ele e alcancavel
 * pelo render publico, e a plataforma de usuario e proibida ali (a guarda esta
 * em `tests/governance/user-platform-privacy.test.ts`). O espelhamento e feito a
 * mao aqui e CONFERIDO pelo teste, que roda fora do render — e por isso pode
 * importar os dois lados e compara-los.
 */

/**
 * O texto ja foi revisado por um profissional do direito?
 *
 * **Este booleano e a unica chave.** Enquanto for `false`:
 *  - as duas paginas exibem o aviso de minuta no topo;
 *  - as duas resolvem `noindex` (ver `legalDocumentShouldIndex`).
 *
 * Documento juridico nao revisado indexado e pior que ausente: o buscador passa
 * a servi-lo como se fosse a politica vigente da Cinerie, e a correcao depois
 * nao alcanca quem ja leu. A pagina existe para o link do cadastro funcionar e
 * para o leitor ter o que ler — nao para ranquear.
 *
 * Virar `true` e DECISAO HUMANA, tomada depois da revisao, junto com a troca dos
 * marcadores de `LEGAL_PLACEHOLDERS` por valores reais.
 */
export const LEGAL_DOCUMENTS_REVIEWED = false;

/**
 * Dados que SO a operacao da empresa possui — nunca inventados aqui.
 *
 * Preencher razao social, CNPJ, endereco ou foro com um valor plausivel criaria
 * um registro juridico FALSO numa pagina publica. Marcador visivel e honesto:
 * quem abrir a pagina ve que falta preencher, em vez de ler um CNPJ inventado e
 * acreditar nele.
 */
export const LEGAL_PLACEHOLDERS = [
  "{{RAZAO_SOCIAL}}",
  "{{CNPJ}}",
  "{{ENDERECO}}",
  "{{EMAIL_CONTATO}}",
  "{{EMAIL_ENCARREGADO}}",
  "{{NOME_ENCARREGADO}}",
  "{{FORO}}",
] as const;
export type LegalPlaceholder = (typeof LEGAL_PLACEHOLDERS)[number];

/** Versao do documento. Muda a cada revisao publicada; entra no registro de consentimento. */
export const LEGAL_DOCUMENT_VERSION = "2026-08-03-minuta-1";

/**
 * Data da ultima alteracao do texto, em ISO.
 *
 * Constante, nao `new Date()`: uma data que muda a cada render diria ao leitor
 * que a politica mudou hoje, todo dia. A data de um documento juridico e a da
 * ultima alteracao real do texto.
 */
export const LEGAL_LAST_UPDATED_ISO = "2026-08-03";

/** `pt-BR` por extenso, para exibicao. */
export function formatLegalDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const months = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const monthName = months[Number(month) - 1] ?? month;
  return `${Number(day)} de ${monthName} de ${year}`;
}

/**
 * Estas paginas devem ser indexadas?
 *
 * Institucional revisado indexa normalmente (invariante 5 — indexacao total).
 * Minuta nao. O gate de ambiente de `publicRobots` continua valendo por cima:
 * preview e staging nunca indexam, independentemente desta resposta.
 */
export function legalDocumentShouldIndex(
  reviewed: boolean = LEGAL_DOCUMENTS_REVIEWED,
): boolean {
  return reviewed;
}

/* ------------------------------------------------------------------ */
/* Vocabulario espelhado do codigo de privacidade                      */
/* ------------------------------------------------------------------ */

/**
 * As quatro finalidades de consentimento, como a plataforma as registra.
 *
 * A `base` de cada uma espelha `CONSENT_LEGAL_BASIS`, do modulo de privacidade
 * da plataforma de usuario, e `legal-documents.test.ts` compara as duas tabelas.
 * Se alguem acrescentar uma finalidade no codigo e esquecer do documento, o
 * teste fica vermelho — que e o unico jeito de um texto juridico nao virar
 * ficcao com o tempo.
 */
export const LEGAL_CONSENT_PURPOSES = [
  {
    kind: "terms_of_service",
    base: "contract",
    titulo: "Termos de Uso",
    explicacao:
      "Aceitar os Termos e o que cria o vinculo entre você e a Cinerie. Como a base é a execução do contrato, não há como “desmarcar” esse aceite continuando a usar a conta — encerrar a conta é o caminho.",
  },
  {
    kind: "privacy_policy",
    base: "legal_obligation",
    titulo: "Política de Privacidade",
    explicacao:
      "O registro de que você foi informado sobre o tratamento dos seus dados. Guardamos a prova desse aceite porque a lei exige demonstrá-la.",
  },
  {
    kind: "marketing_email",
    base: "consent",
    titulo: "E-mails de novidades",
    explicacao:
      "Opcional e livremente revogável. Recusar não muda nada no funcionamento da conta, e você pode desligar quando quiser em Conta → Privacidade.",
  },
  {
    kind: "analytics",
    base: "consent",
    titulo: "Métricas de uso",
    explicacao:
      "Opcional e livremente revogável. Serve para entender quais telas as pessoas usam — nunca para decidir algo sobre você individualmente.",
  },
] as const;

/**
 * Como cada categoria de dado se comporta na exportacao e no encerramento.
 *
 * Espelha `DATA_CLASSIFICATION`. As tres colunas respondem as tres perguntas que
 * o titular faz de verdade: isso sai na minha exportacao? isso some se eu
 * encerrar? e, se nao some, por que?
 */
export const LEGAL_DATA_CATEGORIES = [
  {
    categoria: "account_core",
    rotulo: "Identificação da conta",
    exemplo: "seu e-mail e seu nome de usuário",
    exportavel: true,
    aoEncerrar: "anonimizado",
    porque:
      "O registro precisa continuar existindo para não quebrar referências de conteúdo que já saiu da sua conta; o que o liga a você é removido.",
  },
  {
    categoria: "account_credentials",
    rotulo: "Credenciais",
    exemplo: "o hash da sua senha",
    exportavel: false,
    aoEncerrar: "excluído",
    porque:
      "Nunca sai numa exportação, em hipótese alguma: devolver um hash de senha seria entregar material de ataque a quem interceptasse o arquivo.",
  },
  {
    categoria: "profile",
    rotulo: "Perfil",
    exemplo: "preferências e dados que você escreveu sobre si",
    exportavel: true,
    aoEncerrar: "excluído",
    porque: "É seu, sai inteiro na exportação e some no encerramento.",
  },
  {
    categoria: "product_content",
    rotulo: "Conteúdo que você criou",
    exemplo: "listas, avaliações, resenhas, watchlist, histórico",
    exportavel: true,
    aoEncerrar: "excluído",
    porque: "É seu, sai inteiro na exportação e some no encerramento.",
  },
  {
    categoria: "product_stats",
    rotulo: "Estatísticas agregadas",
    // O exemplo evita a palavra que a varredura de UI publica proibe
    // (`check-invariants`, padrao de pseudo-ranking): aqui e texto juridico, mas
    // a guarda e textual e fail-closed, e afrouxa-la para acomodar prosa seria
    // trocar uma protecao real por conveniencia de redacao.
    exemplo: "o total de notas que um título recebeu",
    exportavel: true,
    aoEncerrar: "mantido, já sem ligação com você",
    porque:
      "Depois da anonimização o número deixa de ser dado pessoal — é só um total, e removê-lo corromperia a estatística de todo mundo.",
  },
  {
    categoria: "security_sessions",
    rotulo: "Sessões",
    exemplo: "os hashes que sustentam seu login ativo",
    exportavel: false,
    aoEncerrar: "excluído",
    porque: "Nunca sai numa exportação: são segredos de sessão, não informação sobre você.",
  },
  {
    categoria: "security_tokens",
    rotulo: "Tokens",
    exemplo: "recuperação de senha, confirmação de e-mail",
    exportavel: false,
    aoEncerrar: "excluído",
    porque: "Mesma razão das sessões: material de autenticação nunca é devolvido.",
  },
  {
    categoria: "security_ip",
    rotulo: "Origem de acesso",
    exemplo: "o hash do endereço IP usado no login",
    exportavel: false,
    aoEncerrar: "excluído",
    porque:
      "Guardamos o hash, não o endereço, e ele existe para detectar abuso — não para traçar sua localização.",
  },
  {
    categoria: "security_audit",
    rotulo: "Registros de segurança",
    exemplo: "tentativas de login, bloqueios por abuso",
    exportavel: false,
    aoEncerrar: "retido por prazo determinado",
    porque:
      "É a defesa contra invasão de contas — inclusive a sua. Apagar na hora deixaria um ataque em andamento sem rastro.",
  },
  {
    categoria: "governance_consents",
    rotulo: "Seus consentimentos",
    exemplo: "o que você aceitou, quando, em qual versão do documento",
    exportavel: true,
    aoEncerrar: "mantido",
    porque:
      "É a prova de que pedimos permissão antes. Apagá-la nos deixaria sem como demonstrar que agimos corretamente — inclusive perante você.",
  },
  {
    categoria: "governance_requests",
    rotulo: "Seus pedidos de privacidade",
    exemplo: "exportações e encerramentos que você solicitou",
    exportavel: true,
    aoEncerrar: "mantido",
    porque: "Mesma razão: é o registro de que o pedido foi feito e atendido.",
  },
  {
    categoria: "third_party_catalog",
    rotulo: "Catálogo de terceiros",
    exemplo: "fichas de filmes e séries licenciadas de outras fontes",
    exportavel: false,
    aoEncerrar: "não se aplica",
    porque:
      "Não é dado seu e não temos direito de redistribuí-lo. Sua exportação traz o que VOCÊ marcou, não a ficha inteira do terceiro.",
  },
] as const;
