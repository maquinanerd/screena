# Fluxo editorial MANUAL — do painel ao site

> Como uma redacao humana escreve, revisa e publica no Cinerie **sem o MNScr**.
> Em pt-BR. Este documento e operacional: quem opera o painel deveria conseguir
> trabalhar so com ele.
>
> A autopublicacao (MNScr) e outro assunto e vive em
> [`editorial-auto-publication-quota.md`](./editorial-auto-publication-quota.md)
> e na secao Q de [`../runbooks/EASYPANEL_EDITORIAL.md`](../runbooks/EASYPANEL_EDITORIAL.md).
> Nada aqui depende dela.

---

## 0. As tres coisas separadas

A confusao mais cara neste sistema e achar que "publicar" e um ato so. Sao
tres, com donos diferentes:

| Camada | Quem opera | O que produz | Onde vive |
| --- | --- | --- | --- |
| **CMS manual** | pessoas da redacao | rascunho, revisao, decisao de publicar | Payload + banco editorial + storage de upload |
| **Publicacao publica** | o worker de projecao | artigo no site, imagem no storage publico | worker + screen-db + storage publico |
| **Autopublicacao** | o MNScr (pipeline) | materia que nasce publicada | conta tecnica + kill switch + quotas |

**Uma materia publicada no CMS ainda nao esta no site.** Ela so aparece depois
que o **worker de projecao** consome o evento. Sem worker rodando, o painel diz
"publicado" e o site nao mostra nada — e o sintoma mais comum de "sumiu a
materia".

---

## 1. Acesso ao painel

O painel e `https://<host-do-cms>/admin`. Login com e-mail e senha de um
usuario da collection `editorial-users`. Nao ha login social, nao ha API key
para humano: conta tecnica e outra collection (`service-accounts`) e **nao
entra pelo painel**.

O primeiro administrador e criado no deploy (secao L do runbook do EasyPanel).
A partir dele, todos os demais usuarios saem do painel.

---

## 2. Criar usuario do CMS

`Identidade -> Editorial Users -> Create`.

Campos: e-mail, senha, `displayName`, `role`, `active`.

- **So o administrador cria, edita e desativa usuarios.** Nem o editor-chefe.
- Desativar (`active = false`) revoga o acesso de fato — a pessoa deixa de ser
  um ator para o sistema, nao so some do painel.

---

## 3. Papeis

| Papel | Cria/edita materia | Revisa | Publica | Despublica/retrata | Administra usuarios |
| --- | --- | --- | --- | --- | --- |
| `administrator` | sim | sim | sim | sim | sim |
| `editor_in_chief` | sim | sim | sim | sim | nao |
| `editor` | sim | sim | **nao** | nao | nao |
| `reviewer` | nao (revisa) | sim | **nao** | nao | nao |
| `writer` | sim | nao | **nao** | nao | nao |

**Publicacao solo e suportada e legitima.** `administrator` e `editor_in_chief`
percorrem o fluxo inteiro sozinhos — escrevem, revisam e publicam. Nenhuma
transicao e pulada por causa disso: cada uma acontece de verdade e fica no
historico de versoes. O sistema **nao** inventa uma segunda pessoa nem exige
uma que nao existe.

O que nenhum papel humano faz:

