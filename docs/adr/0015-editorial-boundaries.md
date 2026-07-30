# ADR 0015 — Fronteiras canônicas da arquitetura editorial (Payload, MNScr, RSS Prime e projeção pública)

- **Status:** aceito (decisão arquitetural confirmada pelo usuário na revisão da Fase 0 editorial).
- **Data:** 2026-07-28.
- **Migration:** nenhuma. Este ADR **não** altera schema, banco, serviço ou frontend.
- **Invariantes tocadas:** 3 (zero API externa no render), 4 (zero IA no render), 5 (indexação total),
  6 (licença), 7 (`PUBLISHED_LOCALES`), 12 (não publica sozinho).
- **Contexto:** o levantamento integral do repositório (Fase 0 editorial) provou que existe uma cadeia
  editorial **governada** — fonte → item → proveniência → artigo → publicação → projeção pública —
  mas **não** existe redação editorial (autoria, corpo estruturado, mídia licenciada, taxonomia, RBAC).
  Ao mesmo tempo, a governança canônica do repositório afirmava informação **falsa** sobre o núcleo
  dessa cadeia, e alguns sistemas do fluxo aprovado foram descritos como "inexistentes" quando, na
  verdade, são **externos a este monorepo**. Este ADR fixa as fronteiras para que nenhuma dessas duas
  confusões volte a acontecer.

---

## 1. O que é externo, o que está fora e o que é daqui

| Sistema | Onde vive | Classificação correta | O que NUNCA se deve dizer |
| --- | --- | --- | --- |
| **RSS Prime** | Repositório/serviço próprio. Projeto EasyPanel `rss_prime`, serviço `feed`. | **EXTERNO** — `NÃO INSPECIONÁVEL NESTE REPOSITÓRIO` | "inexistente" |
| **MNScr** | Repositório GitHub próprio. Nasceu como clone do MN26 e hoje é aplicação independente, em especialização para a Cinerie. | **EXTERNO** — `NÃO INSPECIONÁVEL NESTE REPOSITÓRIO` | "inexistente" |
| **MN26** | Local, exclusivo da Máquina Nerd. | **FORA DA ARQUITETURA** da Cinerie. Não será modificado e não participa de nenhum fluxo daqui. | "faz parte do pipeline" |
| **Payload CMS** | Ainda não provisionado. | **DECISÃO ARQUITETURAL APROVADA** — será a sala de redação. | "decisão em aberto" |
| **`services/news-ingestion`** | Este monorepo. | **NÚCLEO ATIVO E REAL** da projeção editorial pública. | "placeholder", "só README" |
| **`apps/admin`** | Este monorepo. | Painel operacional/QA e acompanhamento da projeção. | "é o CMS" |

**Ausência de código aqui não é ausência de sistema.** Quando um relatório não puder inspecionar um
sistema externo, ele deve dizer exatamente isso e listar o acesso necessário — nunca inferir
inexistência a partir de um `grep` local.

---

## 2. Fluxo canônico

**O MNScr tem DUAS entradas independentes.** Tratá-lo como um consumidor apenas do RSS Prime
descreveria um reescritor de notícia de terceiro — não o mecanismo de **supermatéria enriquecida**
que o Cinerie quer publicar.

```
ENTRADA 1 — acontecimento externo
  RSS Prime ──── rss-prime-event-v1 ────────────┐
  (contrato do repositório do RSS Prime;        │
   o Cinerie NÃO define sua estrutura interna)  │
                                                ▼
ENTRADA 2 — contexto interno do Cinerie      ┌──────────┐
  Cinerie Context Service ─────────────────► │  MNScr   │
        cinerie-editorial-context-v1         │(externo) │
  (contrato DEFINIDO por este repositório)   └────┬─────┘
                                                  │
                                        editorial-draft-v1
                                                  │
                                                  ▼
                                          ┌───────────────┐
                                          │    Payload    │ sala de redação
                                          └───────┬───────┘
                                    revisão humana → aprovação humana
                                                  │
                                        publication-event-v1
                                                  ▼
                                     mecanismo governado de projeção
                                                  ▼
                                     services/news-ingestion
                              (identidade, dedup, lifecycle, slug, projeção)
                                                  ▼
                                     screen-db  ── projeção PÚBLICA
                                                  ▼
                                     screen-app ── render (só PostgreSQL/cache local)
```

