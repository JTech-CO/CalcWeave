import assert from 'node:assert/strict';
import { checkPublishedArtifact, readPublishedArtifact } from './published-release';

const args = process.argv.slice(2);
assert(args.length === 3, 'Use: verify-published-release <approved URL> <exact artifact directory> <source commit>');
const artifact = await readPublishedArtifact(args[0]!, args[1]!, args[2]!);
const started = Date.now(), deadline = started + 5 * 60_000;
let attempt = 0;
while (Date.now() < deadline) {
  const result = await checkPublishedArtifact(artifact, fetch, deadline); attempt++;
  process.stdout.write(JSON.stringify({ attempt, ...result, appVersion: artifact.manifest.appVersion, sourceCommit: artifact.commit, releaseId: artifact.manifest.releaseId }) + '\n');
  if (result.passed) process.exit(0);
  const delay = Math.min(15_000, 2000 * attempt, deadline - Date.now());
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
}
throw new Error('Published application did not match the verified artifact within five minutes');
