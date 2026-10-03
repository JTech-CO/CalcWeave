import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Development-only extraction of repository-owned numerical functions, never user input. */
export async function buildFixedTemplates(): Promise<{ kernels: string; discrete: string; continuous: string }> {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  async function statements(path: string, include: (statement: ts.Statement) => boolean): Promise<string> {
    const source = ts.createSourceFile(path, await readFile(resolve(path), 'utf8'), ts.ScriptTarget.ES2022, true);
    return source.statements.filter((statement) => !ts.isImportDeclaration(statement) && include(statement))
      .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, source).replace(/^export /gm, '')).join('\n');
  }
  const expression = await statements('packages/expression/src/index.ts', (statement) => ts.isFunctionDeclaration(statement) && ['fail', 'finite', 'evaluateExpression'].includes(statement.name?.text ?? ''));
  const kernels = await statements('packages/runtime/src/kernels.ts', (statement) => !ts.isFunctionDeclaration(statement) || statement.name?.text !== 'nodeOperationCost');
  const advanced = await statements('packages/advanced-math/src/index.ts', () => true);
  const quantization = await statements('packages/quantization/src/index.ts', () => true);
  const expansion = await statements('packages/runtime/src/expansion.ts', () => true);
  const timeSources = await statements('packages/runtime/src/time-sources.ts', () => true);
  const m8 = await statements('packages/runtime/src/m8.ts', () => true);
  const m9 = await statements('packages/runtime/src/m9.ts', (statement) => !ts.isFunctionDeclaration(statement) || statement.name?.text !== 'm9OperationCost');
  const m9OperationCost = await statements('packages/runtime/src/m9.ts', (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'm9OperationCost');
  const discrete = await statements('packages/runtime/src/discrete-machine.ts', () => true);
  const modelTypes = await statements('packages/model/src/types.ts', (statement) =>
    (ts.isInterfaceDeclaration(statement) && statement.name.text !== 'RunOptions') || ts.isTypeAliasDeclaration(statement));
  const signal = await statements('packages/model/src/signal.ts', () => true);
  const m9Memory = await statements('packages/model/src/m9.ts', () => true);
  const memory = await statements('packages/model/src/discrete.ts', () => true);
  const solverSettings = await statements('packages/model/src/continuous.ts', () => true);
  const expressionCost = await statements('packages/expression/src/index.ts', (statement) =>
    ts.isFunctionDeclaration(statement) && ['children', 'expressionNodeCount'].includes(statement.name?.text ?? '')
    || ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'EXPRESSION_LIMITS'));
  const operationCost = await statements('packages/runtime/src/kernels.ts', (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'nodeOperationCost');
  const solver = await statements('packages/runtime/src/continuous-solver.ts', () => true);
  const machine = await statements('packages/runtime/src/continuous-machine.ts', () => true);
  const execution = await statements('packages/runtime/src/continuous-execution.ts', () => true);
  return { kernels: `class ModelError extends Error {\n  constructor(public readonly diagnostics: { code: string; nodeId?: string; message: string; tick?: number; time?: number }[], public readonly partialResult?: unknown) {\n    super(diagnostics[0]?.code + (diagnostics[0]?.nodeId ? ': ' + diagnostics[0].nodeId : ''));\n    this.name = 'ModelError';\n  }\n}\n${expression}\n${advanced}\n${quantization}\n${expansion}\n${timeSources}\n${m8}\n${m9}\n${kernels}`, discrete,
    continuous: [modelTypes, signal, m9Memory, memory, solverSettings, expressionCost, m9OperationCost, operationCost, solver, machine, execution].join('\n') };
}

function fixedString(name: string, source: string): string {
  // JSON string escaping retains template literals inside the trusted source exactly.
  return `// Generated from repository-owned runtime sources by sync-runtime-templates.ts.\nexport const ${name} = [\n${source.split('\n').map((line) => '  ' + JSON.stringify(line)).join(',\n')}\n].join('\\n');\n`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const templates = await buildFixedTemplates();
  await writeFile(resolve('packages/codegen-ts/src/kernels-template.ts'), fixedString('KERNEL_TEMPLATE', templates.kernels));
  await writeFile(resolve('packages/codegen-ts/src/discrete-template.ts'), fixedString('DISCRETE_TEMPLATE', templates.discrete));
  await writeFile(resolve('packages/codegen-ts/src/continuous-template.ts'), fixedString('CONTINUOUS_TEMPLATE', templates.continuous));
}