O **MN26 permanece fora deste fluxo**, em qualquer ponto.

### O que a segunda entrada muda

Sem ela, o MNScr só saberia o que ScreenRant, Variety, Collider e The Hollywood Reporter disseram.
Com ela, o MNScr sabe **também** qual episódio, temporada, série, elenco, trailer, imagens e matérias
anteriores o Cinerie já tem sobre aquele assunto — e é essa soma que produz a supermatéria:

```
fontes externas consolidadas  +  catálogo, entidades, mídia e cobertura anterior do Cinerie
                              =  matéria consolidada do Cinerie
```

### Regras de fronteira (invioláveis)

1. **A Cinerie não consome diretamente o contrato bruto do RSS Prime.** O consumidor do RSS Prime é o
   MNScr. Este repositório **não** congela `RSS Prime → UpsertSourceItemInput`.
1-bis. **O MNScr tem duas entradas, não uma.** O acontecimento externo (`rss-prime-event-v1`) e o
   contexto interno (`cinerie-editorial-context-v1`) chegam por caminhos independentes. Um desenho que
   só contemple a primeira entrada produz reescrita de notícia de terceiro, não supermatéria.
2. **O MNScr não escreve no `screen-db`.** Ele entrega draft ao Payload e para por aí.
3. **O Payload não publica sozinho.** Publicação é ato humano registrado.
4. **O Payload não é fonte de leitura pública em runtime.** O `screen-app` nunca o consulta; se o
   Payload cair, o que já foi projetado continua servindo.
5. **O `screen-app` não depende de Payload, RSS Prime nem MNScr no render** (invariantes 3 e 4).
6. **Os dados internos do Payload não são espelhados integralmente.** A projeção é uma tradução
   deliberada, não um espelho (ver §4).

---

## 3. Contratos que este repositório define — e os que não define

**Define (quando as fases correspondentes forem autorizadas):**

- `cinerie-editorial-context-v1` — **Cinerie Context Service → MNScr**. O contexto interno que
  enriquece o acontecimento externo. **É o contrato central da supermatéria.**
- `editorial-draft-v1` — **MNScr → Payload**. A forma do draft editorial estruturado que a redação aceita.
- `publication-event-v1` — **Payload → projeção pública**. O que uma publicação, correção, despublicação
  ou retratação comunica ao lado público.

**Não define:**

- `rss-prime-event-v1` (**RSS Prime → MNScr**). Esse contrato pertence ao repositório do RSS Prime e ao
  seu consumidor. Este repositório não define sua estrutura interna e não a congela.

Nenhum dos três contratos definidos aqui está congelado nesta fase. Todos são pré-requisito da
fundação do Payload e vêm **antes** de qualquer migration editorial no `screen-db`.

---

## 3.1 Escopo de `cinerie-editorial-context-v1`

O contrato deve permitir que o MNScr utilize, **conforme disponibilidade e licença**:

| Grupo | Itens |
| --- | --- |
| Entidades | filmes, séries, temporadas, episódios, pessoas, personagens, franquias |
| Identidade | IDs internos, IDs externos **verificados**, URLs canônicas |
| Descrição | títulos localizados, sinopses, datas, duração |
| Relações | elenco, equipe, relações entre entidades, cronologia |
| Mídia | imagens autorizadas, trailers autorizados (ver §3.3) |
| Disponibilidade | onde assistir **autorizado** |
| Editorial | notícias publicadas, matérias relacionadas, contexto editorial anterior, vínculos notícia↔entidade |

