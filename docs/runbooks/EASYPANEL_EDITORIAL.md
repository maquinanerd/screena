# Runbook — implantar CMS e worker de projeção no EasyPanel

> **Nada aqui foi executado.** Este documento descreve os passos **futuros**, na
> ordem em que precisam acontecer. O repositório está preparado; a infraestrutura
> não foi tocada.
>
> **Informação declarada pelo usuário — pendente de validação operacional:** o
> projeto no EasyPanel se chama `rss_prime` e contém `feed`, `screen-app` e
> `screen-db`. Este repositório não verificou nada disso.
>
> **Informação validada por código e teste:** as variáveis exigidas, os gates
> fail-closed, a ordem de migração e o comportamento de readiness. Cada etapa
> abaixo indica a evidência que o Claude pode conferir depois.

## Visão geral

```
rss_prime (projeto EasyPanel)
├── feed                          RSS Prime          (externo, já existe)
├── screen-app                    Cinerie público    (já existe)
├── screen-db                     PostgreSQL         (já existe)
├── cinerie-cms                   Payload            ← CRIAR
└── cinerie-publication-worker    projeção           ← CRIAR
```

O worker é o único processo que fala com os dois lados, e de forma **assimétrica**:
API do Payload por HTTP, banco público por Prisma. Ele **não** conecta ao banco
do CMS.

### Três camadas independentes — implante nesta ordem

A separação importa porque **cada camada é útil sozinha**, e tratá-las como um
bloco único faz uma redação esperar pelo pipeline que ela não usa.

| Camada | O que precisa | O que entrega sozinha | Seções |
| --- | --- | --- | --- |
| **1. CMS manual** | Payload + banco editorial + storage de upload + um usuário humano | redação escreve, revisa e **publica** | C–L |
| **2. Publicação pública** | worker de projeção + `screen-db` + storage público | a matéria publicada **aparece no site** | N–P |
| **3. Autopublicação (MNScr)** | conta `editorial_auto_publish` + kill switch + quotas + fuso | matéria que nasce publicada | M (parcial), Q |

- Parando na camada **1**, o CMS é utilizável: `/readyz` responde 200 e a
  redação publica. A matéria fica na `publication-outbox` esperando o worker —
  ela **não** aparece no site ainda, e isso é o comportamento correto, não uma
  falha.
- Parando na camada **2**, o produto editorial está completo: humano publica e o
  site mostra. **É o estado alvo de quem não usa o MNScr.**
- A camada **3** é opcional e **último passo**. Nada em 1 e 2 depende dela: sem
  `EDITORIAL_AUTO_PUBLISH_ENABLED=true`, o check `auto_publish` do `/readyz` sai
  `ok` com detalhe "desabilitada" — kill switch desligado é estado conhecido,
  não avaria.

Operação diária da camada 1 (papéis, abas, corpo, SEO, mídia, workflow,
auditoria): [`../operations/manual-editorial-workflow.md`](../operations/manual-editorial-workflow.md).

---

## A. Validar o projeto

| | |
|---|---|
| Sistema | EasyPanel |
| Onde | lista de projetos |
| Obter | o projeto `rss_prime` existe? |
| Risco | criar serviços no projeto errado mistura ambientes |
| Desfazer | serviço ainda não criado; nada a desfazer |
| Evidência | nome do projeto e lista de serviços |

## B. Validar os serviços existentes

Confirmar `feed`, `screen-app` e `screen-db`, e anotar **como** os serviços se
enxergam na rede interna (alias/host). O worker vai precisar do endereço interno
do CMS — usar o domínio público faria a credencial sair e voltar pela internet
sem necessidade.

**Não exponha** as connection strings ao anotar isso.

## C. O `screen-db` aceita um database lógico separado?

| | |
|---|---|
| Sistema | EasyPanel → `screen-db` |
| Obter | é possível criar outro database e um usuário próprio? |
| Não expor | senha do superusuário |
| Risco | usar o **mesmo** database do `screen-app` desfaz o ADR 0015 |
| Evidência | nome do database novo e do usuário (sem senha) |

O CMS **recusa subir** se `PAYLOAD_DATABASE_URL` for igual a `DATABASE_URL` ou
tiver cara do banco público — a proteção é de código (`apps/cms/src/env.ts`),
não de convenção.

## D. Decidir: database separado ou serviço PostgreSQL novo

| Opção | A favor | Contra |
|---|---|---|
| Database lógico no `screen-db` | sem custo novo, backup já existe | compartilha CPU/IO e janela de manutenção com o site |
| Serviço PostgreSQL novo | isolamento real de carga e de falha | mais um serviço para operar e fazer backup |

