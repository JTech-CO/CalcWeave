import { describe, expect, it } from 'vitest';
import { ModelError } from '../packages/model/src';
import { EXPRESSION_LIMITS, evaluateExpression, expressionNodeCount, parseExpression } from '../packages/expression/src';

function code(action: () => unknown) {
  try { action(); throw new Error('Expected a mathematical diagnostic'); }
  catch (error) { if (error instanceof ModelError) return error.diagnostics[0]!.code; throw error; }
}

describe('bounded mathematical expressions', () => {
  it('uses mathematical exponent precedence, right association and scientific literals', () => {
    const examples = [ ['-2^2', -4], ['(-2)^2', 4], ['2^-2', 0.25], ['2^3^2', 512], ['1e-3 + .5 * 2', 1.001], ['max(abs(x), 3)', 5] ] as const;
    for (const [text, expected] of examples) expect(evaluateExpression(parseExpression(text), -5)).toBe(expected);
    expect(evaluateExpression(parseExpression('sin(pi/2) + log(e)'), 0)).toBe(2);
  });

  it('rejects code, property lookup, unknown names, malformed syntax and function arity', () => {
    for (const text of ['x.constructor', 'globalThis', 'alert(1)', 'x[0]', 'x=1', '1;2', '"x"', 'Math.sin(x)', 'sqrt(1,2)', 'min(1)', 'min()', 'max(1,2,3)', 'sin', '1e999', '(1+2', 'x x', '1e', '']) {
      expect(['EXPRESSION_SYNTAX', 'EXPRESSION_LIMIT']).toContain(code(() => parseExpression(text)));
    }
  });

  it('bounds text, syntax nesting, AST depth and node count independently', () => {
    expect(code(() => parseExpression('x'.repeat(EXPRESSION_LIMITS.maxLength + 1)))).toBe('EXPRESSION_LIMIT');
    expect(code(() => parseExpression('('.repeat(33) + 'x' + ')'.repeat(33)))).toBe('EXPRESSION_LIMIT');
    expect(code(() => parseExpression(Array(34).fill('1').join('+')))).toBe('EXPRESSION_LIMIT');
    // A balanced expression exceeds the node budget without excessive recursion depth.
    let text = 'x'; for (let i = 0; i < 7; i++) text = `(${text}+${text})`;
    expect(code(() => parseExpression(text))).toBe('EXPRESSION_LIMIT');
    expect(expressionNodeCount(parseExpression('x*2+sqrt(4)'))).toBe(6);
  });

  it('reports zero division, real-domain errors and nonfinite outputs', () => {
    for (const text of ['1/0', '1/(x-x)']) expect(code(() => evaluateExpression(parseExpression(text), 3))).toBe('NUMERIC_DIVIDE_BY_ZERO');
    for (const text of ['sqrt(-1)', 'log(0)', 'log10(-3)', 'acos(2)', 'asin(-2)', '(-1)^.5']) expect(code(() => evaluateExpression(parseExpression(text), 1))).toBe('NUMERIC_DOMAIN');
    expect(code(() => evaluateExpression(parseExpression('exp(1000)'), 1))).toBe('NUMERIC_NONFINITE');
    expect(code(() => evaluateExpression(parseExpression('x'), Infinity))).toBe('NUMERIC_NONFINITE');
  });
});
