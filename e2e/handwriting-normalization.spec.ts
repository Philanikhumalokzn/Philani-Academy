import { expect, test } from '@playwright/test'

import { analyzeHandwrittenExpression, getHandwritingFixture, getRoleDescriptor, roleAllowsChildRole } from '../lib/handwritingNormalization'
import { inferStructuralRoles } from '../lib/handwritingNormalization/roles'
import type { InkStroke, LayoutEdge, StrokeGroup } from '../lib/handwritingNormalization'

const makeStroke = (id: string): InkStroke => ({
  id,
  width: 4,
  color: '#e6eefc',
  startedAt: 0,
  endedAt: 0,
  points: [{ x: 0, y: 0, t: 0 }],
})

const makeGroup = (id: string, bounds: StrokeGroup['bounds'], strokeId = `${id}-stroke`): StrokeGroup => ({
  id,
  strokeIds: [strokeId],
  strokes: [makeStroke(strokeId)],
  bounds,
  centroid: { x: bounds.centerX, y: bounds.centerY },
  baselineY: bounds.bottom,
  aspectRatio: bounds.width / Math.max(bounds.height, 1),
  flatness: Math.max(bounds.width, bounds.height) / Math.max(1, Math.min(bounds.width, bounds.height)),
  density: 0.003,
  strokeCount: 1,
  startedAt: 0,
  endedAt: 0,
})

