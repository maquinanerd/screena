/**
 * storage-port.ts — Contrato de armazenamento durável da midia editorial. PURO.
 *
 * A chave e DETERMINISTICA e derivada do CONTEUDO. Isso resolve de uma vez tres
 * problemas que apareceriam separados:
 *
 *  - retry seguro: reescrever a mesma chave com os mesmos bytes e inofensivo;
 *  - deduplicacao: a mesma foto usada em dez materias ocupa um arquivo so;
 *  - ausencia de colisao: dois uploads chamados `capa.jpg` nao disputam caminho.
 *
 * O nome enviado pelo usuario NUNCA entra na chave. Ele e dado nao confiavel:
 * pode conter `..`, separador de caminho, byte nulo ou 4 KB de lixo.
 */

/** Prefixo de todas as chaves de midia editorial. */
export const EDITORIAL_MEDIA_PREFIX = 'editorial'

export interface StoredObject {
  readonly key: string
  readonly byteSize: number
  readonly contentType: string
}

/**
 * Porta de armazenamento. Minima de proposito: cada operacao a mais e uma
 * superficie a mais para o adapter S3 divergir do adapter local.
 */
export interface MediaStoragePort {
  /** Grava os bytes. DEVE ser idempotente para a mesma chave. */
  put(input: {
    readonly key: string
    readonly bytes: Uint8Array
    readonly contentType: string
  }): Promise<StoredObject>
  exists(key: string): Promise<boolean>
  stat(key: string): Promise<{ readonly byteSize: number } | null>
  read(key: string): Promise<Uint8Array | null>
  /** SO para limpeza governada de orfaos. Nunca no caminho de projecao. */
  delete(key: string): Promise<void>
  /** Caminho publico servido pelo screen-app (nunca URL http(s)). */
  publicReference(key: string): string
}

/* ------------------------------------------------------------------ */
/* Derivacao da chave                                                  */
/* ------------------------------------------------------------------ */

const HEX_64 = /^[0-9a-f]{64}$/
const SAFE_EXTENSION = /^[a-z0-9]{2,5}$/

/**
 * `editorial/<2 primeiros hex>/<sha256>.<ext>`.
 *
 * O nivel de dois caracteres existe para nao criar um diretorio com centenas de
 * milhares de arquivos: filesystem e listagem de bucket degradam, e um `ls` no
 * servidor trava. 256 baldes bastam para a escala editorial.
 */
export function editorialMediaKey(contentHash: string, extension: string): string {
  const hash = contentHash.replace(/^sha256:/, '').toLowerCase()
  if (!HEX_64.test(hash)) {
    throw new Error('contentHash deve ser sha256 em hexadecimal de 64 caracteres')
  }
  const ext = extension.toLowerCase().replace(/^\./, '')
  if (!SAFE_EXTENSION.test(ext)) {
    // A extensao vem de uma tabela fechada por MIME. Se chegar outra coisa aqui,
    // alguem esta passando o nome do upload adiante.
    throw new Error('extensao invalida para chave de storage')
  }
  return `${EDITORIAL_MEDIA_PREFIX}/${hash.slice(0, 2)}/${hash}.${ext}`
}

/**
 * A chave e segura para virar caminho de arquivo?
 *
 * Ultima barreira antes de `path.join`. Uma chave com `..` escaparia do
 * diretorio raiz do storage local e escreveria em qualquer lugar do disco.
 */
export function isSafeStorageKey(key: string): boolean {
  if (key === '' || key.length > 200) return false
  if (key.startsWith('/') || key.includes('\\')) return false
  if (key.includes('\0')) return false
  const segments = key.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  return /^[a-z0-9/._-]+$/.test(key)
}

/**
 * Caminho publico a partir da chave.
 *
 * Retorna caminho ABSOLUTO de site (`/media/editorial/...`), nunca URL http(s):
 * `normalizeNewsLocalImagePath` no `apps/web` recusa URL absoluta por design, e
 * gravar uma la produziria uma materia sem imagem em silencio.
 */
export function editorialPublicPath(key: string, basePath = '/media'): string {
  if (!isSafeStorageKey(key)) throw new Error('chave de storage insegura')
  const base = basePath.startsWith('/') ? basePath : `/${basePath}`
  return `${base.replace(/\/+$/, '')}/${key}`
}
