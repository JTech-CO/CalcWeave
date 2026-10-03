export type SupportTarget = 'typescript' | 'python' | 'wasm' | 'c-cpp';
export type SupportMode = 'static' | 'discrete' | 'continuous';
export type SupportClassification = 'native-capability' | 'shared-configuration' | 'preset' | 'independent-alternative' | 'conditional-adapter' | 'legacy';
export type SupportDecision = 'selected-subset' | 'unsupported' | 'legacy-unavailable';
export type SupportImplementationKind = 'registry-block' | 'model-widget' | 'unavailable-capability';
export type SupportTargetStatus = 'selected-config-eligible' | 'ui-only' | 'unsupported' | 'environment-unavailable';
export interface SupportEvidence {
  path: string;
  sha256: string;
  kind: 'reference' | 'contract' | 'source-approval' | 'execution-proof' | 'ui-proof' | 'target-proof';
  scope: string;
  claim: 'tracking-only' | 'selected-subset';
  fixtureIds?: string[];
}
export interface SupportParameter {
  kind: string;
  label: string;
  default: unknown;
  min?: number;
  max?: number;
  options?: string[];
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  qaStatus: 'declared-local-schema-not-exhaustive-source-inventory';
}
export interface SupportTargetCapability {
  target: SupportTarget;
  version: string;
  status: SupportTargetStatus;
  supportedModes: SupportMode[];
  dtypeScope: string;
  reason: string;
  requiresActualModelValidation: true;
  allConfigurationsVerified: false;
}
export interface CanonicalSupport {
  id: string;
  kind: SupportImplementationKind;
  label: string;
  englishName: string;
  description: string;
  parameters: Record<string, SupportParameter>;
  declaration: {
    valueType: string;
    shape: string;
    unit: string;
    sampleTime: string;
    state: string;
    inputs: string[];
    outputs: string[];
  };
  dtype: { status: 'compiler-validated-per-model' | 'selected-widget' | 'unavailable'; scope: string; sourceInventoryVerified: false };
  supportedModes: SupportMode[];
  bindings?: string[];
  targets: SupportTargetCapability[];
  fullEquivalence: false;
}
export interface SupportOptionProfile {
  parameters: Record<string, unknown>;
  modes: SupportMode[];
  evidencePath: string;
  fixtureIds: string[];
  scope: 'selected-config-only';
  presetId?: string;
  rawFixtureId?: string;
  requiredBindingsActuallyConnected?: string[];
}
export interface SourceSupportRow {
  id: string;
  name: string;
  section: number;
  ordinal: number;
  subgroup: string;
  condition: string;
  owner: 'JTech-Co';
  source: { path: string; line: number; identitySha256: string; href: string };
  verification: { engineVersion: string; contractVersion: 'source-support-m16-v1'; auditScope: 'tracking-and-declared-selected-contracts' };
  decision: { status: SupportDecision; classification: SupportClassification; priorStatus: string; reason: string };
  implementations: { id: string; kind: SupportImplementationKind }[];
  sourceInventory: { status: 'unverified'; version: 'R2024b'; reason: string; fullOptionInventoryObtained: false; requiredDimensions: string[] };
  capabilities: {
    optionsRef: string[];
    optionProfiles: SupportOptionProfile[];
    dtype: { status: 'conditional-model-validation' | 'ui-only' | 'unavailable'; scopes: { canonical: string; description: string }[] };
    modes: SupportMode[];
    modeQaStatus: 'declared-canonical-modes-require-model-validation';
    targets: SupportTargetCapability[];
  };
  externalConditions: {
    nativeExecution: 'unverified' | 'unavailable';
    sourceCondition: string;
    profileIds: string[];
    requirements: string[];
    rights: 'not-inferred-from-implementation';
    primarySourceRuntimeExecuted: false;
  };
  evidence: SupportEvidence[];
  unresolvedReasons: string[];
  trackingDecisionComplete: true;
  fullEquivalence: false;
}
export interface SupportMatrix {
  schemaVersion: 1;
  contractVersion: 'source-support-m16-v1';
  owner: 'JTech-Co';
  engineVersion: string;
  sourceVersion: 'R2024b';
  counts: {
    trackedSourceRows: number;
    uniqueSourceNames: number;
    selectedSubsetRows: number;
    unsupportedRows: number;
    unverifiedInventoryRows: number;
    fullOptionEquivalentRows: 0;
    registryDefinitions: number;
    canonicalContracts: number;
    widgetContracts: number;
    unavailableContracts: number;
    pythonDefinitionMembership: number;
    wasmDefinitionMembership: number;
    trackingDecisionCompleteRows: number;
  };
  sections: { id: number; name: string; rows: number }[];
  artifacts: Record<string, string>;
  protectedArtifacts: Record<string, string>;
  canonicalContracts: CanonicalSupport[];
  rows: SourceSupportRow[];
  fullSimulinkEquivalenceClaimed: false;
  numericalReferenceRuntimeExecuted: false;
  exhaustiveSourceOptionInventoryVerified: false;
  methodology: string[];
}
export interface SupportFilter {
  query?: string;
  section?: number;
  classification?: SupportClassification;
  decision?: SupportDecision;
  target?: SupportTarget;
}
