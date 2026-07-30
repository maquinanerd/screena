/**
 * deployment-readiness.test.ts — Prontidao de implantacao do CMS.
 *
 * O que estes testes existem para impedir: um container ser promovido a
 * "pronto" enquanto a migration nao foi aplicada, o storage nao responde ou a
 * configuracao esta incompleta. Nesses tres casos o CMS SOBE — ele so nao pode
 * atender —, e e exatamente por isso que readiness e liveness sao separadas.
 */

import { describe, expect, it } from 'vitest'

import {
  evaluateCmsReadiness,
  readinessHttpStatus,
  REQUIRED_CMS_COLLECTIONS,
  type CmsReadinessInput,
} from '../readiness.js'
import {
  describeUploadConfig,
  resolvePayloadUploadConfig,
} from '../upload-storage-config.js'
import { safeUploadName } from '../media-source.js'
import { evaluateAutoPublishReadiness } from '../env-auto-publish.js'

function facts(overrides: Partial<CmsReadinessInput> = {}): CmsReadinessInput {
  return {
    configValid: true,
    configErrors: [],
    databaseReachable: true,
    pendingMigrations: 0,
    storageReady: true,
    storageDriver: 's3',
    storagePersistent: true,
    collectionCount: REQUIRED_CMS_COLLECTIONS,
    isProduction: true,
    // Default: automacao DESLIGADA e readiness `ok`. E o estado do CMS manual,
    // e ele precisa ser o caso base — nao a excecao.
    autoPublish: { status: 'ok', detail: 'autopublicacao desabilitada' },
    ...overrides,
  }
}

describe('readiness do CMS', () => {
  it('CONTROLE POSITIVO: ambiente completo fica pronto', () => {
    // Sem ele, uma readiness que bloqueasse tudo passaria em todos os testes
    // negativos abaixo sem nunca deixar o servico atender.
    const report = evaluateCmsReadiness(facts())
    expect(report.ready).toBe(true)
    expect(readinessHttpStatus(report)).toBe(200)
  })

  it('MIGRATION PENDENTE bloqueia', () => {
    // Servir com schema antigo produz erro de coluna inexistente no meio de uma
    // edicao — pior do que nao atender.
    const report = evaluateCmsReadiness(facts({ pendingMigrations: 2 }))
    expect(report.ready).toBe(false)
    expect(readinessHttpStatus(report)).toBe(503)
    expect(report.checks.find((check) => check.name === 'migrations')?.detail).toContain('2')
  })

  it('estado DESCONHECIDO de migration bloqueia, nao presume', () => {
    expect(evaluateCmsReadiness(facts({ pendingMigrations: null })).ready).toBe(false)
  })

  it('banco inacessivel bloqueia', () => {
    expect(evaluateCmsReadiness(facts({ databaseReachable: false })).ready).toBe(false)
  })

  it('STORAGE indisponivel bloqueia', () => {
    const report = evaluateCmsReadiness(facts({ storageReady: false }))
    expect(report.ready).toBe(false)
    expect(report.checks.find((check) => check.name === 'upload_storage')?.status).toBe('blocked')
  })

  it('storage sem persistencia em producao AVISA sem derrubar', () => {
    // Ja e recusado na configuracao; aqui e sinal de alerta, nao bloqueio.
    const report = evaluateCmsReadiness(
      facts({ storageDriver: 'local', storagePersistent: false }),
    )
    expect(report.ready).toBe(true)
    expect(report.checks.find((check) => check.name === 'upload_storage')?.status).toBe('warning')
  })

  it('collections faltando bloqueia', () => {
    expect(evaluateCmsReadiness(facts({ collectionCount: 2 })).ready).toBe(false)
  })

  it('configuracao invalida bloqueia e NAO ecoa valor', () => {
    const report = evaluateCmsReadiness(
      facts({ configValid: false, configErrors: ['PAYLOAD_SECRET ausente'] }),
    )
    expect(report.ready).toBe(false)
    const detail = report.checks.find((check) => check.name === 'config')?.detail ?? ''
    expect(detail).toContain('PAYLOAD_SECRET')
    expect(detail).not.toContain('postgresql://')
  })
})

