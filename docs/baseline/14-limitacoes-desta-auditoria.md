# 14 — Limitações desta auditoria

> Um baseline que não declara os próprios limites é pior que nenhum baseline, porque induz
> confiança onde não há medição. Este documento existe para que ninguém use este material
> além do que ele suporta.

---

## 1. A verificação adversarial NÃO foi executada

O levantamento foi feito em duas etapas planejadas:

1. **Inventário** — 17 agentes de leitura, um por subsistema, cada um obrigado a citar
   `arquivo:linha` para toda afirmação.
2. **Verificação adversarial** — 17 agentes independentes, encarregados de **refutar** as
   afirmações da etapa 1, abrindo cada citação e checando a linha.

**A etapa 2 falhou integralmente**: os 17 agentes de verificação abortaram com
`You've hit your session limit`. Também abortou o inventário da área `docs-adr-divergence`.

Resultado: **16 de 17 inventários concluídos, 0 verificações adversariais concluídas**
(35 agentes no total: 17 concluídos, 18 com erro).

### 1.1 Como isso foi compensado

O autor do baseline **verificou pessoalmente** — abrindo arquivo e/ou executando comando — todos os
achados classificados como P0 e a maioria dos P1. São os itens marcados ✅ **direta** em
[`08-riscos.md`](08-riscos.md): **27 dos 40 riscos**.

Os **13 riscos restantes** estão marcados ⚠️ **não verificado** e devem ser tratados como
*leads investigativos*, não como fatos. Eles são plausíveis e vêm com citação, mas nenhum
segundo par de olhos os confrontou.

> **Regra de uso:** nenhum item ⚠️ deve virar decisão de engenharia, ticket de correção ou
> afirmação para terceiros sem confirmação direta primeiro.

### 1.2 Como completar a verificação

O script do workflow está persistido e é retomável — os agentes já concluídos voltam do cache,
só os que falharam re-executam:

```
Workflow({
  scriptPath: "…/workflows/scripts/baseline-00-inventory-wf_9bc8e045-65f.js",
  resumeFromRunId: "wf_9bc8e045-65f"
})
```

---

## 2. O que não foi medido (e por quê)

| Não medido | Motivo |
| --- | --- |
| **Contagem de catálogo em produção** | Nenhum banco de produção foi acessado. Não é escopo da etapa 00 tocar produção. Comandos para medir: [`10-catalogo-contagens.md`](10-catalogo-contagens.md) §3. |
| **Integração real com TMDB / RapidAPI / Brevo / Gemini** | Exigiria credencial real e consumo de cota. A etapa 00 não ativa feature nem gasta cota externa. O que está provado é o **contrato** e o **isolamento**, não a integração viva. |
| **Comportamento sob Node 22** | O ambiente disponível tem Node v24.14.0. Todos os comandos passaram, mas com aviso `Unsupported engine`. CI e imagem Docker usam Node 22. |
| **Teste E2E de navegador** | Não existe framework E2E no repositório. O smoke test é HTTP real contra o build de produção — não cobre JavaScript de cliente. |
| **Backup/restore real** | Exigiria um banco com dado real. Só a sintaxe dos scripts foi validada (o que a CI também faz). |
| **`apps/admin` em execução** | O smoke test cobriu apenas `apps/web`. O admin não foi levantado nem exercitado por HTTP. |
| **Auditoria de dependências de terceiros (CVE)** | `pnpm audit` não foi executado; não é parte do escopo declarado da etapa. |
| **Performance / carga** | Nenhuma medição de latência, throughput ou consumo de memória. |

---

## 3. Vieses conhecidos deste levantamento

1. **Ambiente Windows.** Vários validadores emitiram `EBUSY`/`EPERM` ao limpar diretórios
   temporários — comportamento específico de Windows que não aparece no Linux da CI. Isso não
   afetou nenhum resultado, mas significa que este baseline exercitou um caminho de SO diferente
   do de produção.
2. **Um único ponto no tempo.** Tudo foi medido em `73c58e9`, 2026-07-23. O repositório tem
   histórico de evoluir vários PRs por dia; o baseline envelhece rápido.
3. **`origin/main`, não o branch de trabalho.** Os 7 commits exclusivos de
   `feat/data-governance-hardening` e o WIP não-commitado do checkout primário **não** foram
   auditados — só inventariados como divergência (`00-estado-e-reproducao.md` §1.2).
4. **Leitura estática predomina.** Exceto pelas 4.028 asserções executadas, a maior parte das
   afirmações vem de leitura de código, não de observação de comportamento em execução.

---

## 4. O que este baseline sustenta com confiança alta

Apesar do acima, estes pontos foram medidos por execução real e são reprodutíveis:

- A bateria completa de validação passa: **4.028 asserções verdes**
  (3.375 unitárias + 636 em PostgreSQL 16 real + 17 de smoke).
- As migrations aplicam em **banco vazio** e **sobre estado anterior**, e `migrate deploy` é
  **idempotente**.
- O **build de produção sobe e serve** todas as rotas públicas com banco vazio.
- O **kill switch de indexação é fail-closed**, comprovado por HTTP real.
- As **invariantes 3 e 4 são estruturais**: `apps/web` não consegue resolver nenhum api-client
  externo nem o adapter Gemini — falha em tempo de resolução de módulo, não em revisão.
- O inventário de **75 modelos, 42 enums, 12 migrations, 27 rotas, 282 arquivos de teste e
  125.039 linhas** é contagem direta, não estimativa.
