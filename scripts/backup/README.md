# scripts/backup — Backups automaticos do PostgreSQL

Scripts operacionais para backup logico e teste de restore do PostgreSQL do
Cinerie. Eles rodam fora do caminho de render, com credenciais vindas de env vars.

## Scripts

| Script | Responsabilidade |
| --- | --- |
| `backup.sh` | Roda `pg_dump -Fc`, grava dump com timestamp UTC, gera checksum SHA-256 e opcionalmente copia off-site via `rclone`. |
| `restore-test.sh` | Restaura um dump (o ultimo, ou o caminho passado como argumento) em base efemera, **compara** o restaurado com o que o dump declara (tabelas, linhas por tabela, indices, constraints) e derruba a base. Divergiu, sai != 0. |
| `restore-test-selftest.sh` | **Controle negativo** do anterior: roda o `restore-test.sh` uma vez limpo e quatro vezes com uma divergencia injetada, e exige que ele reprove nas quatro. |
| `verify-backup-restore.sh` | Prova de ponta a ponta na CI: `backup.sh` + `restore-test.sh` + um restore proprio comparado por **hash de conteudo** contra a origem viva. |
| `lib/dump-manifest.awk` | Parser que extrai do dump o manifesto esperado (CREATE TABLE / blocos COPY / CREATE INDEX / ADD CONSTRAINT). Usado pelo `restore-test.sh`. |

> **Aviso: sem backup validado, sem sync/promote em producao.** Nenhuma carga
> TMDB (`sync`, `promote`, `seed`) roda em producao antes de um `backup.sh`
> real seguido de um `restore-test.sh` verde. Perder o banco significa perder
> catalogo promovido, `content_blocks`, `slugs`, `translations` e todo o dado
> editorial — nada disso e recuperavel a partir do TMDB.

Ferramentas esperadas no servidor: `pg_dump`, `pg_restore`, `psql` e
`sha256sum` ou `shasum`. Para copia off-site, instale/configure `rclone`.

O `restore-test.sh` exige **PostgreSQL 13+** no servidor administrativo: ele usa
`DROP DATABASE ... WITH (FORCE)`, sintaxe que nao existe em versoes anteriores.
Em PG 12 o script aborta antes de criar qualquer base — falha barulhenta, nunca
verde-falso.

## Variaveis

| Variavel | Obrigatoria? | Descricao |
| --- | --- | --- |
| `DATABASE_URL` | Sim, para backup | Connection string da base origem. Nunca versionar. |
| `BACKUP_DIR` | Nao | Diretorio dos dumps (default: `./backups/postgres`). Em producao, use volume persistente fora do repo. |
| `BACKUP_PREFIX` | Nao | Prefixo do arquivo (default: `screen-postgres`). |
| `BACKUP_OFFSITE_RCLONE_REMOTE` | Nao | Destino `rclone` para copia off-site, ex.: `s3:screen-backups/postgres`. |
| `RESTORE_TEST_ADMIN_URL` | Sim, para restore-test | Connection string administrativa para criar/dropar a base efemera. |
| `RESTORE_TEST_DB_NAME` | Nao | Nome da base efemera. Default inclui timestamp. |
| `RESTORE_TEST_DATABASE_URL` | Nao | URL alvo explicita; por default deriva de `RESTORE_TEST_ADMIN_URL` + `RESTORE_TEST_DB_NAME`. |
| `RESTORE_TEST_INJECT_DIVERGENCE` | Nao | **So para controle negativo.** `none` (default), `row`, `table`, `index` ou `constraint`: estraga a base efemera de proposito depois do restore, para provar que a comparacao reprova. Nunca use em rotina — o desfecho esperado e vermelho. |
| `RESTORE_TEST_KEEP_MANIFEST` | Nao | `1` preserva o diretorio temporario com os manifestos esperado/real, para diagnosticar uma divergencia. Default: apaga. |

## Backup diario

```bash
export DATABASE_URL="postgresql://..."
export BACKUP_DIR="/home/screen/backups/postgres"
export BACKUP_OFFSITE_RCLONE_REMOTE="s3:screen-backups/postgres" # opcional
scripts/backup/backup.sh
```

O script gera:

