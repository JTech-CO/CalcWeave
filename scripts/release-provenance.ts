import assert from 'node:assert/strict';
import type { Plugin } from 'vite';

const COMMIT = /^[a-f0-9]{40}$/;
const META_NAME = 'calcweave-source-commit';

/** CI identity is provided by GitHub, never inferred from a dirty local checkout. */
export function sourceCommitFromEnvironment(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.CALCWEAVE_SOURCE_COMMIT;
  if (explicit !== undefined) assert(COMMIT.test(explicit), 'Invalid CalcWeave source commit');
  if (env.GITHUB_ACTIONS === 'true') {
    assert(env.GITHUB_SHA && COMMIT.test(env.GITHUB_SHA), 'GitHub build requires its exact source commit');
    assert(explicit === undefined || explicit === env.GITHUB_SHA, 'Source commit override differs from GitHub checkout');
    return env.GITHUB_SHA;
  }
  return explicit;
}

export function readSourceCommit(html: string, required = false): string | undefined {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1];
  assert(head !== undefined, 'Release HTML requires a head');
  const tags = [...head.matchAll(/<meta\b[^>]*>/gi)].filter(([tag]) => new RegExp(`\\bname\\s*=\\s*["']${META_NAME}["']`, 'i').test(tag));
  assert(tags.length <= 1 && (!required || tags.length === 1), 'Release requires a single source commit meta');
  if (!tags.length) return undefined;
  const commit = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tags[0]![0])?.[1];
  assert(commit !== undefined && COMMIT.test(commit), 'Release source commit must be forty lowercase hexadecimal characters');
  return commit;
}

export function calcWeaveProvenancePlugin(): Plugin {
  const commit = sourceCommitFromEnvironment(process.env);
  return {
    name: 'calcweave-release-provenance', apply: 'build',
    transformIndexHtml(html) {
      assert(readSourceCommit(html) === undefined, 'Source HTML must not predeclare a build identity');
      return commit ? [{ tag: 'meta', attrs: { name: META_NAME, content: commit }, injectTo: 'head' }] : [];
    },
  };
}
