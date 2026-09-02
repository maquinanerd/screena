# Implantar o painel interno (`apps/admin`)

> A criação do serviço no painel e a exposição do domínio são do dono. Este
> documento prepara tudo o que vem antes e diz o que conferir depois.

---

## Por que isto existe

O `apps/admin` tem **11 rotas** — entre elas `review-queue` e
`content-blocks/[id]` — e **nunca foi construído por nada**: não havia
Dockerfile, não havia `build:admin`, não havia serviço. A auditoria de
2026-09-01 registrou isso como S-31.

A consequência não é cosmética: **`review-queue` é a única tela onde um humano
revisa `content_blocks`.** Sem ela implantada, o Entity Writer pode gerar, mas
nada sai de `needs_review` — e a invariante 12 proíbe que um agente publique.
Gerar sem ter onde revisar produz uma fila que ninguém pode drenar.

---

## O que já está pronto

| Peça | Estado |
| --- | --- |
| `Dockerfile.admin` | criado, no mesmo padrão dos outros quatro |
| `pnpm build:admin` | criado na raiz |
| Job de build em CI | criado (`Build do painel interno (admin)`) |
| Autenticação | **já existia** — ver abaixo |

### A autenticação já existe, e é fail-closed

`apps/admin/middleware.ts` põe HTTP Basic Auth na frente de **todas** as telas,
e a decisão vive num módulo puro testado (`src/lib/access-protection.ts`):

- **production-like** (`NODE_ENV=production` ou `VERCEL_ENV=production`) → a
  proteção é **sempre** exigida, mesmo sem `ADMIN_PROTECTION_ENABLED` ou com ela
  em `"false"`. O painel **nunca sobe aberto**.
- proteção exigida **sem usuário/senha em ENV** → **401**. Ele nega; não libera.
- Basic Auth ausente ou inválido → 401 + desafio.

O `ENV NODE_ENV=production` do Dockerfile não é só otimização: é o que coloca o
middleware nesse ramo. **Removê-lo abriria o painel.**

---

## Criar o serviço no painel

| Campo | Valor |
| --- | --- |
| Origem | GitHub `screena`, branch `main` |
| Build | `Dockerfile.admin` |
| Porta | `3006` |
| Comando | (nenhum — o `CMD` do Dockerfile) |
| Domínio | **interno**, ou domínio próprio com Basic Auth. Nunca em `cinerie.com` |

### Variáveis — o mínimo, e nada além

```
DATABASE_URL=<a mesma do screen-app>
ADMIN_BASIC_AUTH_USER=<escolher>
ADMIN_BASIC_AUTH_PASSWORD=<escolher, forte>
```

Opcional, e **desligada por padrão**:

```
ADMIN_EDITORIAL_ACTIONS_ENABLED=false
```

> **Não copie o env do `screen-app`.** Ele carrega 51 variáveis — Gemini, OMDb,
> TMDB×3, RapidAPI×4, Brevo, S3, R2 — e o admin não lê nenhuma delas. Cada
> credencial a mais num serviço é superfície que não compra nada.

### O que o admin NÃO recebe

Nenhuma credencial de fornecedor. Ele não fala com TMDB, OMDb, Gemini nem
RapidAPI, e não conhece o banco do Payload.

---

## Conferir depois de subir

**1. O portão está de pé** — 401 sem credencial:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<dominio-do-admin>/health
```

Esperado: **401**. Se vier 200, o painel subiu aberto — pare e confira
`NODE_ENV`.

**2. A credencial funciona:**

```bash
curl -sS -u '<user>:<senha>' -o /dev/null -w '%{http_code}\n' https://<dominio-do-admin>/health
```

Esperado: **200**.

**3. A fila de revisão responde:**

```bash
curl -sS -u '<user>:<senha>' -o /dev/null -w '%{http_code}\n' https://<dominio-do-admin>/review-queue
```

---

## Sobre o `HEALTHCHECK` aceitar 401

`/health` está atrás do Basic Auth, então o healthcheck do container aceita
**200 ou 401** como vivo. Um 401 prova que o processo subiu, roteou e aplicou o
portão — que é exatamente o que liveness precisa saber.

Aceitar só 200 exigiria embutir a credencial no `HEALTHCHECK`, ou seja, colocar
a senha na definição da imagem. A troca não vale.

---

## O que isto destrava

O tópico 10 do protocolo (primeira geração real do Entity Writer). A ordem é
obrigatória: **gerar sem ter onde revisar produz `content_blocks` presos em
`needs_review` para sempre**, porque nenhum agente pode promovê-los
(invariante 12).