Ambas satisfazem o ADR 0015. A decisão é operacional, não arquitetural — **mas
precisa ser registrada**, porque muda o procedimento de backup.

## E. Storage persistente do CMS (uploads originais)

Duas opções, e a escolha muda as variáveis:

- **Volume** montado no container → `PAYLOAD_UPLOAD_STORAGE_DRIVER=local`,
  `PAYLOAD_UPLOAD_LOCAL_ROOT=<caminho absoluto>` e
  `PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED=true`.
- **Bucket S3-compatible** (R2/MinIO) → `PAYLOAD_UPLOAD_STORAGE_DRIVER=s3` e o
  bloco `PAYLOAD_UPLOAD_S3_*`.

> Sem a confirmação explícita de persistência, o CMS **não sobe** em produção.
> Isso é deliberado: o filesystem do container é efêmero, e a falha silenciosa
> seria a redação subir a foto, vê-la no painel e perdê-la no próximo deploy —
> com o documento no banco ainda apontando para o arquivo.

**Evidência:** `pnpm --filter @screena/cms cms:preflight` reporta
`storage de upload — driver X; persistencia declarada: true`.

## F. Storage público editorial (cópia servida pelo site)

Bucket/prefixo **separado** do anterior. Compartilhar bucket é aceitável;
compartilhar **prefixo** não — o worker apagaria original achando que era
derivada. O preflight do worker checa essa colisão.

Variáveis: `EDITORIAL_MEDIA_*`.

> **Os DOIS lados precisam dessas variáveis.** O worker **escreve** no bucket; o
> screen-app **lê** dele, pela rota `/media/editorial/**`, para servir o
> `public_path` gravado no banco. Configurar só o worker publica a matéria com a
> imagem em 404 — o sintoma é exatamente esse, e não aparece em nenhum log.
>
> A credencial do screen-app deve ser **somente-leitura**: o site nunca escreve
> nem apaga mídia. Tabela completa em
> [`easypanel-deployment-checkpoint.md` §12.1](../operations/easypanel-deployment-checkpoint.md).

## G–J. Criar o serviço do CMS

| Campo | Valor |
|---|---|
| Nome | a definir (sugestão `cinerie-cms`) |
| Repositório | este |
| Dockerfile | `Dockerfile.cms` |
| Porta | `3002` |
| Healthcheck | `GET /healthz` (liveness) |
| Readiness | `GET /readyz` |
| Env | `apps/cms/.env.production.example` |

**Use `/healthz` como healthcheck do container, não `/readyz`.** O primeiro não
toca banco; se o healthcheck dependesse do PostgreSQL, uma queda do banco faria
o orquestrador reiniciar em loop um container saudável — e reiniciar não devolve
o banco. `/readyz` é para tirar do balanceador.

## K. Migration do CMS

O `CMD` do `Dockerfile.cms` roda `payload migrate` **antes** do start e aborta o
boot se falhar. Não é preciso pré-deploy hook — e o runbook não assume que o
EasyPanel oferece um.

Conferir depois: `pnpm --filter @screena/cms cms:migrations:status`.

> **Ordem que não pode inverter:** a migration **pública** (Prisma, fases 2C e
> 2D) precisa estar aplicada no `screen-db` **antes** do worker subir. O worker
> nunca a aplica; ele apenas recusa readiness enquanto o schema estiver atrasado,
> nomeando exatamente o objeto que falta.

## L. Criar o administrador inicial

| | |
|---|---|
| Sistema | painel do CMS, `/admin` |
| Obter | e-mail e senha do primeiro administrador |
| Não expor | a senha, em nenhum canal |
| Risco | painel sem admin fica inacessível; admin com senha fraca é porta aberta |
| Desfazer | criar outro admin e desativar o primeiro (nunca apagar o único) |

**Manual, sempre.** Nenhum script deste repositório cria usuário — `seed:dev`
cria apenas o autor institucional.

## M. Criar as service accounts

Duas contas, **escopos disjuntos**:

| Conta | Escopo | Usada por | Pode publicar? |
|---|---|---|---|
| ingestão | `draft_ingest` | MNScr | **não** |
| projeção | `publication_projection` | worker | **não** |
| autopublicação | `editorial_auto_publish` | MNScr | **sim** |

Nunca dê dois desses escopos à mesma conta. Um booleano genérico de "automação"
daria ao MNScr o direito de drenar a fila de publicação e ao worker o direito de
criar rascunho.

`editorial_auto_publish` é o **único** que publica, e o CMS trata quem o tem como
um ator diferente (`automation_publisher`, ver
[ADR 0017](../adr/0017-automation-publisher-actor.md)). Uma conta com
`draft_ingest` continua confinada a `automation_draft` — não existe caminho pelo
qual ela alcance `published`.