const makeEdge = (fromId: string, toId: string, kind: LayoutEdge['kind'], score: number, metrics: Record<string, number> = {}): LayoutEdge => ({
  id: `${fromId}:${kind}:${toId}`,
  fromId,
  toId,
  kind,
  score,
  metrics,
})

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
    const barRole = analysis.roles.find((role) => role.role === 'fractionBar')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(barRole).toBeTruthy()
    expect(barRole?.descriptor.family).toBe('fractionStructure')
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

  test('horizontal line below-right is treated as subscript rather than fraction structure', async () => {
    const fixture = getHandwritingFixture('offsetLineSubscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const subscript = analysis.roles.find((role) => role.role === 'subscript')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(subscript).toBeTruthy()
    expect(subscript?.descriptor.family).toBe('script')
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(false)
    expect(subscript?.evidence.some((entry) => entry.includes('below-right='))).toBe(true)
  })

  test('parenthesized superscript creates an enclosure structure without breaking local script ownership', async () => {
    const fixture = getHandwritingFixture('parenthesizedSuperscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const baseline = analysis.roles.find((role) => role.role === 'baseline')
    const superscript = analysis.roles.find((role) => role.role === 'superscript')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'enclosureOpen')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'enclosureClose')).toBe(true)
    expect(analysis.enclosures).toHaveLength(1)
    expect(baseline?.containerGroupIds).toHaveLength(2)
    expect(superscript?.parentGroupId).toBe(baseline?.groupId)
    expect(superscript?.containerGroupIds).toHaveLength(2)
  })

  test('outer superscript attaches to the enclosed semantic root rather than an enclosure boundary', async () => {
    const fixture = getHandwritingFixture('parenthesizedExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const baseline = analysis.roles.find((role) => role.role === 'baseline')
    const superscripts = analysis.roles.filter((role) => role.role === 'superscript')
    const outerSuperscript = superscripts.find((role) => role.parentGroupId === baseline?.groupId && role.containerGroupIds.length === 0)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.enclosures).toHaveLength(1)
    expect(superscripts).toHaveLength(2)
    expect(outerSuperscript).toBeTruthy()
    expect(outerSuperscript?.evidence.some((entry) => entry.includes('redirected-parent='))).toBe(true)

    const innerSuperscript = superscripts.find((role) => role.containerGroupIds.length === 2)
    const closeBoundary = analysis.roles.find((role) => role.role === 'enclosureClose')
    const normalizedOuter = analysis.normalization.groups.find((group) => group.id === outerSuperscript?.groupId)
    const normalizedInner = analysis.normalization.groups.find((group) => group.id === innerSuperscript?.groupId)
    const normalizedClose = analysis.normalization.groups.find((group) => group.id === closeBoundary?.groupId)

    expect(normalizedOuter).toBeTruthy()
    expect(normalizedInner).toBeTruthy()
    expect(normalizedClose).toBeTruthy()
    expect((normalizedOuter?.bounds.left || 0)).toBeGreaterThan((normalizedInner?.bounds.right || 0) + 12)
    expect((normalizedOuter?.bounds.left || 0)).toBeGreaterThan((normalizedClose?.bounds.right || 0) - 4)
    expect(outerSuperscript?.associationContextId?.startsWith('context:enclosure:')).toBe(true)
    expect(outerSuperscript?.normalizationAnchorGroupIds).toEqual(expect.arrayContaining([baseline?.groupId || '', closeBoundary?.groupId || '']))
    expect(analysis.contexts.some((context) => context.kind === 'enclosure' && context.semanticRootGroupId === baseline?.groupId)).toBe(true)
    expect(analysis.parseNodes.some((node) => node.kind === 'enclosureExpression')).toBe(true)
    expect(analysis.parseNodes.some((node) => node.kind === 'scriptApplication' && node.childNodeIds.some((childId) => childId.startsWith('parse:enclosure:')))).toBe(true)
  })

  test('enclosed local expression can serve as a fraction numerator while preserving its internal ownership', async () => {
    const fixture = getHandwritingFixture('parenthesizedFractionNumerator')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const numerator = analysis.roles.find((role) => role.role === 'numerator')
    const superscript = analysis.roles.find((role) => role.role === 'superscript')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.enclosures).toHaveLength(1)
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(true)
    expect(numerator).toBeTruthy()
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(true)
    expect(superscript?.parentGroupId).toBe(numerator?.groupId)
    expect(numerator?.containerGroupIds).toHaveLength(2)
    expect(analysis.parseNodes.some((node) => node.kind === 'fractionExpression')).toBe(true)
  })

  test('role taxonomy encodes child constraints and sibling ranks', async () => {
    const baseline = getRoleDescriptor('baseline')
    const superscript = getRoleDescriptor('superscript')
    const fractionBar = getRoleDescriptor('fractionBar')
    const numerator = getRoleDescriptor('numerator')
    const enclosureOpen = getRoleDescriptor('enclosureOpen')

    expect(roleAllowsChildRole('baseline', 'superscript')).toBe(true)
    expect(roleAllowsChildRole('baseline', 'subscript')).toBe(true)
    expect(roleAllowsChildRole('fractionBar', 'superscript')).toBe(false)
    expect(roleAllowsChildRole('fractionBar', 'subscript')).toBe(false)
    expect(roleAllowsChildRole('fractionBar', 'numerator')).toBe(true)
    expect(superscript.operatorKind).toBe('unaryReference')
    expect(superscript.operandReferenceMode).toBe('parent')
    expect(superscript.requiresOperandReference).toBe(true)
    expect(superscript.allowedOperandRoles).toEqual(expect.arrayContaining(['baseline', 'superscript', 'subscript']))
    expect(fractionBar.operatorKind).toBe('binaryStructure')
    expect(fractionBar.operandReferenceMode).toBe('children')
    expect(fractionBar.requiresOperandReference).toBe(true)
    expect(fractionBar.allowedOperandRoles).toEqual(expect.arrayContaining(['numerator', 'denominator']))
    expect(fractionBar.structuralBarrier).toBe(true)
    expect(roleAllowsChildRole('enclosureOpen', 'superscript')).toBe(false)
    expect(enclosureOpen.structuralBarrier).toBe(true)
    expect(numerator.peerRoles).toContain('denominator')
    expect(baseline.allowedChildRoles).toEqual(expect.arrayContaining(['superscript', 'subscript']))
  })

  test('stacked plain baselines are preserved as separate groups and flagged', async () => {
    const fixture = getHandwritingFixture('stackedBaselinesUnsupported')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.filter((role) => role.role === 'baseline')).toHaveLength(1)
    expect(analysis.roles.filter((role) => role.role === 'unsupportedSymbol')).toHaveLength(1)
    expect(analysis.flags.some((flag) => flag.kind === 'sameContextStackedBaselines')).toBe(true)
    expect(analysis.groups.every((group) => group.strokeIds.length >= 1)).toBe(true)
  })

  test('stacked same-parent superscripts are reduced to one local script row', async () => {
    const groups = [
      makeGroup('base', { left: 132, top: 232, right: 168, bottom: 278, width: 36, height: 46, centerX: 150, centerY: 255 }),
      makeGroup('super-1', { left: 208, top: 154, right: 252, bottom: 194, width: 44, height: 40, centerX: 230, centerY: 174 }),
      makeGroup('super-2', { left: 208, top: 112, right: 252, bottom: 152, width: 44, height: 40, centerX: 230, centerY: 132 }),
    ]
    const edges = [
      makeEdge('base', 'super-1', 'superscriptCandidate', 0.82, { dx: 80, dy: -81, sizeRatio: 0.87 }),
      makeEdge('base', 'super-2', 'superscriptCandidate', 0.37, { dx: 80, dy: -123, sizeRatio: 0.87 }),
      makeEdge('base', 'super-1', 'sequence', 0.18, { dx: 80, dy: -81 }),
      makeEdge('base', 'super-2', 'sequence', 0.1, { dx: 80, dy: -123 }),
    ]
    const analysis = inferStructuralRoles(groups, edges)

    expect(groups).toHaveLength(3)
    expect(analysis.roles.filter((role) => role.role === 'superscript')).toHaveLength(1)
    expect(analysis.roles.filter((role) => role.role === 'unsupportedSymbol')).toHaveLength(1)
    expect(analysis.flags.some((flag) => flag.kind === 'sameParentStackedScripts' && flag.scriptRole === 'superscript')).toBe(true)
  })

  test('stacked same-parent subscripts are reduced to one local script row', async () => {
    const groups = [
      makeGroup('base', { left: 126, top: 198, right: 164, bottom: 246, width: 38, height: 48, centerX: 145, centerY: 222 }),
      makeGroup('sub-1', { left: 208, top: 272, right: 250, bottom: 311, width: 42, height: 39, centerX: 229, centerY: 291.5 }),
      makeGroup('sub-2', { left: 208, top: 322, right: 250, bottom: 361, width: 42, height: 39, centerX: 229, centerY: 341.5 }),
    ]
    const edges = [
      makeEdge('base', 'sub-1', 'subscriptCandidate', 0.78, { dx: 84, dy: 69.5, sizeRatio: 0.81, belowRightScore: 0.62 }),
      makeEdge('base', 'sub-2', 'subscriptCandidate', 0.36, { dx: 84, dy: 119.5, sizeRatio: 0.81, belowRightScore: 0.44 }),
      makeEdge('base', 'sub-1', 'sequence', 0.16, { dx: 84, dy: 69.5 }),
      makeEdge('base', 'sub-2', 'sequence', 0.08, { dx: 84, dy: 119.5 }),
    ]
    const analysis = inferStructuralRoles(groups, edges)

    expect(groups).toHaveLength(3)
    expect(analysis.roles.filter((role) => role.role === 'subscript')).toHaveLength(1)
    expect(analysis.roles.filter((role) => role.role === 'unsupportedSymbol')).toHaveLength(1)
    expect(analysis.flags.some((flag) => flag.kind === 'sameParentStackedScripts' && flag.scriptRole === 'subscript')).toBe(true)
  })
})