import { ENGINE_VERSION } from '../../model/src';

/** The M16 support artifact is an immutable historical audit, not live metadata. */
export const HISTORICAL_SUPPORT_ENGINE_VERSION = '0.17.0-m16';

export interface ObserverInputExtension {
  readonly blockId: 'sink.display' | 'sink.scope';
  readonly introducedEngineVersion: '0.17.1-m16';
  readonly parameter: 'inputCount';
  readonly defaultInputs: 1;
  readonly minimumInputs: 1;
  readonly maximumInputs: 16;
  readonly firstPort: 'in';
  readonly additionalPortPattern: 'in2..in16';
  readonly targetInputLimits: Readonly<{ runtime: 16; typescript: 16; python: 1; wasm: 1 }>;
  readonly requiresActualModelValidation: true;
  readonly fullSourceEquivalence: false;
}

const targetInputLimits = Object.freeze({ runtime: 16, typescript: 16, python: 1, wasm: 1 } as const);
const observerInputs: readonly Readonly<ObserverInputExtension>[] = Object.freeze(
  (['sink.display', 'sink.scope'] as const).map(blockId => Object.freeze({
    blockId, introducedEngineVersion: '0.17.1-m16', parameter: 'inputCount',
    defaultInputs: 1, minimumInputs: 1, maximumInputs: 16,
    firstPort: 'in', additionalPortPattern: 'in2..in16', targetInputLimits,
    requiresActualModelValidation: true, fullSourceEquivalence: false,
  } as const)),
);

/** Current CalcWeave extensions stay separate from the frozen source-row proof. */
export const CURRENT_SUPPORT_EXTENSIONS = Object.freeze({
  schemaVersion: 1,
  engineVersion: ENGINE_VERSION,
  historicalSupportEngineVersion: HISTORICAL_SUPPORT_ENGINE_VERSION,
  observerInputs,
} as const);

export function getCurrentObserverExtensions(): readonly Readonly<ObserverInputExtension>[] {
  return observerInputs;
}

export function getCurrentObserverExtension(id: string): Readonly<ObserverInputExtension> | undefined {
  return typeof id === 'string' && id.length <= 80 ? observerInputs.find(extension => extension.blockId === id) : undefined;
}
