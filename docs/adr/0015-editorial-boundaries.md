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

```
RSS Prime (externo)
  → MNScr (externo)
     → draft editorial estruturado
        → Payload  ── sala de redação: drafts, versões, workflow,
        │                autores, mídia candidata, fontes, RBAC, auditoria
        → revisão humana
           → publicação
              → publication event
                 → mecanismo governado de projeção
                    → services/news-ingestion   ── identidade, dedup, lifecycle,
                    │                              slug, persistência, projeção
                    → screen-db  ── projeção PÚBLICA
                       → screen-app  ── render (lê só PostgreSQL/cache local)
```

### Regras de fronteira (invioláveis)

1. **A Cinerie não consome diretamente o contrato bruto do RSS Prime.** O consumidor do RSS Prime é o
   MNScr. Este repositório **não** congela `RSS Prime → UpsertSourceItemInput`.
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

- `editorial-draft-v1` — **MNScr → Payload**. A forma do draft editorial estruturado que a redação aceita.
- `publication-event-v1` — **Payload → projeção pública**. O que uma publicação, correção, despublicação
  ou retratação comunica ao lado público.

**Não define:**

- `RSS Prime → MNScr`. Esse contrato pertence ao repositório/chat do RSS Prime.

Nenhum dos dois contratos acima está congelado nesta fase. Ambos são pré-requisito da fundação do
Payload e vêm **antes** de qualquer migration editorial no `screen-db`.

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
- A ordem de trabalho decorrente: **primeiro** o contrato arquitetural da fundação Payload e da
  projeção pública; **depois** a migration aditiva do `screen-db` (autor, taxonomia, mídia, blocos).
  Criar essas tabelas antes do contrato produziria duplicação de responsabilidade entre CMS e
  projeção.
