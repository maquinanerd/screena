/**
 * editorial-media-report.ts — O 404 da midia editorial deixa de ser mudo. PURO.
 *
 * O PROBLEMA. Quando `/media/editorial/**` responde 404, a pagina da materia
 * continua respondendo **200** com um `<img>` quebrado. Quem publicou nunca fica
 * sabendo: nao ha erro na pagina, nao ha alerta, e a unica forma de descobrir e
 * alguem abrir a materia e reparar no espaco vazio. Uma foto que some em
 * silencio e pior que uma foto que nunca subiu.
 *
 * O QUE NAO SE PODE FAZER PARA RESOLVER. Contar a causa na RESPOSTA. O corpo
 * vazio e a indistinguibilidade entre "caminho malformado", "asset inexistente"
 * e "licenca nao permite" sao deliberados: distinguir ajudaria a enumerar o
 * bucket. Por isso a resposta HTTP continua identica byte a byte — nenhum
 * cabecalho novo, nenhum corpo.
 *
 * O CANAL, ENTAO, E O SERVIDOR. Uma linha estruturada por 404, com a CAUSA
 * nomeada e o `public_path` — que e o que permite ao operador achar a materia e
 * reingerir a foto. O que NUNCA entra na linha: `storage_key` (revela o layout
 * do bucket), texto de erro do Prisma (carrega a `DATABASE_URL`) e qualquer
 * credencial.
 *
 * A causa que mais precisa chegar ao emissor e `object_missing`: o banco afirma
 * que a imagem existe e os bytes nao estao la. As outras duas sao, quase sempre,
 * link velho ou licenca vencida — reais, mas nao um bug de entrega.
 */

/** Por que os bytes nao foram entregues. */
export type EditorialMediaMissReason =
  /** Os segmentos da URL nao formam um caminho valido. Link velho ou varredura. */
  | "malformed_path"
  /** Nenhuma linha servivel: nao existe, ou licenca/validade/flag barraram. */
  | "no_serveable_row"
  /** Linha presente, objeto ausente no storage — ORFAO INVERTIDO. */
  | "object_missing";

export interface EditorialMediaMiss {
  readonly event: "editorial_media_miss";
  readonly reason: EditorialMediaMissReason;
  /** Caminho publico pedido. `null` quando nem caminho valido houve. */
  readonly publicPath: string | null;
  /**
   * Este 404 indica um problema de ENTREGA que alguem precisa corrigir?
   *
   * `object_missing` sim: o banco e o storage discordam, e a materia esta no ar
   * com imagem quebrada agora. Os outros dois sao esperados em operacao normal
   * (link antigo, licenca vencida) e nao devem gerar ruido de alerta.
   */
  readonly actionable: boolean;
}

/**
 * Monta o evento. Nao escreve nada — quem escreve e o chamador.
 *
 * Separado do IO de proposito: assim o formato do evento tem teste, e a rota
 * continua sendo so o adaptador.
 */
export function buildEditorialMediaMiss(
  reason: EditorialMediaMissReason,
  publicPath: string | null,
): EditorialMediaMiss {
  return {
    event: "editorial_media_miss",
    reason,
    publicPath: reason === "malformed_path" ? null : publicPath,
    actionable: reason === "object_missing",
  };
}

/**
 * Serializa em UMA linha, JSON, para o coletor de logs do EasyPanel.
 *
 * JSON e nao prosa porque a linha existe para ser filtrada
 * (`event=editorial_media_miss actionable=true`), nao lida uma a uma.
 */
export function formatEditorialMediaMiss(miss: EditorialMediaMiss): string {
  return JSON.stringify(miss);
}
