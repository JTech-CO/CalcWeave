import { ModelError, type ExpressionNode } from '../../model/src';

export const EXPRESSION_LIMITS = Object.freeze({ maxLength: 512, maxNodes: 128, maxDepth: 32 });
export const EXPRESSION_FUNCTIONS = Object.freeze([
  'abs', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'log10',
  'floor', 'ceil', 'round', 'trunc', 'min', 'max',
] as const);
const functionNames = new Set<string>(EXPRESSION_FUNCTIONS);
type Token = { kind: 'number' | 'name' | 'symbol' | 'end'; text: string; offset: number };

function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }

/** Parse a bounded mathematical grammar. Names never resolve against JavaScript objects. */
export function parseExpression(text: string): ExpressionNode {
  if (typeof text !== 'string' || text.length === 0 || text.length > EXPRESSION_LIMITS.maxLength) {
    fail('EXPRESSION_LIMIT', `수식은 1~${EXPRESSION_LIMITS.maxLength}자여야 합니다.`);
  }
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < text.length) {
    if (/\s/.test(text[offset]!)) { offset++; continue; }
    const remainder = text.slice(offset);
    const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(remainder)?.[0];
    if (numeric) { tokens.push({ kind: 'number', text: numeric, offset }); offset += numeric.length; continue; }
    const name = /^[A-Za-z][A-Za-z0-9_]*/.exec(remainder)?.[0];
    if (name) { tokens.push({ kind: 'name', text: name, offset }); offset += name.length; continue; }
    if ('+-*/^(),'.includes(text[offset]!)) { tokens.push({ kind: 'symbol', text: text[offset]!, offset }); offset++; continue; }
    fail('EXPRESSION_SYNTAX', `수식 ${offset + 1}번째 문자에 허용하지 않는 기호가 있습니다.`);
  }
  tokens.push({ kind: 'end', text: '', offset: text.length });
  let cursor = 0, nodes = 0, nesting = 0;
  const current = () => tokens[cursor]!;
  const consume = (symbol: string) => { if (current().text !== symbol) return false; cursor++; return true; };
  const syntax = (message: string): never => fail('EXPRESSION_SYNTAX', `수식 ${current().offset + 1}번째 위치: ${message}`);
  const make = (node: ExpressionNode): ExpressionNode => {
    if (++nodes > EXPRESSION_LIMITS.maxNodes) fail('EXPRESSION_LIMIT', `수식의 AST는 ${EXPRESSION_LIMITS.maxNodes}개 노드 이하여야 합니다.`);
    return node;
  };
  const nested = (parse: () => ExpressionNode): ExpressionNode => {
    if (++nesting > EXPRESSION_LIMITS.maxDepth) fail('EXPRESSION_LIMIT', `수식 중첩은 ${EXPRESSION_LIMITS.maxDepth}단계 이하여야 합니다.`);
    try { return parse(); } finally { nesting--; }
  };
  function primary(): ExpressionNode {
    const token = current();
    if (token.kind === 'number') {
      cursor++;
      const value = Number(token.text);
      if (!Number.isFinite(value)) syntax('숫자 literal은 유한한 값이어야 합니다.');
      return make({ type: 'number', value });
    }
    if (consume('(')) {
      const result = nested(sum);
      if (!consume(')')) syntax('닫는 괄호가 필요합니다.');
      return result;
    }
    if (token.kind === 'name') {
      cursor++;
      if (token.text === 'x' || token.text === 'pi' || token.text === 'e') {
        return make({ type: 'variable', name: token.text });
      }
      if (!functionNames.has(token.text)) syntax(`'${token.text}'은 허용된 함수나 변수 이름이 아닙니다.`);
      if (!consume('(')) syntax('함수 인자는 괄호로 감싸세요.');
      const args: ExpressionNode[] = [nested(sum)];
      if (consume(',')) args.push(nested(sum));
      if (!consume(')')) syntax('함수 인자는 최대 두 개이며 닫는 괄호가 필요합니다.');
      const required = token.text === 'min' || token.text === 'max' ? 2 : 1;
      if (args.length !== required) syntax(`${token.text} 함수는 ${required}개 인자가 필요합니다.`);
      return make({ type: 'call', name: token.text, args });
    }
    return syntax('숫자, x, 상수 또는 허용 함수를 입력하세요.');
  }
  function power(): ExpressionNode {
    const left = primary();
    return consume('^') ? make({ type: 'binary', operator: '^', left, right: nested(unary) }) : left;
  }
  function unary(): ExpressionNode {
    if (consume('+')) return make({ type: 'unary', operator: '+', argument: nested(unary) });
    if (consume('-')) return make({ type: 'unary', operator: '-', argument: nested(unary) });
    return power();
  }
  function product(): ExpressionNode {
    let left = unary();
    while (current().text === '*' || current().text === '/') {
      const operator = current().text as '*' | '/'; cursor++;
      left = make({ type: 'binary', operator, left, right: unary() });
    }
    return left;
  }
  function sum(): ExpressionNode {
    let left = product();
    while (current().text === '+' || current().text === '-') {
      const operator = current().text as '+' | '-'; cursor++;
      left = make({ type: 'binary', operator, left, right: product() });
    }
    return left;
  }
  const result = sum();
  if (current().kind !== 'end') syntax('수식 뒤에 해석할 수 없는 내용이 있습니다.');
  const pending = [{ node: result, depth: 1 }];
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > EXPRESSION_LIMITS.maxDepth) fail('EXPRESSION_LIMIT', `수식 AST 깊이는 ${EXPRESSION_LIMITS.maxDepth}단계 이하여야 합니다.`);
    for (const child of children(node)) pending.push({ node: child, depth: depth + 1 });
  }
  return result;
}

