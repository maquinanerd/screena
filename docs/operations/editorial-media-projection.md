# Projecao de midia editorial (CMS -> storage publico)

> Complementa [`editorial-projection-worker.md`](./editorial-projection-worker.md).
> Aqui esta so o que diz respeito a **imagem**.

## 1. O caminho dos bytes

```
Payload media (aprovada por humano)
   -> GET /api/internal/publication-media/:id?purpose=hero   (autenticado, escopo publication_projection)
   -> worker: valida assinatura, MIME real, dimensoes e hash
   -> storage: editorial/<xx>/<sha256>.<ext>   (chave derivada do CONTEUDO)
   -> screen-db: editorial_media_assets + articles.hero_image_path
   -> apps/web: rota /media/editorial/** casa public_path -> le storage_key
```

A ultima seta e um **route handler**
([`apps/web/app/media/editorial/[...key]/route.ts`](../../apps/web/app/media/editorial/%5B...key%5D/route.ts)),
nao um arquivo em `public/`. A distincao importa: com driver `s3` os bytes nunca
tocam o disco do screen-app, entao servir estaticamente e impossivel por
construcao. A rota casa o caminho da URL com a linha de `editorial_media_assets`
e le o objeto apontado pela coluna `storage_key` — **a URL nunca vira chave de
storage**. Config e assimetrias em
[`easypanel-deployment-checkpoint.md` §12.1](./easypanel-deployment-checkpoint.md).

O worker **nunca** baixa de uma URL. O contrato carrega `media[].url`, e ela e
deliberadamente ignorada: seguir um link escrito por um editor, vindo do MNScr ou
colado num bloco seria buscar bytes num host arbitrario com a credencial do
worker no bolso. A origem e sempre o endpoint interno, montado a partir da base
configurada e de um `mediaId` canonico.

## 2. Autorizacao (no CMS, nao no worker)

A licenca so o CMS conhece; reimplementar a regra no worker criaria duas copias
que divergem no primeiro campo novo. O endpoint recusa, nesta ordem:

| Codigo | Quando |
| --- | --- |
| `media_not_found` | documento inexistente ou id malformado |
| `license_not_approved` | `licenseStatus` != `approved` (allowlist: status novo nasce proibido) |
| `license_expired` | `licenseExpiresAt` no passado — ou **ilegivel** |
| `purpose_not_allowed` | falta `allowedForEditorial`/`allowedForHero`/`allowedForSocial` |
| `attribution_missing` | `requiresAttribution` sem `credit` (invariante 6) |
| `file_missing` / `mime_not_allowed` / `file_too_large` | arquivo ausente, formato ou tamanho fora |

`restricted` fica de fora da allowlist de proposito: ela existe para uso
condicionado (janela, veiculo, contexto) e essa condicao nao esta modelada.

**Antes disso**, o proprio gate de publicacao do CMS ja recusa publicar artigo
com midia nao autorizada em capa, galeria **ou nos blocos do corpo** — a
cobertura dos blocos foi adicionada nesta fase. Recusar onde ha um humano
olhando e melhor do que deixar publicar e morrer no worker, com a redacao vendo
um artigo "publicado" que nunca aparece no site.

## 3. Formatos e limites

| Item | Valor |
| --- | --- |
| MIME aceitos | `image/jpeg`, `image/png`, `image/webp`, `image/avif` |
| Recusados | SVG/XML, HTML, PDF, executavel, arquivo compactado, GIF, BMP, MIME desconhecido |
| Tamanho | 15 MB |
| Pixels | 40 MP; lado entre 16 e 12.000 px |

A deteccao e por **assinatura de bytes**, nunca por extensao ou `Content-Type`
declarado — o MIME declarado serve so para *pegar mentira*: se divergir do real,
os bytes sao recusados.

O limite de **pixels** existe separado do de bytes porque uma imagem de
30.000 x 30.000 cabe em poucos KB comprimida e estoura a memoria de qualquer
decodificador.

AVIF: as dimensoes vivem numa caixa de deslocamento variavel e nao sao lidas.
Sem dimensao, o gate de pixels nao pode ser aplicado, entao o formato e
**recusado por padrao** (`dimensions_unreadable`). Aceita-lo exige opt-in
explicito — que e abrir mao daquele gate conscientemente.

## 4. Storage

| Driver | Uso |
| --- | --- |
| `local` | desenvolvimento e teste. **Recusado em `production`** |
| `s3` | producao futura (Cloudflare R2, MinIO, S3) |

Nao ha bucket, conta nem credencial reais neste repositorio, e nao deve haver.
O adapter S3 assina SigV4 a mao (sem SDK, como o cliente Brevo) e e testado com
`fetch` injetado — a suite nao abre socket.