```text
/home/screen/backups/postgres/
  screen-postgres-YYYYMMDDTHHMMSSZ.dump
  screen-postgres-YYYYMMDDTHHMMSSZ.dump.sha256
```

## Cron diario

Exemplo em `/etc/cron.d/screen-postgres-backup`:

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
DATABASE_URL=postgresql://user:password@localhost:5432/screen
BACKUP_DIR=/home/screen/backups/postgres
BACKUP_OFFSITE_RCLONE_REMOTE=s3:screen-backups/postgres

30 3 * * * screen cd /home/screen/app/current && scripts/backup/backup.sh >> /home/screen/backups/postgres/backup.log 2>&1
```

Em vez de colocar `DATABASE_URL` direto no cron, prefira carregar um env file com
permissao `0600` quando o ambiente suportar.

## Teste de restore

```bash
export BACKUP_DIR="/home/screen/backups/postgres"
export RESTORE_TEST_ADMIN_URL="postgresql://user:password@localhost:5432/postgres"

# Usa o dump mais recente de BACKUP_DIR:
scripts/backup/restore-test.sh

# Ou valida um dump especifico:
scripts/backup/restore-test.sh /home/screen/backups/postgres/screen-postgres-20260709T031500Z.dump
```

O teste:

1. Localiza o ultimo `*.dump` (ou usa o caminho passado como argumento).
2. Valida o `.sha256`.
3. **Deriva do proprio dump o manifesto esperado**, antes de restaurar: le
   `pg_restore --file=-` e extrai o conjunto de tabelas (`CREATE TABLE`), a
   contagem de linhas por tabela (blocos `COPY`), os indices (`CREATE INDEX`) e
   as constraints PK/FK/UNIQUE/EXCLUDE (`ADD CONSTRAINT`). Dump que nao declara
   nenhuma tabela e recusado na hora — arquivo vazio nao pode "casar" com uma
   base vazia.
4. Cria uma base efemera (nome sempre prefixado por `screen_restore_test_`).
5. Restaura com `pg_restore --exit-on-error`.
6. **Compara** o manifesto do dump com o que o banco restaurado realmente tem
   (`pg_class`, `pg_index`, `pg_constraint` e `count(*)` por tabela). Qualquer
   divergencia imprime o objeto e os DOIS numeros e o script **sai != 0**:

   ```text
   restore-test: [FALHA] linhas divergem em public.movies — dump=2500 restaurado=2499
   restore-test: [FALHA] tabela ausente no restaurado: public.api_cache (declarado no dump)
   restore-test: DIVERGENCIA — 1 tabela(s), 1 contagem(ns) de linhas, 2 indice(s), 2 constraint(s), 0 assertiva(s) de aplicacao.
   ```

7. Confere as assertivas de aplicacao: `_prisma_migrations` precisa existir e ter
   pelo menos uma migration; `content_blocks` e contada **somente se a tabela
   existir** (um dump anterior a essa migration continua sendo um restore valido).
8. Derruba a base efemera no `trap` de saida, mesmo em caso de erro.

**Pre-condicao do modo por argumento:** o dump informado precisa ter o `.sha256`
irmao no mesmo diretorio. Sem ele o teste falha de proposito — um dump que nao da
para verificar nao pode produzir um "verde". Ao baixar um dump do off-site, baixe
os dois arquivos.

**O que o exit 0 prova e o que nao prova.** Prova que o banco restaurado reproduz
o dump objeto por objeto e linha por linha. **Nao** prova que o dump reproduz a
origem no momento em que foi tirado — para isso existe o
`verify-backup-restore.sh`, que compara hash de conteudo contra a base viva e
roda na CI. E continua valendo ler os numeros: `content_blocks=0` com exit 0
significa que o dump nao tinha bloco editorial nenhum, nao que o teste falhou.

**Custo:** o dump e lido duas vezes (uma para o manifesto, uma para o restore).
E o preco de ter um "esperado" que nao vem do banco que acabou de ser escrito.

### Controle negativo (o teste sabe ficar vermelho?)

Um teste de restore que nunca reprova nao e prova de restore. O
`restore-test-selftest.sh` verifica isso mecanicamente: roda o `restore-test.sh`
contra o mesmo dump uma vez limpo (precisa sair 0) e quatro vezes com uma
divergencia injetada **na base efemera restaurada** — uma linha apagada, uma
tabela dropada, um indice dropado e uma FK dropada —, exigindo exit != 0 **e** o
diagnostico correspondente em cada caso.

```bash
export RESTORE_TEST_ADMIN_URL="postgresql://user:senha@localhost:5432/postgres"
export DATABASE_URL="postgresql://..."     # so para gerar o dump de trabalho
scripts/backup/restore-test-selftest.sh
```

Para reproduzir um caso isolado, o `restore-test.sh` aceita a injecao direta —
lembrando que **o desfecho esperado e vermelho**:

```bash
RESTORE_TEST_INJECT_DIVERGENCE=table scripts/backup/restore-test.sh   # sai != 0
```

A injecao so alcanca a base efemera (o nome dela e travado pelo regex
`^screen_restore_test_[A-Za-z0-9_]+$`) e nunca a origem. Este controle roda na CI
no job **Backup + restore real (fidelidade de dados, PostgreSQL 16)**.

O script nunca escreve na base de origem: ele so toca `RESTORE_TEST_ADMIN_URL` e a
base efemera, e recusa qualquer `RESTORE_TEST_DB_NAME` fora do prefixo
`screen_restore_test_`.

## Restore real

1. Escolha o dump e valide o checksum:

   ```bash
   cd /home/screen/backups/postgres
   sha256sum -c screen-postgres-YYYYMMDDTHHMMSSZ.dump.sha256
   ```

2. Restaure primeiro em base isolada, nunca direto em producao:

   ```bash
   createdb screen_restore_check
   pg_restore --no-owner --no-acl --exit-on-error \
     --dbname="postgresql://user:password@localhost:5432/screen_restore_check" \
     screen-postgres-YYYYMMDDTHHMMSSZ.dump
   psql "postgresql://user:password@localhost:5432/screen_restore_check" \
     --command='SELECT count(*) FROM content_blocks;'
   ```

3. Somente depois de validar contagens e integridade, planeje promocao/restore de
   producao com revisao humana.

## Copia off-site

Um dump que vive so no mesmo VPS do banco nao e backup: some junto com o
servidor. Configure `rclone` uma vez e exporte o remote — o `backup.sh` replica
dump e checksum automaticamente:

```bash
rclone config                       # cria o remote, ex.: "s3"
export BACKUP_OFFSITE_RCLONE_REMOTE="s3:screen-backups/postgres"
scripts/backup/backup.sh
```

Sem `BACKUP_OFFSITE_RCLONE_REMOTE`, o script avisa em `stderr` que a copia
off-site foi pulada e segue gerando o dump local. Guarde o remote em env file
`0600`, nunca no repositorio.

## Checklist antes de carga TMDB

Rode em ordem, no servidor, antes de qualquer `sync`, `promote` ou `seed` em
producao. Se algum item falhar, **pare**: nao ha carga sem backup validado.

- [ ] `pg_dump`, `pg_restore`, `psql` e `sha256sum` presentes no host.
- [ ] `DATABASE_URL` aponta para a base de **producao** correta.
- [ ] `BACKUP_DIR` e um volume **persistente fora do repositorio**.
- [ ] `scripts/backup/backup.sh` rodou e terminou com exit 0.
- [ ] O `.dump` e o `.sha256` existem e o dump tem tamanho plausivel (nao 0 byte).
- [ ] `scripts/backup/restore-test.sh` rodou verde — ou seja, tabelas, contagem
      de linhas, indices e constraints do restaurado batem com o que o dump
      declara. Confira ainda assim se `content_blocks` bate com o esperado da
      origem: exit 0 diz que o dump foi reproduzido fielmente, nao que o dump
      levou o dado editorial que voce esperava.
- [ ] A base efemera do teste foi derrubada (nenhum `screen_restore_test_*` sobrou).
- [ ] Copia off-site confirmada no destino remoto.
- [ ] Cron diario ativo e com log endereçado a arquivo.

Backups contem dados sensiveis/licenciados: nunca commitar, nunca expor em
frontend e sempre replicar para armazenamento fora do VPS.
