/** Exact signed port/parameter projections of approved frozen registries. No semver guessing. */
export const PACKAGE_MIGRATION_BASELINES = Object.freeze([
  Object.freeze({ stage: 'M9', engineVersion: '0.10.0-m9', entries: 211, registrySha256: '22970b24b9421121f362c774a65ac683c4a0e70e814c7bb13a4277dad7a0d860' }),
  Object.freeze({ stage: 'M9', engineVersion: '0.10.1-m9', entries: 211, registrySha256: '22970b24b9421121f362c774a65ac683c4a0e70e814c7bb13a4277dad7a0d860' }),
  Object.freeze({ stage: 'M10', engineVersion: '0.11.0-m10', entries: 245, registrySha256: '928b245226e3448283e969355a3e77f8c526bffa3cc780f2c48032042952332e' }),
  Object.freeze({ stage: 'M11', engineVersion: '0.12.0-m11', entries: 293, registrySha256: '1cf59a6cbd4f31b6ab2c9ec86461be4405ac6f27fdec7283e975435472fe65d8' }),
  Object.freeze({ stage: 'M12', engineVersion: '0.13.0-m12', entries: 304, registrySha256: 'bb604da6425b9429293b9daaea4ca163548fafda1d26673fecd90a8ea71d6a4d' }),
  Object.freeze({ stage: 'M13', engineVersion: '0.14.0-m13', entries: 334, registrySha256: '66efa7ee48cddca607af560e153acdab42802f9e2c9b2d9e1cec9795d24261d6' }),
  Object.freeze({ stage: 'M14', engineVersion: '0.15.0-m14', entries: 337, registrySha256: '19aa84816ba8be1d3ea10536efb6f65caab0922f67b02ce8783f15b11e52165b' }),
]);

export interface PackageMigrationReport {
  fromEngineVersion: string;
  toEngineVersion: string;
  originalRegistrySha256: string;
  currentRegistrySha256: string;
  originalModelHash: string;
  normalizedModelHash: string;
  currentSemanticHash: string;
  schemaVersion: 1;
  signatureAppliesTo: 'original-payload';
  originalIntegrityVerified: true;
  originalBytesMustBeRetained: true;
  normalizedModelChanged: boolean;
  currentCompilationPassed: boolean;
  numericalParityWithOriginalEngineVerified: false;
  optionCoercionPerformed: false;
}