### Decisão editorial que o contexto habilita

O contrato deve permitir que o MNScr **descubra** se: não existe matéria relacionada; já existe
matéria sobre o mesmo acontecimento; existe cobertura anterior relacionada; uma notícia existente
pode ser atualizada; um evergreen pode absorver a novidade; o item é duplicado; ou deve haver nova
matéria com ligação à anterior.

**O Cinerie fornece o contexto. O MNScr propõe** — criar, atualizar, vincular, consolidar ou rejeitar
por duplicidade. **O MNScr não altera diretamente conteúdo publicado.** A decisão continua sendo
transição editorial com gate e ator humano.

---

## 3.2 Cinerie Context Service (componente futuro)

Será: **interno**, **autenticado**, **somente leitura**, **não acessível ao navegador**, independente
do render público, baseado em **contrato versionado**, limitado aos dados necessários ao MNScr, e
impedido de expor secrets, dados pessoais e conteúdo privado.

**O MNScr não acessa diretamente**: Prisma, PostgreSQL, tabelas internas, `DATABASE_URL`, drafts
privados, notas internas ou dados de usuários. O serviço oferece uma **abstração estável sobre o
banco** — se o schema mudar, o contrato absorve a mudança; o MNScr não.

Isso também protege a invariante 3: o Context Service é offline em relação ao render e não cria
nenhum caminho novo do `screen-app` para fora.

---

## 3.3 Mídia contextual: existir no catálogo ≠ poder usar

**Mídia presente no catálogo NÃO é automaticamente utilizável editorialmente.** O contrato futuro
deve carregar, por item: `mediaId`, tipo, URL aprovada, dimensões, proporção, `alt`, legenda,
crédito, fonte, licença, detentor, validade, `allowedForEditorial`, `allowedForHero`,
`allowedForSocial`, `requiresAttribution` e restrições.

**O MNScr não pode usar imagem, vídeo ou trailer apenas porque o item existe no banco.** Isso
operacionaliza, do lado do contexto, a invariante 6 e a separação já vigente entre mídia de catálogo
e mídia editorial — um pôster de catálogo nunca vira imagem de notícia por default.

---

## 3.4 Proveniência de cada fato

Todo fato entregue ao MNScr preserva sua origem:

`external_source` · `cinerie_catalog` · `cinerie_editorial` · `licensed_media` · `human_input` ·
`inference`

**A camada do MNScr organiza e redige, mas não é fonte primária de fatos.** É a mesma regra que já
governa o Entity Writer (invariante 12), aplicada ao writer editorial: a IA escreve o texto, nunca
estabelece a verdade.

---

## 4. Divisão de responsabilidade entre os dois lados

```
PAYLOAD / BANCO EDITORIAL INTERNO        SCREEN-DB / PROJEÇÃO PÚBLICA
─────────────────────────────────        ────────────────────────────
drafts                                   artigo publicado
versões                                  tradução publicada
comentários de revisão                   blocos públicos renderizáveis
evidências internas                      autor público
workflow                                 taxonomia pública
RBAC                                     mídia pública licenciada
aprovação                                vínculos com entidades
mídia candidata                          SEO público
auditoria                                redirects
notas internas                           busca
                                         indexabilidade
```

O lado esquerdo **não atravessa** para o lado direito. Rascunho, nota interna, evidência bruta, score
de gate e log de aprovação são dados de redação; nunca viram linha em tabela pública.

---

## 5. Papel futuro de `services/news-ingestion`

Este pacote **não será reimplementado nem substituído**. Ele já resolve, com núcleo puro e testes, o
que a projeção pública precisa. O papel dele passa a ser o de **núcleo governado da projeção editorial
pública**:

```
publication-event-v1
  → adapter de entrada
     → services/news-ingestion
        → validação de publicação (@screena/seo)
        → persistência pública
        → projeção
           → SearchDocument
           → PageIndexabilityDecision
```

