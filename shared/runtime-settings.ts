export interface RuntimeSettings {
  dbMaxOpenConnections: number
  memoryMiB: number
}
export interface RuntimeSettingsInput extends RuntimeSettings { revision: string }
export interface RuntimeSettingsStatus {
  revision: string
  configured: RuntimeSettings
  effective: RuntimeSettings | null
  applying: boolean
  lastApply: {
    id: string
    status: 'applying' | 'succeeded' | 'rolled_back' | 'failed' | 'rollback_failed'
    actor: string
    startedAt: string
    finishedAt?: string
    message: string
  } | null
}
