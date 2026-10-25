export interface RequestLimitsValues {
  defaultMaxMiB: number
  largeThresholdMiB: number
  maxLargeConcurrent: number
  userOverrides: Array<{ userId: number; maxMiB: number }>
}
export interface RequestLimitsPolicy extends RequestLimitsValues {
  version: 1
  updatedAt: string
  updatedBy: string
}
export interface RequestLimitsStatus { revision: string; policy: RequestLimitsPolicy }
export interface RequestLimitsInput extends RequestLimitsValues { revision: string }