O que ele já faz hoje e será reaproveitado: identidade de item, deduplicação determinista, ciclo de
vida do artigo (`lifecycle.ts`), slug e redirect, projeção de busca e indexabilidade, métricas e portas
puras. O núcleo continua sem falar Prisma; os adapters ficam em `src/persistence/`.

**Nota sobre a projeção síncrona atual.** Hoje a projeção roda dentro do processo de ingestão local.
Isso é reaproveitável, mas **não elimina** a fronteira entre serviços: quando o Payload estiver em
outro serviço, ainda será necessário um mecanismo entre processos —

```
Payload → evento ou outbox → projection worker → services/news-ingestion → screen-db
```

Fila, polling de outbox ou webhook persistido são alternativas ainda **não decididas**. A fronteira,
porém, existirá de qualquer forma, e o desenho deve assumi-la desde já.

---

## 6. `apps/admin` — o que é e o que não será

**É:** painel operacional interno, protegido por Basic Auth, com leitura do estado editorial e uma
superfície mínima de escrita (`reviewStatus`/`indexStatus`) gateada por
`ADMIN_EDITORIAL_ACTIONS_ENABLED`.

**Não é, e não será transformado em:** CMS. Não ganhará criação de artigo, edição de corpo, autores,
mídia, taxonomia, versões ou RBAC editorial. Essas capacidades são do Payload.

**Escopo futuro exato:** a ser definido depois da fundação do Payload. Provavelmente painel de
operação da plataforma e acompanhamento da projeção pública.

---

## 7. Consequências

- Qualquer relatório que classifique `services/news-ingestion` como placeholder está **errado** e deve
  ser corrigido, não repetido.
- Qualquer proposta de expandir `apps/admin` até virar CMS contraria este ADR.
- Qualquer proposta de o Cinerie consumir o RSS Prime diretamente contraria este ADR.
- Qualquer desenho do MNScr que contemple **uma só entrada** contraria este ADR: sem
  `cinerie-editorial-context-v1` o resultado é reescrita de notícia de terceiro, não supermatéria.
- O `cinerie-editorial-context-v1` é **pré-requisito** da fundação do Payload, junto dos outros dois
  contratos — ele define o que o `screen-db` precisa saber expor, e portanto condiciona a migration.
- A ordem de trabalho decorrente: **primeiro** o contrato arquitetural da fundação Payload e da
  projeção pública; **depois** a migration aditiva do `screen-db` (autor, taxonomia, mídia, blocos).
  Criar essas tabelas antes do contrato produziria duplicação de responsabilidade entre CMS e
  projeção.

---

## 8. Adendo (FASE 2C) — a projeção pública implementada

A projeção deixou de ser contrato e virou código. O que a implementação **fixou** e que este ADR
não determinava:

**A fila é a fonte da ordem, não o evento.** `publication-event-v1` não carrega número de versão
monotônico: o campo `aggregateVersion` da outbox guarda um **hash do conteúdo** publicado, e hash
não ordena. A ordem usada para descartar evento fora de ordem é o `id` serial da linha na outbox —
a ordem real de emissão. O banco público guarda esse valor em `articles.projected_sequence`, e um
evento com sequência menor ou igual à já projetada é recusado como `skipped_stale`.

**Escopos disjuntos por conta técnica.** `draft_ingest` (MNScr) e `publication_projection` (worker)
são poderes separados. Um booleano genérico de "automação" daria ao MNScr o direito de drenar a
fila de publicação e ao worker o direito de criar rascunho.

**O recibo é a trava de idempotência.** `editorial_projection_receipts.event_id` é único e é escrito
na **mesma transação** da projeção. Não existe estado "publicado sem recibo" — seria exatamente o
estado que faria um replay publicar duas vezes.

