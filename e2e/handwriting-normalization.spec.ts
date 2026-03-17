import { expect, test } from '@playwright/test'

import { analyzeHandwrittenExpression, getHandwritingFixture } from '../lib/handwritingNormalization'

test.describe('handwriting normalization fixtures', () => {
  test('superscript fixture groups the base and exponent separately', async () => {
    const fixture = getHandwritingFixture('superscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'superscript')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'baseline')).toBe(true)
  })

  test('fraction fixture recognizes fraction structure', async () => {
    const fixture = getHandwritingFixture('fraction')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'numerator')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(true)
  })

  test('ambiguous adjacency fixture preserves a close-call interpretation', async () => {
    const fixture = getHandwritingFixture('adjacentAmbiguous')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.ambiguities.length).toBeGreaterThanOrEqual(fixture.expectation.minAmbiguities || 1)
    expect(analysis.ambiguities.some((ambiguity) => ambiguity.reason === 'sequence-vs-script')).toBe(true)
  })
})