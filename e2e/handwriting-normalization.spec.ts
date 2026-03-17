import { expect, test } from '@playwright/test'

import { analyzeHandwrittenExpression, getHandwritingFixture } from '../lib/handwritingNormalization'

test.describe('handwriting normalization fixtures', () => {
  test('superscript fixture groups the base and exponent separately', async () => {
    const fixture = getHandwritingFixture('superscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const superscriptEdge = analysis.edges.find((edge) => edge.kind === 'superscriptCandidate')
    const sequenceEdge = analysis.edges.find((edge) => edge.kind === 'sequence')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'superscript')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'baseline')).toBe(true)
    expect(superscriptEdge?.score || 0).toBeGreaterThan(sequenceEdge?.score || 0)
  })

  test('fraction fixture recognizes fraction structure', async () => {
    const fixture = getHandwritingFixture('fraction')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'numerator')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(true)
  })

  test('nested fixture preserves chained local ownership', async () => {
    const fixture = getHandwritingFixture('nested')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const root = analysis.roles.find((role) => role.role === 'baseline')
    const firstSup = analysis.roles.find((role) => role.role === 'superscript' && role.parentGroupId === root?.groupId)
    const secondSup = analysis.roles.find((role) => role.role === 'superscript' && role.parentGroupId === firstSup?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(root).toBeTruthy()
    expect(firstSup).toBeTruthy()
    expect(secondSup).toBeTruthy()
    expect(analysis.subexpressions.some((subexpression) => subexpression.memberGroupIds.length === 3)).toBe(true)
  })

  test('ambiguous adjacency fixture keeps spatial script evidence stronger than sequence', async () => {
    const fixture = getHandwritingFixture('adjacentAmbiguous')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const superscriptEdge = analysis.edges.find((edge) => edge.kind === 'superscriptCandidate')
    const sequenceEdge = analysis.edges.find((edge) => edge.kind === 'sequence')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(superscriptEdge?.score || 0).toBeGreaterThan(sequenceEdge?.score || 0)
    if (analysis.ambiguities.length > 0) {
      expect(analysis.ambiguities.some((ambiguity) => ambiguity.reason === 'sequence-vs-script' || ambiguity.reason === 'competing-relations')).toBe(true)
    }
  })

  test('crossing four fixture keeps overlapping strokes in one group', async () => {
    const fixture = getHandwritingFixture('crossingFour')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.groups[0]?.strokeIds).toHaveLength(2)
    expect(analysis.roles).toHaveLength(1)
    expect(analysis.roles[0]?.role).toBe('baseline')
  })

  test('later fraction bar does not steal a strong superscript pair', async () => {
    const fixture = getHandwritingFixture('superscriptThenBar')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'baseline')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'superscript')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'numerator')).toBe(false)
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(false)
  })

  test('fraction can claim a local root while preserving its nested exponent', async () => {
    const fixture = getHandwritingFixture('fractionWithExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const numeratorRoot = analysis.roles.find((role) => role.role === 'numerator')
    const nestedSuperscript = analysis.roles.find((role) => role.role === 'superscript')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(true)
    expect(numeratorRoot).toBeTruthy()
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(true)
    expect(nestedSuperscript?.parentGroupId).toBe(numeratorRoot?.groupId)
    expect(analysis.subexpressions.some((subexpression) => subexpression.rootGroupId === numeratorRoot?.groupId && subexpression.memberGroupIds.length === 2 && subexpression.rootRole === 'numerator')).toBe(true)
  })
})