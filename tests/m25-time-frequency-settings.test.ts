import { describe, expect, it } from 'vitest';
import { defaultTimeFrequencyDraft, timeFrequencyDraftSelection } from '../apps/web/src/time-frequency-settings';
import { planTimeFrequency } from '../packages/analysis/src/time-frequency';

const valid = { startIndex: '0', count: '1024', segmentLength: '256', overlap: '128' };
describe('M25 explicit bounded frame settings', () => {
  it('uses valid first-1024 defaults without pretending a short recording has eight samples', () => {
    expect(defaultTimeFrequencyDraft(0)).toEqual({ startIndex: '0', count: '0', segmentLength: '8', overlap: '4' });
    expect(defaultTimeFrequencyDraft(7)).toEqual({ startIndex: '0', count: '7', segmentLength: '8', overlap: '4' });
    expect(defaultTimeFrequencyDraft(8)).toEqual({ startIndex: '0', count: '8', segmentLength: '8', overlap: '4' });
    expect(defaultTimeFrequencyDraft(19)).toEqual({ startIndex: '0', count: '19', segmentLength: '16', overlap: '8' });
    expect(defaultTimeFrequencyDraft(8192)).toEqual(valid);
    for (const count of [-1, 1.5, NaN, Infinity]) expect(defaultTimeFrequencyDraft(count).count).toBe('0');
  });
  it('retains literal non-power-of-two counts and complete-frame discarded tails', () => {
    const selected = timeFrequencyDraftSelection({ startIndex: '2', count: '21', segmentLength: '8', overlap: '2' }, 23);
    expect(selected).toEqual({ startIndex: 2, count: 21, segmentLength: 8, overlap: 2 });
    expect(planTimeFrequency(selected.count, { segmentLength: 8, overlap: 2, window: 'hann', removeMean: true, tail: 'discard' })).toMatchObject({ hop: 6, frameCount: 3, usedCount: 20, discardedCount: 1 });
  });
  for (const patch of [{ startIndex: '' }, { startIndex: '-1' }, { startIndex: '0x1' }, { startIndex: ' 1' }, { startIndex: '1 ' }, { startIndex: '1.0' }, { startIndex: '1e0' }, { startIndex: '01' }, { startIndex: 'Infinity' }, { startIndex: '<img>' }, { startIndex: '1'.repeat(101) }, { startIndex: '9007199254740992' }, { count: '7' }, { count: '8193' }, { count: '1025' }, { count: 'NaN' }, { segmentLength: '7' }, { segmentLength: '9' }, { segmentLength: '4096' }, { segmentLength: '2048' }, { overlap: '-1' }, { overlap: '256' }, { overlap: '1.5' }, { overlap: '2e1' }]) {
    it(`rejects malformed or out-of-record setting ${JSON.stringify(patch)}`, () => { expect(() => timeFrequencyDraftSelection({ ...valid, ...patch }, 1024)).toThrow(); });
  }
  it('checks the remainder with subtraction so huge indices cannot escape actual recorded bounds', () => {
    expect(() => timeFrequencyDraftSelection({ ...valid, startIndex: '9007199254740991' }, 1024)).toThrow();
    expect(() => timeFrequencyDraftSelection({ ...valid, startIndex: '1' }, 1024)).toThrow();
    for (const count of [-1, NaN, Infinity, 1.5]) expect(() => timeFrequencyDraftSelection(valid, count)).toThrow();
  });
  it('rejects draft getters without executing them, extra fields, symbols and altered prototypes', () => {
    let calls = 0;
    const accessor = { ...valid }; Object.defineProperty(accessor, 'count', { enumerable: true, get: () => { calls++; return '1024'; } });
    expect(() => timeFrequencyDraftSelection(accessor, 1024)).toThrow(); expect(calls).toBe(0);
    for (const input of [{ ...valid, extra: '1' }, Object.assign(Object.create({}), valid), { ...valid, [Symbol('extra')]: '1' }, Object.defineProperty({ ...valid }, 'count', { value: '1024', enumerable: false })]) expect(() => timeFrequencyDraftSelection(input, 1024)).toThrow();
    expect(timeFrequencyDraftSelection(Object.assign(Object.create(null), valid), 1024)).toEqual({ startIndex: 0, count: 1024, segmentLength: 256, overlap: 128 });
  });
  it('distinguishes valid range requests from the core resource budget, without allocating frames', () => {
    const selection = timeFrequencyDraftSelection({ startIndex: '0', count: '8192', segmentLength: '8', overlap: '7' }, 8192);
    expect(selection.overlap).toBe(7);
    expect(() => planTimeFrequency(selection.count, { segmentLength: selection.segmentLength, overlap: selection.overlap, window: 'hann', removeMean: true, tail: 'discard' })).toThrow(/128/);
  });
});
