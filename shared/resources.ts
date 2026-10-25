export interface ResourceHost {
  totalBytes: number
  availableBytes: number
  swapTotalBytes: number
  swapUsedBytes: number
  swapInBytesPerSecond: number | null
  swapOutBytesPerSecond: number | null
}
export interface ResourceContainer {
  id: string
  name: string
  usedBytes: number
  workingSetBytes: number
  rssBytes: number
  cacheBytes: number
  swapBytes: number
  limitBytes: number | null
  peakBytes: number
  failCount: number
}
export interface ResourceDisk {
  device: string
  readAwaitMs: number | null
  writeAwaitMs: number | null
  busyPercent: number | null
}
export interface ResourceSample {
  at: string
  bootId: string
  host: ResourceHost
  containers: ResourceContainer[]
  disks: ResourceDisk[]
}
export interface ResourcePoint {
  at: string
  lastAt: string
  gap: boolean
  availableBytes: number
  swapUsedBytes: number
  swapInBytesPerSecond: number | null
  swapOutBytesPerSecond: number | null
  diskAwaitMs: number | null
  containers: Record<string, number>
}
export interface ResourcesResponse {
  generatedAt: string
  firstRecordedAt: string | null
  sampleIntervalSeconds: number
  retentionDays: number
  bucketSeconds: number
  sampleCount: number
  stale: boolean
  latest: ResourceSample | null
  points: ResourcePoint[]
}
