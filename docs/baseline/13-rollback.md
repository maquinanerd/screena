# 13 — Procedimento de rollback

> Esta etapa (00 — baseline) **não altera código de produção nem persistência**: entrega apenas
> documentação em `docs/baseline/`. O rollback da etapa é trivial. O que este documento também
> registra — porque o baseline exige — é o **estado real da capacidade de rollback do sistema**,
> que é mais frágil do que o rollback desta PR.

---

## 1. Rollback desta etapa (baseline 00)

A PR desta etapa adiciona **somente arquivos novos** sob `docs/baseline/`. Não há migration, não há
mudança de schema, não há alteração de runtime, não há alteração de dependência.

```bash
# opção A — reverter o merge commit
git revert -m 1 <sha-do-merge>

# opção B — remover o diretório (equivalente, pois só há arquivos novos)
git rm -r docs/baseline && git commit -m "revert(docs): remove baseline 00"
```

Risco de rollback: **nulo**. Nenhum comportamento de aplicação depende destes arquivos.
Verificação pós-rollback: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` continuam verdes
(nenhum deles lê `docs/`).

---

## 2. Rollback do sistema — estado real (achado do baseline)

### 2.1 Como o deploy aplica migrations

O contêiner aplica as migrations **no boot**, e falha ruidosamente se não conseguir:

```dockerfile
CMD ["sh", "-c", "pnpm --filter @screena/db db:migrate:deploy || { \
  echo '=== FATAL: prisma migrate deploy falhou. O app NAO vai subir. ==='; \
  ...; exit 1; }; exec pnpm --filter @screena/web start"]
```
`Dockerfile:69`

Isso é bom (sem fallback silencioso — o app não sobe com banco inconsistente), mas tem uma
consequência decisiva para rollback:

> ⚠️ **Reverter a imagem da aplicação NÃO reverte o banco.**
> As migrations do Prisma são *forward-only*: não existe `down migration` neste repositório.
> Ao voltar para a imagem anterior, o schema do banco continua na versão nova.

Confirmação: nenhuma das 12 migrations possui script de reversão.

```bash
ls packages/db/prisma/migrations/*/ | grep -i "down\|rollback"
# (nenhum resultado)
```

### 2.2 O que existe de fato para recuperação

| Recurso | Estado | Evidência |
| --- | --- | --- |
| `pg_dump -Fc` com checksum SHA-256 | script pronto | `scripts/backup/backup.sh` |
| Teste de restore em base efêmera | script pronto | `scripts/backup/restore-test.sh` |
| Cópia off-site via `rclone` | opcional, por env | `scripts/backup/README.md:34` |
| Validação de sintaxe dos scripts na CI | ✅ ativa | `.github/workflows/ci.yml:33-37` (`bash -n`) |
| **Execução real de um backup** | ❌ **nunca verificada neste baseline** | — |
| **Restore real validado** | ❌ **nunca verificado neste baseline** | — |
| `HEALTHCHECK` no contêiner | ❌ ausente | `Dockerfile` não declara `HEALTHCHECK` |

O próprio repositório reconhece a regra operacional:

> "**Sem backup validado, sem sync/promote em produção.**" — `scripts/backup/README.md:13`

A CI valida apenas que os scripts são **sintaticamente** válidos (`bash -n`), o que **não** prova
que um dump/restore funciona. Risco **R-02** (P0) em [`08-riscos.md`](08-riscos.md).

### 2.3 Procedimento de rollback de produção (documentado)

O runbook canônico é `docs/runbooks/PRODUCTION_DEPLOY.md`, referenciado pela própria mensagem de
falha do contêiner (`Dockerfile:69`).

Sequência segura para reverter um deploy que incluiu migration:

```bash
# 1. ANTES de qualquer deploy com migration — backup verificado
export DATABASE_URL="postgresql://..."
export BACKUP_DIR=/home/screen/backups/postgres
scripts/backup/backup.sh
scripts/backup/restore-test.sh          # precisa ficar VERDE

# 2. Deploy (as migrations rodam no boot do contêiner)

# 3. Rollback, se necessário:
#    3a. voltar a imagem da aplicação para a tag anterior
#    3b. restaurar o banco a partir do dump do passo 1
pg_restore --clean --if-exists -d "$DATABASE_URL" <dump-do-passo-1>
```

> ⚠️ O passo 3b é **obrigatório** sempre que a versão revertida for incompatível com o schema novo.
> Sem ele, a aplicação antiga roda contra um schema à frente — comportamento indefinido.

### 2.4 Mitigação imediata disponível sem rollback

Antes de reverter, existe um **kill switch de indexação** que remove o site do índice sem tocar em
banco nem em imagem:

```bash
CINERIE_PUBLIC_INDEXING_ENABLED=false   # ou qualquer valor != true/1
```

O parser é fail-closed (`apps/web/src/lib/site.ts:81-86`): qualquer valor inválido, vazio ou ausente
**desliga** a indexação. Com ele desligado, `robots.txt` passa a emitir `Disallow: /` — comprovado
no smoke test desta auditoria (`11-validacao-execucoes.md` §5, check 16).

Isso permite conter dano de SEO em segundos, enquanto o rollback real é preparado com calma.

---

## 3. Checklist de rollback

- [x] Rollback desta PR é `git revert` puro, sem efeito colateral.
- [x] `prisma migrate deploy` provado **idempotente** (smoke check 3) — reaplicar é seguro.
- [x] Kill switch de indexação provado fail-closed (smoke check 16).
- [ ] ❌ Backup real nunca executado/validado neste ambiente — **bloqueante para operar produção**.
- [ ] ❌ Não existe down-migration; rollback de schema depende inteiramente de restore de dump.
- [ ] ❌ Contêiner sem `HEALTHCHECK` — orquestrador não detecta app degradado automaticamente.