- criar materia em `automation_draft` (esse estado significa "veio do
  pipeline"; mentir sobre a origem apaga a proveniencia);
- escrever `createdBy`, `updatedBy` ou `publishedBy` — sao derivados da sessao;
- escrever `autoPublished` ou qualquer campo `automation*` — sao a
  proveniencia tecnica, e humano nao a assina.

**Limitacao conhecida:** hoje qualquer papel de conteudo (`writer`, `editor`,
`editor_in_chief`, `administrator`) pode editar **qualquer** materia, nao so as
proprias. Restringir `writer` aos proprios rascunhos e uma decisao editorial
que ainda nao foi tomada; ela nao foi feita por conta propria porque
estreitar permissao em silencio quebra redacao em operacao.

---

## 4. Autor PUBLICO nao e usuario do CMS

Sao duas identidades, de proposito:

- **`editorial-users`** — quem opera o painel. Aparece na AUDITORIA
  (`createdBy`/`updatedBy`/`publishedBy`), nunca no site.
- **`authors`** — quem ASSINA a materia. Aparece no site, no byline e no
  JSON-LD.

Criar um usuario do CMS **nao** cria um autor. Trocar quem edita **nao** troca
a assinatura publica. Trocar a assinatura publica **nao** reescreve quem
publicou.

`Editorial -> Authors -> Create`: nome, slug, e `active`. Autor **inativo nao
publica** — o gate exige pelo menos um autor ativo ligado a materia. Para
materia sem byline pessoal, use um autor institucional (`isOrganization`),
tipicamente "Redacao Cinerie".

---

## 5. Criar a materia

`Editorial -> Articles -> Create`. O formulario tem **oito abas**, na ordem em
que uma redacao trabalha:

1. **Conteudo** — titulo, linha de apoio, slug, resumo, tipo, idioma e corpo.
2. **Midia** — capa e galeria.
3. **Autoria** — autor publico, responsavel interno, secao e tags internas.
4. **SEO** — sinais editoriais (ver secao 7).
5. **Entidades** — filmes, series e pessoas citados.
6. **Fontes e QA** — lastro documental e checagem.
7. **Publicacao** — estado editorial, datas e o rastro humano (so leitura).
8. **Automacao (auditoria)** — so leitura; vazia em materia humana.

As abas mudaram **somente a interface**. Nenhum campo foi renomeado, movido de
tabela ou perdido, e nenhuma migration foi gerada por causa delas.

**O rascunho salva sozinho.** A collection usa autosave: nao ha botao "salvar
rascunho". O botao visivel, "Publish changes", e o generico do Payload e **nao
publica** uma materia fora do fluxo — o servidor recusa, porque publicar
depende de `workflowStatus`, e ele so vem de `ready_to_publish`.

---

## 6. Corpo da materia

O corpo e uma lista de **blocos tipados**, nao um editor de texto livre. Nao
existe bloco de HTML, e essa ausencia e a defesa contra injecao.

Blocos disponiveis: `paragraph`, `heading`, `image`, `video`, `quote`,
`entityCard`, `factBox` (itens rotulo/valor), `relatedContent`, `sourceList` e
`divider`.

Cada bloco tem um `blockId` estavel — e ele que ancora comentario e correcao
entre versoes. A ordem dos blocos e preservada do painel ate o site.

Nao ha lista com marcadores nem link inline: os equivalentes governados sao
`factBox`, `relatedContent` e `sourceList`.

---

## 7. SEO: o CMS aprova SINAIS, o site deriva ESTRUTURA

A aba SEO pede: `metaTitle`, `metaDescription`, `focusKeyphrase`,
`relatedKeyphrases`, `editorialKeywords`, `articleSection`,
`schemaTypeRecommendation`, titulos/descricoes sociais, `canonicalOverride` e
`noindex`.

Ela **nao** pede — e nao deve passar a pedir — `canonical` derivado, `robots`,
JSON-LD completo, `publisher`, `datePublished`, `dateModified`, sitemap ou News
Sitemap. Tudo isso e **derivado no site**, a partir da decisao de
indexabilidade. Duas fontes discordando sobre a mesma URL foi exatamente o
defeito que esta fronteira existe para impedir.

`schemaTypeRecommendation` e **recomendacao**: o tipo final do JSON-LD e
resolvido do lado publico.

---

## 8. Midia

`Editorial -> Media -> Create`, com upload do arquivo.

Preencha `alt` (obrigatorio) e o credito. Depois decida a **licenca**:
`licenseStatus`, `allowedForEditorial`, `allowedForHero`, `allowedForSocial`,
`requiresAttribution`.

O default e **fechado**: midia nasce sem permissao de uso. Liberar e um ato
explicito.

O gate de publicacao recusa a materia se qualquer imagem — capa, galeria **ou
bloco do corpo** — nao estiver aprovada para o uso pretendido. A recusa
acontece no CMS, onde ha um humano olhando, e nao la adiante no worker.

O CMS **nao e o CDN**: os bytes originais nao sao publicos. Quem serve imagem
ao publico e o storage publico, depois da projecao.

---

## 9. Fluxo de estados

```
draft -> needs_review -> in_review -> human_reviewed -> ready_to_publish -> published
```

Desvios legitimos:

- `in_review -> changes_requested -> draft` (volta para edicao e nova revisao);
- `published -> needs_update -> ... -> ready_to_publish -> published`
  (atualizacao de materia publicada);
- `published -> archived` / `published -> blocked` (despublicar);
- `published -> retracted` (retratacao, com `retractionReason`).

O que sai do ar **nao volta sem nova revisao**: de `blocked` ou `retracted` o
unico caminho de volta e `needs_review`.

Para publicar, o gate exige: `ready_to_publish`, slug, titulo, idioma, pelo
menos um autor **ativo**, QA aprovado (`qaPassedAt`), nenhum erro bloqueante,
nenhuma midia nao autorizada, e — quando `aiAssisted` — pelo menos uma fonte
externa declarada. `legalHold` bloqueia tudo ate ser liberado.

`publishedAt` e carimbado pelo **servidor** no ato da publicacao.

---

## 10. Auditoria: quem fez o que

Tres perguntas distintas, tres campos, todos so leitura e todos derivados da
sessao:

| Campo | Responde |
| --- | --- |
| `createdBy` | quem CRIOU. Nao muda mais. |
| `updatedBy` | quem alterou por ULTIMO. |
| `publishedBy` | quem PUBLICOU. Marca a transicao, nao o estado — corrigir uma virgula depois nao reescreve esse campo. |

Nenhum dos tres aceita valor do corpo da requisicao.

### `autoPublished`: o indicador explicito

`autoPublished = false` significa **publicacao humana**; `true`, autopublicacao
pelo pipeline. Materia humana tambem deixa `automationActorId` e os demais
campos `automation*` vazios.

**Nao use a ausencia de `publishedBy` como unico sinal de automacao.** Ela e
consistente hoje, mas e uma ausencia — e ausencia tambem e o que se ve quando
um dado nao foi gravado. `autoPublished` e a afirmacao, e e ela que responde a
pergunta.

---

## 11. Depois de publicar: o worker

Publicar no CMS grava um evento na `publication-outbox`. O **worker de
projecao** reclama esse evento, copia a midia aprovada para o storage publico,
grava o artigo no `screen-db` e confirma.

Sem worker rodando:

- o painel mostra `published`;
- a outbox acumula eventos `pending`;
- **o site nao muda**.

Diagnostico e acoes do worker: [`editorial-projection-worker.md`](./editorial-projection-worker.md).

---

## 12. Atualizar, despublicar, retratar

- **Atualizar** — leve a materia a `needs_update`, edite, volte por
  `ready_to_publish` e publique de novo. O evento emitido e `article.updated`
  (nao uma segunda estreia).
- **Despublicar** — `archived` ou `blocked`. Emite `article.unpublished`. O
  artigo publico e rebaixado, nao apagado.
- **Retratar** — `retracted`, com `retractionReason` preenchida. Emite
  `article.retracted`, e a evidencia da retratacao fica registrada.

---

## 13. Independencia do MNScr

O CMS manual **nao precisa** de: variavel `MNSCR_*`, chave de API do MNScr,
conta `editorial_auto_publish`, endpoint do pipeline, `requestId`,
`idempotencyKey` de automacao, `sourceClusterId`, `sourceRevision`,
`sourcePayloadHash`, `schemaHash` de request ou `pipelineVersion`.

Com `EDITORIAL_AUTO_PUBLISH_ENABLED=false` (ou ausente):

- `/healthz` responde **200**;
- `/readyz` responde **200**, com o check `auto_publish` em `ok` e detalhe
  "desabilitada";
- o painel atende e a publicacao manual funciona.

Kill switch desligado e **estado operacional conhecido**, nao avaria. O
readiness so bloqueia (503) quando a automacao esta **ligada** e mal
configurada — por exemplo, fuso horario ausente ou invalido em producao.

---

## 14. Como isso e provado

| Prova | Comando |
| --- | --- |
| Matriz de papeis, abas e ausencia de mudanca de schema (puro) | `pnpm --filter @screena/cms test` |
| Caminho manual completo por HTTP + readiness sem MNScr | `pnpm test:manual-editorial:integration` |
| Painel `/admin` num navegador real | `pnpm test:manual-editorial:e2e` |
| Canario ponta a ponta ate a pagina publica e o sitemap | `pnpm test:manual-publication-projection:integration` |

Todos sobem PostgreSQL 16 efemero e storage temporario. Nenhum toca producao,
bucket real, EasyPanel ou MNScr.
