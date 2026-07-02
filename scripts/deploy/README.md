# scripts/deploy — Deploy do Screen (VPS + CloudPanel)

> Esta pasta documenta os scripts de **deploy** que serao implementados em fases
> posteriores. Hoje ainda existe **apenas** este README descrevendo o contrato e
> o fluxo; o guia operacional publico fica em `docs/CLOUDPANEL_DEPLOY.md`.

## Contexto

- **Infra**: VPS gerenciada por **CloudPanel**.
- **App publico** (`@screena/web`, Next.js App Router): servido via **Node** sob
  **PM2** (alternativa documentada: `systemd`).
- **Workers Python** (ingestao, ratings, streaming, news, entity_writer): rodam
  fora do request, via **systemd timers** (ver `scripts/import/` e os workers).
- **Banco**: PostgreSQL no proprio VPS (ou instancia gerenciada), nunca acessado
  no caminho de render alem de leitura controlada.

## Principios

1. **Render puro**: o deploy nunca injeta chamada a API externa no caminho de
   render. O app publico le **somente PostgreSQL/cache local**.
2. **Segredos so em env vars**: nenhuma API key, secret ou token vai para o
   repositorio, para a imagem ou para o frontend. Variaveis ficam em arquivo de
   ambiente do servidor (fora do git) e sao lidas pelo processo Node/worker.
3. **Release folders + symlink atomico**: cada deploy cria uma pasta de release
   nova e troca o symlink `current` apenas quando o build esta pronto. Rollback =
   reapontar o symlink para a release anterior.
4. **pt-BR publica primeiro**: o deploy nao promove `en`/`es` para `index`; elas
   permanecem `draft/noindex` ate revisao humana.
5. **Zero git/instalacao automatica na Fase 0**: nada aqui executa por conta
   propria nesta fase.

## Layout de releases (alvo)

```
/home/screen/app/
  releases/
    2026-06-25T12-00-00Z-<git-sha>/   # build completo desta versao
    2026-06-24T18-30-00Z-<git-sha>/
  current -> releases/2026-06-25T12-00-00Z-<git-sha>   # symlink atomico
  shared/
    .env                # segredos e config do servidor (fora do git)
    logs/
    uploads/
```

## Fluxo de deploy (alvo)

1. **Pre-checks** (local/CI): `pnpm typecheck`, `pnpm lint`, `pnpm test`,
   `pnpm audit:invariants` (invariantes) e `pnpm audit:render` (pureza de render). Falhou,
   nao sobe.
2. **Build**: `pnpm install --frozen-lockfile` e `pnpm --filter @screena/web build`
   dentro de uma **nova pasta de release**.
3. **Linkar shared**: apontar `.env`, `logs/`, `uploads/` da release para
   `shared/` (segredos nunca copiados para dentro do release versionado).
4. **Migrations**: aplicar migrations de PostgreSQL de forma controlada (em fase
   futura; na Fase 0 nao existem migrations reais). Migrations destrutivas
   exigem revisao humana.
5. **Smoke test**: subir o processo na nova release em porta temporaria e validar
   health-check antes de promover.
6. **Switch atomico**: trocar o symlink `current` -> nova release.
7. **Reload**: `pm2 reload screena-web` (zero-downtime) ou
   `systemctl restart screena-web`.
8. **Pos-deploy**: revalidar paths ISR relevantes; checar logs; registrar a
   release.
9. **Rollback**: reapontar `current` para a release anterior e recarregar o
   processo. Sem rebuild.

## Scripts previstos (a implementar)

| Script | Responsabilidade |
| --- | --- |
| `release.sh` | Cria pasta de release, build, linka `shared/`, smoke test. |
| `switch.sh` | Troca atomica do symlink `current` + reload PM2/systemd. |
| `rollback.sh` | Reaponta `current` para a release anterior e recarrega. |
| `migrate.sh` | Aplica migrations PostgreSQL (futuro; revisao humana). |
| `healthcheck.sh` | Valida health-check HTTP antes de promover a release. |

## Variaveis de ambiente esperadas (no servidor, fora do git)

- `DATABASE_URL` — conexao PostgreSQL (somente leitura no render).
- `NODE_ENV=production`
- Chaves de provedores tecnicos (TMDB, RapidAPI, Gemini) — **usadas apenas por
  workers offline**, nunca pelo app de render.

> Ver `.env.example` na raiz para a lista canonica de variaveis. Nunca commitar o
> `.env` real.
