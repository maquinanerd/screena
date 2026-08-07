# Ingestao de midia editorial por maquina (`POST /api/internal/editorial-media`)

> Fecha a ultima peca do caminho automatico. Ate aqui o MNScr entregava a materia
> inteira **menos a foto**, e a imagem so entrava com uma pessoa arrastando
> arquivo no painel. Complementa
> [`editorial-media-projection.md`](./editorial-media-projection.md), que cobre o
> trecho **seguinte** (CMS -> storage publico -> site).

## 1. Onde esta rota entra

```
MNScr ── POST /api/internal/editorial-drafts ──► materia (texto)
MNScr ── POST /api/internal/editorial-media  ──► foto no acervo   [ESTA ROTA]
                                                    │
       publicacao ──► outbox ──► worker ──► storage publico ──► /media/editorial/**
```

Ela **nao** publica, **nao** cria materia e **nao** escreve no `screen-db`. Ela
poe a foto no acervo do CMS, vinculada a materia — e nada alem disso.

## 2. Credencial

Conta tecnica com o escopo **`editorial_media_ingest`**, e so ele.

O escopo e separado de `draft_ingest` **de proposito, nao por simetria**: a foto
e o unico dado que atravessa a fronteira como **bytes**, e o unico que, uma vez
no acervo, e servido publicamente. Dar essa capacidade a quem so precisa escrever
texto alargaria o raio de estrago de uma chave vazada sem nenhum ganho.

```
Authorization: service-accounts API-Key <chave>
```

## 3. Corpo

```jsonc
{
  "articleId":     "123",                    // obrigatorio, numerico
  "sourceUrl":     "https://...jpg",         // obrigatorio, http(s) absoluta
  "sourceName":    "Estudio Exemplo",        // obrigatorio
  "rightsHolder":  "Estudio Exemplo",        // obrigatorio
  "credit":        "Divulgacao/Estudio",     // obrigatorio
  "alt":           "Cena do filme",          // obrigatorio
  "caption":       "Legenda opcional",       // opcional
  "contentType":   "image/jpeg",             // jpeg | png | webp
  "contentBase64": "..."                     // obrigatorio, os BYTES
}
```

**Os bytes vem no corpo. A rota nunca baixa de `sourceUrl`.** Seguir um link
escrito por terceiro seria buscar conteudo num host arbitrario com a credencial
do CMS no bolso (SSRF). `sourceUrl` e **prova de origem**, nao endereco de
download — e a metade da chave de idempotencia.

### Por que a proveniencia e obrigatoria

Decisao do operador (2026-08-06): **imagem de robo e publica sempre**. A
proveniencia serve para **atender reclamacao** — saber de onde veio e tirar do ar
em minutos —, nao para bloquear publicacao.

Dessa decisao decorre a regra: se a licenca nao barra na **saida**, a
proveniencia tem de ser exigida na **entrada**. Aqui existe um emissor escutando
o `422`; na entrega nao existe ninguem — a imagem simplesmente nao aparece.

`credit` em particular nao e cosmetico: `requiresAttribution` nasce `true` e
`authorizeMediaDelivery` recusa com `attribution_missing` quando ele esta vazio.
Sem exigir na entrada, a foto entraria no acervo e morreria calada.

## 4. Respostas

| Status | `outcome` | Quando |
| --- | --- | --- |
| `201` | `created` | primeira vez para este par (materia, `sourceUrl`) |
| `200` | `unchanged` | reenvio identico — nenhum upload, nenhuma escrita |
| `200` | `replaced` | mesma url, conteudo diferente: a fonte trocou a foto |

Corpo: `{ outcome, mediaId, contentHash }`.

### Esta rota NAO aponta a capa

Uma versao anterior aceitava `setAsHero`. O teste de integracao mostrou por que
isso nao pode existir: o hook de governanca (`hooks/articles.ts`) **forca**
`workflowStatus = 'automation_draft'` para qualquer service account sem
`editorial_auto_publish`. Subir a foto de uma materia que um humano deixou em
`ready_to_publish` a **rebaixaria para rascunho de automacao**, em silencio, como
efeito colateral de anexar uma imagem.

A capa continua sendo escolhida por quem escreve: no painel, ou pelo contrato de
`editorial-drafts`, que passa pelo gate certo.

### Recusas

| Status | `error` | Significado |
| --- | --- | --- |
| `401` | `unauthenticated` | credencial ausente ou nao reconhecida |
| `403` | `forbidden_scope` | conta reconhecida, sem `editorial_media_ingest` |
| `400` | `invalid_json` | corpo nao e JSON |
| `404` | `article_not_found` | `articleId` nao existe |
| `413` | `payload_too_large` / `image_too_large` | corpo > 21 MB / imagem > 15 MB |
| `415` | `mime_not_allowed` | `contentType` fora de jpeg/png/webp |
| `415` | `dangerous_format` | SVG, HTML, PDF, executavel, ZIP — **com o nome** |
| `415` | `bytes_mismatch` | assinatura dos bytes diverge do `contentType` |
| `422` | `validation_failed` | campos faltando, em `issues[]` — **todos de uma vez** |
| `503` | `idempotency_unavailable` | nao deu para confirmar se ja existia; **repita** |

`401` e `403` dizem coisas diferentes de proposito: `401` manda conferir a
**chave**, `403` manda conferir o **escopo** da conta. Colapsar os dois faria
alguem regerar uma chave que estava certa o tempo todo.

`dangerous_format` nomeia o formato porque "SVG recusado" ensina o emissor a
corrigir; "formato desconhecido" faz ele reenviar o mesmo arquivo.

## 5. Idempotencia: (materia, `sourceUrl`)

A chave **nao** e o hash do conteudo. Duas razoes concretas:

- **reenvio.** O MNScr reprocessa a materia quando a revisao muda e reenvia a
  mesma foto. Com a chave certa, o reenvio encontra a propria entrada;
- **a mesma foto em duas materias.** Com chave por conteudo elas colidiriam, e a
  segunda materia herdaria o `alt` escrito para a primeira.

A coluna `media.ingested_for_article_id` (migration
`20260807_024956_editorial_media_ingest`) e a metade nova da chave;
`media.source_url` ja existia. `ON DELETE set null`: apagar a materia nao apaga a
foto do acervo.

## 6. AVIF e recusado aqui, e aceito na entrega

Nao e incoerencia. Na **entrega**, um humano escolheu aquele arquivo no painel.
Na **ingestao por maquina**, as dimensoes do AVIF vivem numa caixa de
deslocamento variavel que o validador nao le — aceitar seria abrir mao do gate de
pixels em silencio.

## 7. Quando a foto nao aparece no site

O 404 de `/media/editorial/**` **nao** conta a causa na resposta: corpo vazio e
causas indistinguiveis, para nao ajudar ninguem a enumerar o bucket. A causa vai
para o **log do servidor**, uma linha JSON por 404:

```json
{"event":"editorial_media_miss","reason":"object_missing","publicPath":"/media/editorial/ab/abc.jpg","actionable":true}
```

| `reason` | `actionable` | Significado |
| --- | --- | --- |
| `malformed_path` | nao | link velho ou varredura; nem virou caminho valido |
| `no_serveable_row` | nao | nao existe, ou licenca/validade/flag barraram |
| `object_missing` | **sim** | **linha presente, objeto ausente** — banco e storage discordam |

Filtre por `actionable=true`. Antes disso o 404 era **totalmente mudo**: a pagina
da materia respondia 200 com um `<img>` quebrado e quem publicou so descobria
abrindo a materia. `object_missing` e a unica das tres que significa "quebrado
agora"; reingerir a foto por esta rota corrige.
