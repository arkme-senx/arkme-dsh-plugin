import { ArkmeRequestCoordinator } from '../request-coordinator.js'

// Bound background loopback connections so Chromium can still dispatch active reads.
// The Host alone paces upstream services; cached foreground reads bypass this admission.
const concurrencyOnly = { ratePerSecond: Number.MAX_SAFE_INTEGER, burst: Number.MAX_SAFE_INTEGER, maxQueued: 512 }
export const backgroundUiReads = new ArkmeRequestCoordinator({
  maxConcurrent: 4, maxQueued: 512,
  laneLimits: {
    'background-read': { ...concurrencyOnly, maxConcurrent: 2 },
    image: { ...concurrencyOnly, maxConcurrent: 2 },
  },
  defaultServiceLimit: { ...concurrencyOnly, maxConcurrent: 4 },
})

export { supportsBackgroundRead } from '../read-scheduling.js'
