/**
 * upload.ts — validacao PURA do arquivo enviado (C8).
 *
 * DECISAO DE SEGURANCA CENTRAL: esta unidade aceita **apenas CSV de texto**, e
 * RECUSA arquivos compactados.
 *
 * Isso nao e uma limitacao acidental — e a mitigacao mais forte disponivel. Um
 * leitor de ZIP traria, de uma vez, zip-bomb (razao de compressao), path
 * traversal (`../` em nomes de entrada), arquivos aninhados e um numero de
 * entradas potencialmente ilimitado. Nao ler ZIP elimina a superficie inteira
 * em vez de tentar defende-la. O export do Letterboxd vem em ZIP; o usuario
 * extrai e envia o CSV — um passo a mais para ele, uma classe inteira de
 * vulnerabilidade a menos para todo mundo.
 *
 * As checagens abaixo tambem NAO confiam no `Content-Type` informado pelo
 * navegador: ele e escolhido pelo cliente. A decisao vem do CONTEUDO (bytes
 * iniciais e decodificacao UTF-8).
 */

import { type DomainResult, err, ok } from "../core/result.js";

/** Teto do arquivo aceito. Acima disso a borda recusa antes de decodificar. */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Teto do nome de arquivo guardado (a coluna e livre, a sanidade nao). */
export const IMPORT_FILENAME_MAX_LENGTH = 200;

/**
 * Assinaturas de arquivos COMPACTADOS ou binarios que precisam ser recusados
 * com mensagem clara — e nao "parseados" como se fossem texto.
 *
 * ZIP (`PK\x03\x04`) e o caso real: e o que o Letterboxd entrega.
 */
const BINARY_SIGNATURES: readonly { readonly bytes: readonly number[]; readonly label: string }[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: "ZIP" },
  { bytes: [0x50, 0x4b, 0x05, 0x06], label: "ZIP" },
  { bytes: [0x1f, 0x8b], label: "GZIP" },
  { bytes: [0x52, 0x61, 0x72, 0x21], label: "RAR" },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf], label: "7Z" },
  { bytes: [0x25, 0x50, 0x44, 0x46], label: "PDF" },
];

/** Aspas e metacaracteres que nao devem sobreviver no nome exibido/serializado. */
const UNSAFE_FILENAME_CHARS: ReadonlySet<string> = new Set([
  '"',
  "'",
  "`",
  "<",
  ">",
  "|",
]);

function matchesSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((b, i) => bytes[i] === b);
}

/**
 * Sanitiza o nome do arquivo antes de persisti-lo.
 *
 * Fica so o basename: separadores de caminho e sequencias `..` sao removidos,
 * de modo que o nome guardado nunca possa ser interpretado como caminho. O
 * valor e puramente informativo (aparece na tela "meus imports") e NUNCA e
 * usado para abrir, escrever ou servir arquivo — nao ha armazenamento de
 * arquivo nesta unidade.
 */
export function sanitizeFileName(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const base = raw.split(/[/\\]/).pop() ?? "";
  const limpo = base
    .replace(/\.{2,}/g, ".")
    // Filtro por CODE POINT, nao por classe de regex: uma classe com
    // caracteres de controle dispara no-control-regex e — pior — costuma
    // sobreviver no arquivo como byte invisivel (a mesma armadilha ja
    // registrada em tests/governance). Aqui o criterio e explicito.
    .split("")
    .filter((ch) => (ch.codePointAt(0) ?? 0) > 0x1f && !UNSAFE_FILENAME_CHARS.has(ch))
    .join("")
    .trim()
    .slice(0, IMPORT_FILENAME_MAX_LENGTH);
  return limpo.length === 0 ? null : limpo;
}

/**
 * Valida os BYTES recebidos e devolve o texto decodificado.
 *
 * Ordem: tamanho -> assinatura binaria -> decodificacao UTF-8 estrita -> byte
 * NUL. Cada passo recusa antes de gastar o proximo.
 */
export function validateAndDecodeUpload(bytes: Uint8Array): DomainResult<string> {
  if (bytes.length === 0) {
    return err("validation_failed", "arquivo vazio.");
  }
  if (bytes.length > IMPORT_MAX_FILE_BYTES) {
    return err("validation_failed", "arquivo grande demais.", [
      `o limite e ${Math.floor(IMPORT_MAX_FILE_BYTES / (1024 * 1024))} MB`,
    ]);
  }

  for (const assinatura of BINARY_SIGNATURES) {
    if (matchesSignature(bytes, assinatura.bytes)) {
      return err("validation_failed", "envie o arquivo CSV, nao o pacote compactado.", [
        `arquivo ${assinatura.label} nao e aceito; extraia e envie o .csv`,
      ]);
    }
  }

  let texto: string;
  try {
    // `fatal: true` recusa sequencia UTF-8 invalida em vez de trocar por U+FFFD.
    // Um arquivo em Latin-1 chega aqui e e RECUSADO com mensagem clara — melhor
    // do que importar titulos com caracteres corrompidos em silencio.
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return err("validation_failed", "arquivo nao esta em UTF-8.", [
      "salve o arquivo como UTF-8 e envie de novo",
    ]);
  }

  if (texto.includes("\u0000")) {
    return err("validation_failed", "arquivo invalido.", ["conteudo binario detectado"]);
  }

  return ok(texto);
}
