export interface Distribution {
  samples: number[];
  count: number;
  min: number;
  median: number;
  mean: number;
  p95: number;
  max: number;
}

export function summarize(samples: readonly number[]): Distribution {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('expected nonempty, finite, nonnegative measurements');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (index: number): number => sorted[index]!;
  const middle = Math.floor(sorted.length / 2);
  return {
    samples: [...samples], count: sorted.length, min: at(0),
    median: sorted.length % 2 ? at(middle) : (at(middle - 1) + at(middle)) / 2,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p95: at(Math.ceil(sorted.length * 0.95) - 1), max: at(sorted.length - 1),
  };
}
