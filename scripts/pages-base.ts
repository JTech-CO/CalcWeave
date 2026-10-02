/** A deployment is either the origin root or one bounded GitHub project segment. */
export function parseDeploymentBase(value: unknown): string {
  if (typeof value !== 'string' || !(value === '/' || /^\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/$/.test(value))) {
    throw new Error('Invalid CalcWeave deployment base. Use / or one safe project path such as /CalcWeave/.');
  }
  return value;
}

/** Shared by Vite and policy generation; browser code passes BASE_URL to the parser. */
export function getDeploymentBasePath(): string {
  return parseDeploymentBase(process.env.CALCWEAVE_BASE_PATH ?? '/');
}
