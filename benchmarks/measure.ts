import type { Settings } from './model.js';
import { summarize } from './statistics.js';

// Clock injection keeps timing-boundary tests deterministic. Validation is outside
// the measured interval; each sample is a batch average, not a per-call percentile.
export async function measureBatches<T>(
  operation: (iteration: number) => Promise<T>,
  verify: (value: T, iteration: number) => void,
  settings: Pick<Settings, 'warmup' | 'batches' | 'iterations'>,
  now: () => number = () => performance.now(),
) {
  if (!Number.isInteger(settings.warmup) || settings.warmup < 0 ||
      !Number.isInteger(settings.batches) || settings.batches < 1 ||
      !Number.isInteger(settings.iterations) || settings.iterations < 1) {
    throw new Error('expected nonnegative warmup and positive batch/iteration counts');
  }
  for (let i = 0; i < settings.warmup; i++) verify(await operation(i), i);
  const samples: number[] = [];
  for (let batch = 0; batch < settings.batches; batch++) {
    let last: T | undefined;
    const start = now();
    for (let i = 0; i < settings.iterations; i++) last = await operation(i);
    const elapsed = now() - start;
    verify(last!, settings.iterations - 1);
    samples.push(elapsed / settings.iterations);
  }
  return summarize(samples);
}
