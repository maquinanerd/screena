/**
 * editorial-media-config.ts — Config de LEITURA da midia editorial. PURO.
 *
 * Separado de `src/server/editorial-media.ts` para ser testavel sem subir
 * Prisma nem SDK: resolucao de ambiente e logica pura e merece teste proprio.
 *
 * As variaveis sao as MESMAS do worker (`EDITORIAL_MEDIA_*`) de proposito. Os
 * dois processos falam do mesmo bucket; nomes divergentes garantiriam que um
 * dia alguem configure so um dos lados e a imagem volte a sumir. O screen-app
 * le apenas o subconjunto necessario para um GET — nunca as opcoes de escrita.
 *
 * Nenhuma mensagem de erro carrega VALOR, so o nome da variavel: a resposta
 * HTTP e o log do container nao podem vazar secret.
 */

export interface EditorialMediaLocalRead {
  readonly driver: "local";
  readonly root: string;
}

export interface EditorialMediaS3Read {
  readonly driver: "s3";
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

export type EditorialMediaReadConfig = EditorialMediaLocalRead | EditorialMediaS3Read;

export type EditorialMediaConfigResult =
  | { readonly ok: true; readonly config: EditorialMediaReadConfig }
  | { readonly ok: false; readonly reason: string };

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Resolve a configuracao de leitura a partir do ambiente.
 *
 * Diferenca deliberada em relacao ao worker: aqui o driver `local` NAO e
 * recusado em producao. A recusa la existe porque ESCREVER em disco efemero
 * perde midia no proximo deploy; ler de um disco que alguem montou de proposito
 * e legitimo, e recusar transformaria uma escolha de infraestrutura valida em
 * 503. O que continua valendo dos dois lados: sem driver declarado em
 * producao, ninguem adivinha.
 */
export function resolveEditorialMediaReadConfig(
  env: Record<string, string | undefined>,
): EditorialMediaConfigResult {
  const declared = trimmed(env.EDITORIAL_MEDIA_STORAGE_DRIVER).toLowerCase();
  const isProduction = trimmed(env.NODE_ENV) === "production";

  if (declared === "") {
    if (isProduction) return { ok: false, reason: "EDITORIAL_MEDIA_STORAGE_DRIVER ausente" };
    // Fora de producao, `local` e o default util: permite a redacao ver a imagem
    // no ambiente de desenvolvimento sem bucket nenhum.
    const root = trimmed(env.EDITORIAL_MEDIA_LOCAL_ROOT);
    if (root === "") return { ok: false, reason: "EDITORIAL_MEDIA_LOCAL_ROOT ausente" };
    return { ok: true, config: { driver: "local", root } };
  }

  if (declared === "local") {
    const root = trimmed(env.EDITORIAL_MEDIA_LOCAL_ROOT);
    if (root === "") return { ok: false, reason: "EDITORIAL_MEDIA_LOCAL_ROOT ausente" };
    return { ok: true, config: { driver: "local", root } };
  }

  if (declared !== "s3") {
    return { ok: false, reason: "EDITORIAL_MEDIA_STORAGE_DRIVER desconhecido" };
  }

  const endpoint = trimmed(env.EDITORIAL_MEDIA_S3_ENDPOINT);
  const bucket = trimmed(env.EDITORIAL_MEDIA_S3_BUCKET);
  const accessKeyId = trimmed(env.EDITORIAL_MEDIA_S3_ACCESS_KEY_ID);
  const secretAccessKey = trimmed(env.EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY);

  const missing: string[] = [];
  if (endpoint === "") missing.push("EDITORIAL_MEDIA_S3_ENDPOINT");
  if (bucket === "") missing.push("EDITORIAL_MEDIA_S3_BUCKET");
  if (accessKeyId === "") missing.push("EDITORIAL_MEDIA_S3_ACCESS_KEY_ID");
  if (secretAccessKey === "") missing.push("EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY");
  if (missing.length > 0) return { ok: false, reason: `ausente: ${missing.join(", ")}` };
  if (!/^https?:\/\//i.test(endpoint)) {
    return { ok: false, reason: "EDITORIAL_MEDIA_S3_ENDPOINT invalido" };
  }

  return {
    ok: true,
    config: {
      driver: "s3",
      endpoint: endpoint.replace(/\/+$/, ""),
      region: trimmed(env.EDITORIAL_MEDIA_S3_REGION) || "auto",
      bucket,
      accessKeyId,
      secretAccessKey,
      // Mesmo default do worker: virtual-host exige DNS por bucket, que so a AWS
      // entrega. R2/MinIO usam path-style.
      forcePathStyle: trimmed(env.EDITORIAL_MEDIA_S3_FORCE_PATH_STYLE).toLowerCase() !== "false",
    },
  };
}