function children(node: ExpressionNode): ExpressionNode[] {
  if (node.type === 'unary') return [node.argument];
  if (node.type === 'binary') return [node.left, node.right];
  if (node.type === 'call') return node.args;
  return [];
}

export function expressionNodeCount(ast: ExpressionNode): number {
  let count = 0;
  const pending = [ast];
  while (pending.length) {
    const node = pending.pop()!;
    if (++count > EXPRESSION_LIMITS.maxNodes) fail('EXPRESSION_LIMIT', '수식 AST 노드 상한을 초과했습니다.');
    pending.push(...children(node));
  }
  return count;
}

function finite(value: number): number {
  if (!Number.isFinite(value)) fail('NUMERIC_NONFINITE', '수식에서 유한하지 않은 계산값이 발생했습니다.');
  return value;
}

/** Evaluate a compiler-owned AST, never the original expression string. */
export function evaluateExpression(ast: ExpressionNode, x: number): number {
  finite(x);
  function evaluate(node: ExpressionNode): number {
    if (node.type === 'number') return finite(node.value);
    if (node.type === 'variable') return node.name === 'x' ? x : node.name === 'pi' ? Math.PI : Math.E;
    if (node.type === 'unary') return finite((node.operator === '-' ? -1 : 1) * evaluate(node.argument));
    if (node.type === 'binary') {
      const a = evaluate(node.left), b = evaluate(node.right);
      if (node.operator === '/' && b === 0) fail('NUMERIC_DIVIDE_BY_ZERO', '수식에서 0으로 나눌 수 없습니다.');
      if (node.operator === '^' && a < 0 && !Number.isInteger(b)) fail('NUMERIC_DOMAIN', '음수의 비정수 거듭제곱은 실수 범위를 벗어납니다.');
      switch (node.operator) {
        case '+': return finite(a + b);
        case '-': return finite(a - b);
        case '*': return finite(a * b);
        case '/': return finite(a / b);
        case '^': return finite(a ** b);
      }
    }
    const args = node.args.map(evaluate);
    const a = args[0]!;
    if (node.name === 'sqrt' && a < 0) fail('NUMERIC_DOMAIN', 'sqrt의 입력은 0 이상이어야 합니다.');
    if ((node.name === 'log' || node.name === 'log10') && a <= 0) fail('NUMERIC_DOMAIN', 'log의 입력은 0보다 커야 합니다.');
    if ((node.name === 'asin' || node.name === 'acos') && (a < -1 || a > 1)) fail('NUMERIC_DOMAIN', 'asin·acos의 입력은 -1~1이어야 합니다.');
    switch (node.name) {
      case 'abs': return finite(Math.abs(a));
      case 'sqrt': return finite(Math.sqrt(a));
      case 'sin': return finite(Math.sin(a));
      case 'cos': return finite(Math.cos(a));
      case 'tan': return finite(Math.tan(a));
      case 'asin': return finite(Math.asin(a));
      case 'acos': return finite(Math.acos(a));
      case 'atan': return finite(Math.atan(a));
      case 'exp': return finite(Math.exp(a));
      case 'log': return finite(Math.log(a));
      case 'log10': return finite(Math.log10(a));
      case 'floor': return finite(Math.floor(a));
      case 'ceil': return finite(Math.ceil(a));
      case 'round': return finite(Math.round(a));
      case 'trunc': return finite(Math.trunc(a));
      case 'min': return finite(Math.min(a, args[1]!));
      case 'max': return finite(Math.max(a, args[1]!));
      default: return fail('EXPRESSION_SYNTAX', '허용하지 않는 수식 함수입니다.');
    }
  }
  return evaluate(ast);
}