describe('storage de upload do Payload', () => {
  it('local funciona em desenvolvimento com caminho absoluto', () => {
    const result = resolvePayloadUploadConfig({
      PAYLOAD_UPLOAD_STORAGE_DRIVER: 'local',
      PAYLOAD_UPLOAD_LOCAL_ROOT: '/var/lib/cinerie/uploads',
    })
    expect(result.ok).toBe(true)
  })

  it('recusa caminho RELATIVO — ele resolve contra o cwd do processo', () => {
    // Foi assim que a FASE 2D perdeu arquivos entre a Local API e o servidor.
    const result = resolvePayloadUploadConfig({
      PAYLOAD_UPLOAD_STORAGE_DRIVER: 'local',
      PAYLOAD_UPLOAD_LOCAL_ROOT: 'media',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toContain('ABSOLUTO')
  })

  it('PRODUCTION exige confirmacao explicita de persistencia', () => {
    const semConfirmacao = resolvePayloadUploadConfig({
      NODE_ENV: 'production',
      PAYLOAD_UPLOAD_STORAGE_DRIVER: 'local',
      PAYLOAD_UPLOAD_LOCAL_ROOT: '/var/lib/cinerie/uploads',
    })
    expect(semConfirmacao.ok).toBe(false)

    const comConfirmacao = resolvePayloadUploadConfig({
      NODE_ENV: 'production',
      PAYLOAD_UPLOAD_STORAGE_DRIVER: 'local',
      PAYLOAD_UPLOAD_LOCAL_ROOT: '/var/lib/cinerie/uploads',
      PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED: 'true',
    })
    expect(comConfirmacao.ok).toBe(true)
  })

  it('PRODUCTION recusa raiz em diretorio EFEMERO conhecido', () => {
    // Apontar uploads de producao para /tmp e um erro silencioso que so aparece
    // semanas depois, quando alguem nota que as fotos antigas sumiram.
    for (const root of [
      '/tmp/uploads',
      // A raiz que o harness de integracao usava. Ficou aqui como regressao: se
      // alguem afrouxar a guarda para "fazer o teste passar", este caso cai.
      '/tmp/cinerie-cms-uploads-x',
      '/var/tmp/x',
      '/dev/shm/y',
      '/app/.next/cache',
    ]) {
      const result = resolvePayloadUploadConfig({
        NODE_ENV: 'production',
        PAYLOAD_UPLOAD_STORAGE_DRIVER: 'local',
        PAYLOAD_UPLOAD_LOCAL_ROOT: root,
        PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED: 'true',
      })
      expect(result.ok, root).toBe(false)
    }
  })

  it('PRODUCTION aceita raiz DURAVEL dentro da arvore do repositorio', () => {
    // Contrapartida do caso acima: a guarda recusa o efemero SEM recusar o
    // caminho duravel que o harness passou a usar (`apps/cms/media/...`). Os
    // dois formatos cobrem os runners reais — POSIX na CI, unidade nomeada no
    // Windows — sem fixar o caminho de nenhuma maquina.
    for (const root of [
      '/home/runner/work/screena/screena/apps/cms/media/integration-ab12cd',
      'D:\\repos\\screena\\apps\\cms\\media\\integration-ab12cd',
    ]) {
      const result = resolvePayloadUploadConfig({
        NODE_ENV: 'production',
        PAYLOAD_UPLOAD_STORAGE_DRIVER: 'local',
        PAYLOAD_UPLOAD_LOCAL_ROOT: root,
        PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED: 'true',
      })
      expect(result.ok, root).toBe(true)
    }
  })

  it('PRODUCTION recusa driver AUSENTE — nada de adivinhar', () => {
    expect(resolvePayloadUploadConfig({ NODE_ENV: 'production' }).ok).toBe(false)
  })

  it('s3 exige configuracao completa e nao ecoa credencial no erro', () => {
    const result = resolvePayloadUploadConfig({
      PAYLOAD_UPLOAD_STORAGE_DRIVER: 's3',
      PAYLOAD_UPLOAD_S3_ENDPOINT: 'https://exemplo.r2.cloudflarestorage.com',
      PAYLOAD_UPLOAD_S3_ACCESS_KEY_ID: 'chave-secreta-visivel',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    const text = result.errors.join(' | ')
    expect(text).toContain('PAYLOAD_UPLOAD_S3_BUCKET')
    expect(text).not.toContain('chave-secreta-visivel')
  })

  it('s3 usa prefixo PROPRIO do CMS por padrao', () => {
    // Compartilhar bucket com o storage publico e aceitavel; compartilhar
    // PREFIXO nao — o worker apagaria original achando que era derivada.
    const result = resolvePayloadUploadConfig({
      PAYLOAD_UPLOAD_STORAGE_DRIVER: 's3',
      PAYLOAD_UPLOAD_S3_ENDPOINT: 'https://exemplo.r2.cloudflarestorage.com',
      PAYLOAD_UPLOAD_S3_BUCKET: 'cinerie',
      PAYLOAD_UPLOAD_S3_ACCESS_KEY_ID: 'k',
      PAYLOAD_UPLOAD_S3_SECRET_ACCESS_KEY: 's',
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.config.driver !== 's3') return
    expect(result.config.prefix).toBe('cms-uploads')
    expect(describeUploadConfig(result.config)).toEqual({ driver: 's3', persistent: true })
  })

  it('o resumo para health NUNCA carrega caminho, bucket ou credencial', () => {
    const result = resolvePayloadUploadConfig({
      PAYLOAD_UPLOAD_STORAGE_DRIVER: 'local',
      PAYLOAD_UPLOAD_LOCAL_ROOT: '/var/lib/cinerie/uploads-secretos',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(describeUploadConfig(result.config))).not.toContain('uploads-secretos')
  })
})

describe('nome de arquivo de upload', () => {
  it('descarta qualquer componente de caminho', () => {
    // O nome vem de quem envia o arquivo: concatena-lo cru a um diretorio e a
    // receita classica de path traversal.
    expect(safeUploadName('../../etc/passwd')).toBe('passwd')
    expect(safeUploadName('/absoluto/foto.jpg')).toBe('foto.jpg')
    expect(safeUploadName('  capa.png  ')).toBe('capa.png')
  })

  it('recusa nomes que nao designam arquivo', () => {
    expect(safeUploadName('')).toBeNull()
    expect(safeUploadName('.')).toBeNull()
    expect(safeUploadName('..')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Autopublicacao na readiness                                         */
/* ------------------------------------------------------------------ */

describe('evaluateAutoPublishReadiness', () => {
  // Este bloco existe porque a documentacao (runbook e doc de quota) prometia
  // que fuso invalido "bloqueia readiness" enquanto NENHUM check consultava a
  // configuracao. Promessa em documento que o codigo nao cumpre e pior que
  // ausencia de promessa: o operador confia nela.

  it('automacao DESLIGADA e `ok` — CMS manual e CMS saudavel', () => {
    // Kill switch desligado e estado operacional CONHECIDO, nao avaria. Tratar
    // como bloqueio faria o orquestrador tirar do ar um Payload que publica
    // perfeitamente por redacao humana.
    for (const env of [
      {},
      { EDITORIAL_AUTO_PUBLISH_ENABLED: 'false' },
      { NODE_ENV: 'production' },
      // Producao, sem fuso, sem nenhuma variavel de automacao: exatamente o
      // ambiente de um CMS manual.
      { NODE_ENV: 'production', EDITORIAL_AUTO_PUBLISH_ENABLED: 'false' },
    ]) {
      const verdict = evaluateAutoPublishReadiness(env)
      expect(verdict.status).toBe('ok')
      expect(verdict.detail).toContain('desabilitada')
    }
  })

  it('automacao LIGADA e bem configurada e `ok`', () => {
    const verdict = evaluateAutoPublishReadiness({
      NODE_ENV: 'production',
      EDITORIAL_AUTO_PUBLISH_ENABLED: 'true',
      EDITORIAL_AUTO_PUBLISH_TIME_ZONE: 'America/Sao_Paulo',
    })
    expect(verdict.status).toBe('ok')
    expect(verdict.detail).toContain('America/Sao_Paulo')
  })

  it('automacao LIGADA sem fuso em producao BLOQUEIA', () => {
    // Quem ligou a automacao espera que ela publique. Descobrir o fuso ausente
    // a cada request seria descobrir tarde.
    const verdict = evaluateAutoPublishReadiness({
      NODE_ENV: 'production',
      EDITORIAL_AUTO_PUBLISH_ENABLED: 'true',
    })
    expect(verdict.status).toBe('blocked')
  })

  it('automacao LIGADA com fuso invalido BLOQUEIA', () => {
    for (const timeZone of ['-03:00', 'BRT', 'Nao/Existe']) {
      const verdict = evaluateAutoPublishReadiness({
        NODE_ENV: 'production',
        EDITORIAL_AUTO_PUBLISH_ENABLED: 'true',
        EDITORIAL_AUTO_PUBLISH_TIME_ZONE: timeZone,
      })
      expect(verdict.status).toBe('blocked')
    }
  })

  it('o detalhe NAO vaza valor de configuracao', () => {
    // Readiness e lida por quem tem o painel aberto. O nome da variavel basta
    // para agir; o valor errado nao precisa aparecer.
    const verdict = evaluateAutoPublishReadiness({
      NODE_ENV: 'production',
      EDITORIAL_AUTO_PUBLISH_ENABLED: 'true',
      EDITORIAL_AUTO_PUBLISH_TIME_ZONE: 'Zona/Secreta',
    })
    expect(verdict.detail).not.toContain('Zona/Secreta')
  })

  it('o check entra no relatorio e um bloqueio derruba a readiness', () => {
    const green = evaluateCmsReadiness(facts())
    expect(green.checks.map((check) => check.name)).toContain('auto_publish')
    expect(green.ready).toBe(true)

    const red = evaluateCmsReadiness(
      facts({ autoPublish: { status: 'blocked', detail: 'configuracao invalida' } }),
    )
    expect(red.ready).toBe(false)
    expect(readinessHttpStatus(red)).toBe(503)
  })
})