**A assincronia continua real, e agora é observável.** O worker é o único processo que fala com os
dois lados — e a ponte é **assimétrica**: ele acessa a **API do Payload** (HTTP autenticado) e o
**banco público do Screen-App** (Prisma). Ele **não** abre conexão com o banco do CMS, e isso é
travado por `tests/governance/editorial-worker-boundary.test.ts`, que percorre o fecho transitivo de
imports do worker e recusa qualquer alcance a `payload`, `@payloadcms/*` ou `drizzle-orm`. Dizer "o
worker acessa os dois bancos" descreveria uma arquitetura diferente — e pior: a outbox deixaria de
ser fronteira e viraria tabela compartilhada. Se ele parar, o site público não quebra: para de chegar
conteúdo novo, não de servir o antigo. Detalhe operacional em
[`docs/operations/editorial-projection-worker.md`](../operations/editorial-projection-worker.md).

**Omissão deliberada: mídia.** A projeção não traz imagem. `articles.hero_image_path` é lida por um
normalizador que recusa URL http(s) por design; gravar a URL do CMS ali criaria dado morto. Trazer a
imagem exige pipeline de download e derivada local, fora desta fase — e cada matéria com mídia gera
aviso no log, para que a ausência não passe por sucesso.


---

## 9. Adendo (FASE 2D) — mídia editorial governada

A omissão declarada na FASE 2C foi fechada: a imagem de capa e as imagens do corpo agora chegam ao
site público, e chegam **governadas**.

**A fronteira do worker virou teste, não frase.** `tests/governance/editorial-worker-boundary.test.ts`
percorre o fecho **transitivo** de imports do worker e recusa qualquer alcance a `payload`,
`@payloadcms/*`, `drizzle-orm` ou `@screena/cms`. A guarda foi verificada nos dois sentidos: um import
proibido inserido num módulo **intermediário** (não no arquivo de entrada) é detectado. A redação
correta, agora sustentada por código: **o worker acessa a API do Payload e o banco público do
Screen-App** — não "os dois bancos".

**Os bytes vêm do CMS, nunca de uma URL.** `publication-event-v1` carrega `media[].url`, e ela é
ignorada de propósito. O worker pede `GET /api/internal/publication-media/:id?purpose=...` com escopo
`publication_projection`; o CMS — único que conhece a licença — decide se entrega. Seguir a URL do
evento seria SSRF com a credencial do worker.

**A chave do arquivo é derivada do conteúdo** (`editorial/<xx>/<sha256>.<ext>`). Isso torna o retry
inofensivo, deduplica a mesma foto entre matérias e elimina colisão por nome — o nome do upload nunca
entra na chave.

**`public_path` é caminho de site, com CHECK no banco.** Gravar `https://...` em `hero_image_path`
produziria matéria sem imagem em silêncio, porque `normalizeNewsLocalImagePath` recusa URL absoluta
por design. Isso deixou de ser convenção e virou constraint.

**Duas lacunas reais fechadas no caminho:**

1. O gate de publicação do CMS contava mídia de capa e galeria, mas **não** a referenciada dentro dos
   blocos do corpo. Uma matéria com imagem proibida no meio do texto publicava no CMS e morria no
   worker — a redação via um artigo "publicado" que nunca aparecia no site.
2. `upload.staticDir` era relativo (`'media'`), portanto resolvido contra o **cwd do processo**. Quem
   gravasse pela Local API a partir de outro diretório depositava o arquivo num `media/` diferente do
   que o servidor lê, e a imagem sumia com 404 sem erro nenhum. Passou a ser caminho absoluto
   ancorado em `apps/cms`.

**Storage sem fallback silencioso.** Em `production`, driver ausente ou configuração incompleta faz o
worker recusar subir; `local` é proibido lá. Disco efêmero significaria publicar hoje e perder a
imagem no próximo deploy, com o banco ainda apontando para ela. Adapter S3-compatible implementado
(SigV4 à mão, sem SDK) e testado com `fetch` injetado — **nenhum bucket, conta ou credencial real foi
criado**.

Detalhe operacional em
[`docs/operations/editorial-media-projection.md`](../operations/editorial-media-projection.md).
