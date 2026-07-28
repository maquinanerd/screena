import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

/**
 * Config do CMS editorial (@screena/cms).
 *
 * Aplicacao INDEPENDENTE: nao importa apps/web, apps/admin, @screena/db nem
 * Prisma. Roda na porta 3002 e, quando for implantada, sera um SERVICO PROPRIO
 * — nunca dentro do container do screen-app (ver README).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@screena/editorial-contracts'],
  webpack: (config) => {
    config.resolve = config.resolve ?? {}
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    }
    return config
  },
}

export default withPayload(nextConfig)