Crie a conta de autopublicação **por último**, depois do canário: enquanto ela
não existir, o MNScr não consegue publicar nem por engano.

A API key aparece **uma vez** no painel. Copie direto para a variável do serviço.
Conta com lista de escopos **vazia** autentica e não pode nada — é assim que se
revoga acesso sem apagar a conta.

## N. Criar o serviço do worker

| Campo | Valor |
|---|---|
| Nome | a definir (sugestão `cinerie-publication-worker`) |
| Dockerfile | `Dockerfile.publication-worker` |
| Porta | `3003` (somente health) |
| Healthcheck | `GET /healthz` |
| Readiness | `GET /readyz` |
| Env | `services/news-ingestion/.env.production.example` |
| Réplicas | **1** |

> Mais de uma réplica funciona (o claim é compare-and-swap por linha), mas cada
> uma precisa de `PROJECTION_WORKER_ID` **diferente** — o id identifica o dono da
> lease. Duas réplicas com o mesmo id se confundem no `ack`.

Antes de habilitar: `pnpm --filter @screena/news-ingestion publication-worker:preflight`.

## O. Canário

1. Criar uma matéria de teste no CMS, com capa aprovada.
2. Publicar.
3. Conferir que a outbox registrou **um** evento.
4. Conferir que o worker projetou (`editorial_projection_receipts`).
5. Conferir que `articles.hero_image_path` é caminho de site, **nunca** URL.
6. Conferir que o arquivo existe no storage público.
7. Abrir a matéria no site.
8. Despublicar e conferir que ela sai do índice **sem** perder o texto.

## P. Habilitar produção

Só depois do canário verde. **Só então** integrar o MNScr — ele é o produtor de
rascunhos, e ligá-lo antes encheria a fila com conteúdo que ninguém validou
ponta a ponta.

## Q. Habilitar a autopublicação (último passo)

A automação nasce **desligada**. Variável ausente não autoriza publicação: em
`production`, `EDITORIAL_AUTO_PUBLISH_ENABLED` precisa dizer `true`
explicitamente. Um default ligado faria um deploy com env incompleta começar a
publicar sozinho, e ninguém descobriria pela ausência de erro.

| Variável | Obrigatória em produção | O que acontece se faltar |
|---|---|---|
| `EDITORIAL_AUTO_PUBLISH_ENABLED` | — | fica **desligada** (fail-closed) |
| `EDITORIAL_AUTO_PUBLISH_TIME_ZONE` | **sim** | readiness bloqueada, endpoint responde 503 |
| `EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT` | não | teto conservador (50) |
| `EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT` | não | teto conservador (20) |
| `EDITORIAL_AUTO_PUBLISH_PER_SECTION_LIMIT` | não | teto conservador (30) |
| `EDITORIAL_AUTO_PUBLISH_PER_CONTENT_TYPE_LIMIT` | não | teto conservador (40) |
| `EDITORIAL_AUTO_PUBLISH_PER_ARTICLE_UPDATE_LIMIT` | não | teto conservador (5) |

O fuso é **IANA** (`America/Sao_Paulo`). Offset fixo (`-03:00`) e abreviação
(`BRT`) são recusados: os dois ignoram horário de verão e a conta erraria em
silêncio justamente no dia da virada. Sem fuso correto, a janela do dia é
calculada em UTC e o teto diário zera às 21h no horário da redação — o que não é
um teto.

Ordem sugerida:

1. Definir as variáveis com `ENABLED=false` e conferir `/readyz`.
2. Autorizar **um** autor (`automationPublishingAllowed`, tipos, seções, modo de
   assinatura) e dar a ele um `automationDailyLimit` baixo. O teto efetivo é o
   **menor** entre o dele e o da plataforma.
3. Ligar `ENABLED=true` com `DAILY_LIMIT` pequeno (2 ou 3).
4. Acompanhar `autopublish_quota_usage` — ela diz **quem** consumiu e **por quê**.
5. Subir o teto só depois de conferir as primeiras matérias no site.

Detalhes de operação, diagnóstico e o que fazer quando um número parece errado:
[`docs/operations/editorial-auto-publication-quota.md`](../operations/editorial-auto-publication-quota.md).

---

## Verificação rápida

```bash
pnpm --filter @screena/cms cms:preflight
pnpm --filter @screena/news-ingestion publication-worker:preflight
```

Cada item sai como `OK`, `WARNING` ou `BLOCKED`. Nenhum dos dois altera banco,
cria documento ou consome evento — o `claim` usado para provar a credencial pede
lote **zero**.

## O que este runbook NÃO faz

Não cria projeto, serviço, banco, bucket, volume, domínio, DNS, credencial ou
usuário. Todos esses passos são manuais e do operador.