**Sem fallback silencioso.** Em `production`, driver ausente ou configuracao
incompleta faz o worker recusar subir. O motivo e concreto: no EasyPanel o disco
do container e efemero, e um fallback "amigavel" para filesystem faria a redacao
publicar, ver a imagem no ar e perde-la no proximo deploy — com o banco ainda
apontando para um arquivo que nao existe.

Variaveis: `EDITORIAL_MEDIA_STORAGE_DRIVER`, `EDITORIAL_MEDIA_LOCAL_ROOT`,
`EDITORIAL_MEDIA_PUBLIC_BASE_PATH`, `EDITORIAL_MEDIA_S3_ENDPOINT`,
`EDITORIAL_MEDIA_S3_REGION`, `EDITORIAL_MEDIA_S3_BUCKET`,
`EDITORIAL_MEDIA_S3_ACCESS_KEY_ID`, `EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY`,
`EDITORIAL_MEDIA_S3_FORCE_PATH_STYLE`. Nenhuma mensagem de erro imprime valor —
so o nome.

O CMS tambem passou a usar caminho **absoluto** para os uploads locais
(`EDITORIAL_MEDIA_CMS_STATIC_DIR`, default `apps/cms/media`). Um `staticDir`
relativo resolve contra o `cwd` do processo: quem grava pela Local API a partir
de outro diretorio deposita o arquivo num `media/` diferente do que o servidor
le, e a imagem "some" com 404 sem erro nenhum no meio do caminho.

## 5. Chave e referencia publica

```
storageKey  = editorial/<2 primeiros hex>/<sha256>.<ext>
publicPath  = /media/editorial/<2 primeiros hex>/<sha256>.<ext>
```

Derivar do conteudo resolve tres problemas de uma vez: **retry seguro**
(reescrever a mesma chave com os mesmos bytes e inofensivo), **deduplicacao** (a
mesma foto em dez materias ocupa um arquivo) e **ausencia de colisao** (dois
uploads chamados `capa.jpg` nao disputam caminho). O nome enviado pelo usuario
nunca entra na chave.

O balde de dois caracteres evita um diretorio com centenas de milhares de
arquivos, onde filesystem e listagem de bucket degradam.

`publicPath` e **caminho de site, nunca URL**. `normalizeNewsLocalImagePath` no
`apps/web` recusa `http(s)` por design; uma URL ali viraria materia sem imagem em
silencio. O banco tem CHECK para isso — nao e so convencao.

## 6. Ordem: storage antes do banco

1. claim -> 2. valida contrato -> 3. planeja assets -> 4. baixa e verifica ->
5. grava no storage -> 6. **abre transacao** -> 7. assets + artigo + blocos +
recibo -> 8. commit -> 9. ack.

Baixar 15 MB dentro de uma transacao aberta seguraria conexao e travas de linha
pelo tempo da rede, transformando latencia de CDN em contencao no banco publico.

**Consequencia assumida:** morrer entre gravar o arquivo e commitar deixa o
arquivo sem referencia. Isso e **orfao, nao corrupcao** — a chave e derivada do
conteudo, entao o retry reaproveita o mesmo arquivo em vez de duplicar. Coleta de
orfaos e trabalho futuro; nunca apagar asset compartilhado sem contar referencias.

## 7. Retry x dead-letter

| Retentavel | Permanente |
| --- | --- |
| timeout, rede, Payload indisponivel (5xx), storage fora | licenca proibida/vencida, MIME proibido, SVG, hash divergente, mediaId inexistente, tamanho ou dimensoes fora, finalidade nao autorizada |

Falha de bytes nunca e retentavel: o arquivo nao muda sozinho, e insistir so
adiaria o dead-letter que o editor precisa ver.

Nada de stack, URL com credencial, caminho interno, `Authorization` ou conteudo
de arquivo atravessa para o Payload — a mensagem que chega ao painel e
sanitizada.

## 8. O que esta fora desta fase

- **Video nao e baixado.** Sobrevive a referencia estruturada (provider + id);
  URL livre e embed HTML nao atravessam — `<iframe>` vindo do corpo e execucao de
  terceiro numa pagina nossa.
- **Derivadas** (miniatura, `srcset`, conversao para WebP/AVIF).
- **Coleta de orfaos** no storage.
- **Bucket real / R2 / EasyPanel** — nada foi criado.

## 9. Gates

| Comando | Prova |
| --- | --- |
| `pnpm test` | validacao por bytes, chave, config, plano, autorizacao |
| `pnpm test:editorial-media-projection:integration` | CMS real + dois PG16 + storage local + arquivo real em disco |
| `pnpm --filter @screena/db db:validate:real` | CHECKs do banco: sem URL em `public_path`, sem `..` em `storage_key`, hash com formato |
