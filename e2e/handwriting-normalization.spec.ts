import { expect, test } from '@playwright/test'

import { analyzeHandwrittenExpression, getHandwritingFixture, getRoleDescriptor, HANDWRITING_FIXTURE_ORDER, LEGO_BRICK_FAMILIES, recognizeSymbolForRole, roleAllowsChildRole } from '../lib/handwritingNormalization'
import { buildLayoutGraph } from '../lib/handwritingNormalization/graph'
import { normalizeInkLayout } from '../lib/handwritingNormalization/normalize'
import { buildExpressionParseForest } from '../lib/handwritingNormalization/parser'
import { inferStructuralRoles } from '../lib/handwritingNormalization/roles'
import type { ExpressionContext, HandwritingAnalysis, InkStroke, LayoutEdge, LegoBrickFamilyKind, LegoBrickHypothesis, LegoBrickOccupancy, StrokeGroup, StructuralRole } from '../lib/handwritingNormalization'

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
  strokes: [{
    ...makeStroke(strokeId),
    points: [
      { x: bounds.left, y: bounds.top, t: 0 },
      { x: bounds.right, y: bounds.bottom, t: 16 },
    ],
  }],
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

const getContextByKind = (analysis: HandwritingAnalysis, kind: ExpressionContext['kind']) => {
  return analysis.contexts.find((context) => context.kind === kind) || null
}

const getSemanticRootRole = (analysis: HandwritingAnalysis, context: ExpressionContext | null | undefined): StructuralRole | null => {
  return context?.semanticRootGroupId ? analysis.roles.find((role) => role.groupId === context.semanticRootGroupId) || null : null
}

const getTopBrickHypothesis = (analysis: HandwritingAnalysis, groupId: string) => {
  return analysis.brickHypotheses
    .filter((hypothesis) => hypothesis.groupId === groupId)
    .sort((left, right) => right.score - left.score)[0] || null
}

const getBrickOccupancy = (analysis: HandwritingAnalysis, groupId: string, field: string) => {
  return analysis.brickOccupancies.find((occupancy) => occupancy.groupId === groupId && occupancy.field === field) || null
}

const makeBrickHypothesis = (groupId: string, family: LegoBrickFamilyKind, score = 0.9): LegoBrickHypothesis => ({
  id: `brick:test:${groupId}:${family}`,
  groupId,
  family,
  prototype: LEGO_BRICK_FAMILIES[family].prototypeKinds[0],
  score,
  fields: LEGO_BRICK_FAMILIES[family].fields,
  evidence: ['test brick hypothesis'],
})

test.describe('handwriting normalization fixtures', () => {
  test('all fixture examples satisfy their declared role and group expectations', async () => {
    for (const fixtureName of HANDWRITING_FIXTURE_ORDER) {
      const fixture = getHandwritingFixture(fixtureName)
      const analysis = analyzeHandwrittenExpression(fixture.strokes)

      expect(analysis.groups, `${fixture.name} group count`).toHaveLength(fixture.expectation.groupCount)
      for (const requiredRole of fixture.expectation.requiredRoles) {
        const isSatisfied = requiredRole === 'numerator' || requiredRole === 'denominator'
          ? analysis.contexts.some((context) => context.kind === requiredRole)
            || analysis.roles.some((role) => role.role === requiredRole)
          : requiredRole === 'fractionBar'
            ? analysis.roles.some((role) => role.role === 'fractionBar' || role.role === 'provisionalFractionBar')
            : requiredRole === 'provisionalFractionBar'
              ? analysis.roles.some((role) => role.role === 'fractionBar' || role.role === 'provisionalFractionBar')
                || analysis.groups.some((group) => getTopBrickHypothesis(analysis, group.id)?.family === 'fractionBarBrick')
            : analysis.roles.some((role) => role.role === requiredRole)
        expect(
          isSatisfied,
          `${fixture.name} should contain role ${requiredRole}`,
        ).toBe(true)
      }
      if (fixture.expectation.minAmbiguities != null) {
        expect(analysis.ambiguities.length, `${fixture.name} ambiguity count`).toBeGreaterThanOrEqual(fixture.expectation.minAmbiguities)
      }
    }
  })

  test('superscript fixture groups the base and exponent separately', async () => {
    const fixture = getHandwritingFixture('superscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const superscriptEdge = analysis.edges.find((edge) => edge.kind === 'superscriptCandidate')
    const sequenceEdge = analysis.edges.find((edge) => edge.kind === 'sequence')
    const baselineRole = analysis.roles.find((role) => role.role === 'baseline')
    const superscriptRole = analysis.roles.find((role) => role.role === 'superscript')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'superscript')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'baseline')).toBe(true)
    expect(superscriptEdge?.score || 0).toBeGreaterThan(sequenceEdge?.score || 0)
    expect(baselineRole?.qualifiedRoleLabel).toBe('baseline-x')
    expect(superscriptRole?.qualifiedRoleLabel).toBe('superscript-2')
  })

  test('digit-like baseline keeps ordinary brick family and accepts a superscript 7', async () => {
    const fixture = getHandwritingFixture('digitTwoSuperscriptSeven')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const baselineRole = analysis.roles.find((role) => role.role === 'baseline') || null
    const superscriptRole = analysis.roles.find((role) => role.role === 'superscript') || null
    const baselineBrick = baselineRole ? getTopBrickHypothesis(analysis, baselineRole.groupId) : null
    const superscriptEdge = analysis.edges
      .filter((edge) => edge.kind === 'superscriptCandidate')
      .sort((left, right) => right.score - left.score)[0] || null

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(baselineRole).toBeTruthy()
    expect(superscriptRole).toBeTruthy()
    expect(superscriptRole?.parentGroupId).toBe(baselineRole?.groupId)
    expect(baselineBrick?.family).toBe('ordinaryBaselineSymbolBrick')
      expect(superscriptEdge?.score || 0).toBeGreaterThan(0.5)
  })

  test('simple script-host bases avoid exotic operator or radical brick families', async () => {
    const fixtureNames = ['superscript', 'nested', 'superscriptThenBar', 'digitTwoSuperscriptSeven'] as const

    for (const fixtureName of fixtureNames) {
      const fixture = getHandwritingFixture(fixtureName)
      const analysis = analyzeHandwrittenExpression(fixture.strokes)
      const superscriptRole = analysis.roles.find((role) => role.role === 'superscript') || null
      const parentBrick = superscriptRole?.parentGroupId ? getTopBrickHypothesis(analysis, superscriptRole.parentGroupId) : null

      expect(superscriptRole, `${fixture.name} should resolve a superscript`).toBeTruthy()
      expect(
        parentBrick?.family,
        `${fixture.name} superscript host should stay an ordinary baseline symbol brick`,
      ).toBe('ordinaryBaselineSymbolBrick')
    }
  })

  test('fraction fixture recognizes fraction structure', async () => {
    const fixture = getHandwritingFixture('fraction')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const barRole = analysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numeratorRoot = getSemanticRootRole(analysis, numeratorContext)
    const denominatorRoot = getSemanticRootRole(analysis, denominatorContext)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(barRole).toBeTruthy()
    expect(barRole?.descriptor.family).toBe('fractionStructure')
    expect(numeratorContext).toBeTruthy()
    expect(denominatorContext).toBeTruthy()
    expect(numeratorRoot?.role).toBe('baseline')
    expect(denominatorRoot?.role).toBe('baseline')
    expect(numeratorRoot?.associationContextId).toBe(numeratorContext?.id)
    expect(denominatorRoot?.associationContextId).toBe(denominatorContext?.id)
    expect(numeratorRoot?.qualifiedRoleLabel).toContain('@ numerator')
    expect(denominatorRoot?.qualifiedRoleLabel).toContain('@ denominator')
    expect(analysis.parseNodes.some((node) => node.kind === 'fractionExpression')).toBe(true)
    expect(barRole?.evidence.some((entry) => entry.startsWith('mutual-reinforcement='))).toBe(true)
    expect(barRole?.evidence.some((entry) => entry.startsWith('local-coherence='))).toBe(true)
    expect(barRole?.evidence.some((entry) => entry.startsWith('global-compatibility='))).toBe(true)
    expect(barRole?.evidence.some((entry) => entry.startsWith('revision-pressure='))).toBe(true)
  })

  test('radical fixture recognizes hosted radicand and optional index structure', async () => {
    const fixture = getHandwritingFixture('radicalWithIndex')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const radicalRole = analysis.roles.find((role) => role.role === 'radical')
    const radicandContext = getContextByKind(analysis, 'radicand')
    const indexContext = getContextByKind(analysis, 'radicalIndex')
    const radicandRoot = getSemanticRootRole(analysis, radicandContext)
    const indexRoot = getSemanticRootRole(analysis, indexContext)
    const radicalBrick = radicalRole ? getTopBrickHypothesis(analysis, radicalRole.groupId) : null
    const radicandOccupancy = radicandRoot ? getBrickOccupancy(analysis, radicandRoot.groupId, 'interior') : null
    const indexOccupancy = indexRoot ? getBrickOccupancy(analysis, indexRoot.groupId, 'upperLeftScript') : null
    const radicalNode = analysis.parseNodes.find((node) => node.kind === 'radicalExpression')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(radicalRole).toBeTruthy()
    expect(radicalBrick?.family).toBe('radicalBrick')
    expect(radicandContext).toBeTruthy()
    expect(indexContext).toBeTruthy()
    expect(radicandRoot?.associationContextId).toBe(radicandContext?.id)
    expect(indexRoot?.associationContextId).toBe(indexContext?.id)
    expect(radicandRoot?.qualifiedRoleLabel).toContain('@ radicand')
    expect(indexRoot?.qualifiedRoleLabel).toContain('@ radicalIndex')
    expect(radicandOccupancy?.hostGroupId).toBe(radicalRole?.groupId)
    expect(indexOccupancy?.hostGroupId).toBe(radicalRole?.groupId)
    expect(radicalNode?.childNodeIds).toHaveLength(2)
  })

  test('lego brick hypotheses classify canonical structural families', async () => {
    const fractionFixture = getHandwritingFixture('fraction')
    const fractionAnalysis = analyzeHandwrittenExpression(fractionFixture.strokes)
    const fractionBar = fractionAnalysis.roles.find((role) => role.role === 'fractionBar')
    const fractionNumerator = getSemanticRootRole(fractionAnalysis, getContextByKind(fractionAnalysis, 'numerator'))
    const barBrick = fractionBar ? getTopBrickHypothesis(fractionAnalysis, fractionBar.groupId) : null
    const numeratorBrick = fractionNumerator ? getTopBrickHypothesis(fractionAnalysis, fractionNumerator.groupId) : null

    expect(barBrick?.family).toBe('fractionBarBrick')
    expect(barBrick?.prototype).toBe('horizontalLine')
    expect(numeratorBrick?.family).toBe('ordinaryBaselineSymbolBrick')

    const enclosureFixture = getHandwritingFixture('parenthesizedSuperscript')
    const enclosureAnalysis = analyzeHandwrittenExpression(enclosureFixture.strokes)
    const openBoundary = enclosureAnalysis.roles.find((role) => role.role === 'enclosureOpen')
    const closeBoundary = enclosureAnalysis.roles.find((role) => role.role === 'enclosureClose')
    const baseline = enclosureAnalysis.roles.find((role) => role.role === 'baseline' && role.containerGroupIds.length === 2)
    const openBrick = openBoundary ? getTopBrickHypothesis(enclosureAnalysis, openBoundary.groupId) : null
    const closeBrick = closeBoundary ? getTopBrickHypothesis(enclosureAnalysis, closeBoundary.groupId) : null
    const baselineBrick = baseline ? getTopBrickHypothesis(enclosureAnalysis, baseline.groupId) : null

    expect(openBrick?.family).toBe('enclosureBoundaryBrick')
    expect(closeBrick?.family).toBe('enclosureBoundaryBrick')
    expect(baselineBrick?.family).toBe('ordinaryBaselineSymbolBrick')
  })

  test('lego brick occupancies track hosted fraction members and script attachments', async () => {
    const fractionFixture = getHandwritingFixture('fractionWithExponent')
    const fractionAnalysis = analyzeHandwrittenExpression(fractionFixture.strokes)
    const fractionBar = fractionAnalysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorRoot = getSemanticRootRole(fractionAnalysis, getContextByKind(fractionAnalysis, 'numerator'))
    const denominatorRoot = getSemanticRootRole(fractionAnalysis, getContextByKind(fractionAnalysis, 'denominator'))
    const nestedSuperscript = fractionAnalysis.roles.find((role) => role.role === 'superscript')
    const numeratorOccupancy = numeratorRoot ? getBrickOccupancy(fractionAnalysis, numeratorRoot.groupId, 'over') : null
    const denominatorOccupancy = denominatorRoot ? getBrickOccupancy(fractionAnalysis, denominatorRoot.groupId, 'under') : null
    const scriptOccupancy = nestedSuperscript ? getBrickOccupancy(fractionAnalysis, nestedSuperscript.groupId, 'upperRightScript') : null

    expect(numeratorOccupancy?.hostGroupId).toBe(fractionBar?.groupId)
    expect(denominatorOccupancy?.hostGroupId).toBe(fractionBar?.groupId)
    expect(scriptOccupancy?.hostGroupId).toBe(numeratorRoot?.groupId)

    const superscriptFixture = getHandwritingFixture('superscript')
    const superscriptAnalysis = analyzeHandwrittenExpression(superscriptFixture.strokes)
    const baseline = superscriptAnalysis.roles.find((role) => role.role === 'baseline')
    const superscript = superscriptAnalysis.roles.find((role) => role.role === 'superscript')
    const simpleScriptOccupancy = superscript ? getBrickOccupancy(superscriptAnalysis, superscript.groupId, 'upperRightScript') : null

    expect(simpleScriptOccupancy?.hostGroupId).toBe(baseline?.groupId)
    expect(simpleScriptOccupancy?.family).toBe('ordinaryBaselineSymbolBrick')
  })

  test('lego script host fields are surfaced in local and sequence-wide script evidence', async () => {
    const superscriptFixture = getHandwritingFixture('superscript')
    const superscriptAnalysis = analyzeHandwrittenExpression(superscriptFixture.strokes)
    const localSuperscript = superscriptAnalysis.roles.find((role) => role.role === 'superscript')

    expect(localSuperscript?.evidence.some((entry) => entry.startsWith('host-field=upperRightScript:'))).toBe(true)

    const sequenceFixture = getHandwritingFixture('sequenceOuterExponent')
    const sequenceAnalysis = analyzeHandwrittenExpression(sequenceFixture.strokes)
    const sequenceSuperscript = sequenceAnalysis.roles.find((role) => role.role === 'superscript')

    expect(sequenceSuperscript?.associationContextId?.startsWith('context:sequence:')).toBe(true)
    expect(sequenceSuperscript?.evidence.some((entry) => entry.startsWith('host-field=upperRightScript:'))).toBe(true)
  })

  test('lego inline fields modulate sequence scoring', async () => {
    const left = makeGroup('left', { left: 100, top: 120, right: 132, bottom: 164, width: 32, height: 44, centerX: 116, centerY: 142 })
    const right = makeGroup('right', { left: 132, top: 121, right: 164, bottom: 165, width: 32, height: 44, centerX: 148, centerY: 143 })

    const ordinaryEdges = buildLayoutGraph(
      [left, right],
      [
        makeBrickHypothesis('left', 'ordinaryBaselineSymbolBrick'),
        makeBrickHypothesis('right', 'ordinaryBaselineSymbolBrick'),
      ],
    )
    const fractionBarEdges = buildLayoutGraph(
      [left, right],
      [
        makeBrickHypothesis('left', 'ordinaryBaselineSymbolBrick'),
        makeBrickHypothesis('right', 'fractionBarBrick'),
      ],
    )

    const ordinarySequence = ordinaryEdges.find((edge) => edge.kind === 'sequence' && edge.fromId === 'left' && edge.toId === 'right')
    const fractionBarSequence = fractionBarEdges.find((edge) => edge.kind === 'sequence' && edge.fromId === 'left' && edge.toId === 'right')

    expect(ordinarySequence).toBeTruthy()
    expect(ordinarySequence?.score || 0).toBeGreaterThan(fractionBarSequence?.score || 0)
    expect((ordinarySequence?.metrics.inlineAffordanceScore || 0)).toBeGreaterThan((fractionBarSequence?.metrics.inlineAffordanceScore || 0))
    expect(ordinarySequence?.metrics.toLeftInlineWeight).toBeGreaterThan(fractionBarSequence?.metrics.toLeftInlineWeight || 0)
  })

  test('inline affordance fixtures surface strong ordinary flow and weak bar-like flow', async () => {
    const strongFixture = getHandwritingFixture('inlineOrdinaryPair')
    const strongAnalysis = analyzeHandwrittenExpression(strongFixture.strokes)
    const weakFixture = getHandwritingFixture('inlineFractionBarTemptation')
    const weakAnalysis = analyzeHandwrittenExpression(weakFixture.strokes)

    const strongSequence = strongAnalysis.edges.find((edge) => edge.kind === 'sequence')
    const weakSequence = weakAnalysis.edges.find((edge) => edge.kind === 'sequence')
    const weakBarBrick = weakAnalysis.groups[1] ? getTopBrickHypothesis(weakAnalysis, weakAnalysis.groups[1].id) : null

    expect(strongAnalysis.groups).toHaveLength(strongFixture.expectation.groupCount)
    expect(weakAnalysis.groups).toHaveLength(weakFixture.expectation.groupCount)
    expect(strongSequence).toBeTruthy()
    expect((strongSequence?.metrics.inlineAffordanceScore || 0)).toBeGreaterThan(0.6)
    expect(weakSequence?.score || 0).toBeLessThan(strongSequence?.score || 0)
    expect((weakSequence?.metrics.inlineAffordanceScore || 0)).toBeLessThan((strongSequence?.metrics.inlineAffordanceScore || 0))
    expect(weakBarBrick?.family).toBe('fractionBarBrick')
  })

  test('lego-aware sequence contexts only materialize for inline-compatible pairs', async () => {
    const strongAnalysis = analyzeHandwrittenExpression(getHandwritingFixture('sequenceOuterExponent').strokes)
    const weakAnalysis = analyzeHandwrittenExpression(getHandwritingFixture('inlineFractionBarTemptation').strokes)

    const strongSequenceContext = strongAnalysis.contexts.find((context) => context.kind === 'sequence') || null
    const weakSequenceContext = weakAnalysis.contexts.find((context) => context.kind === 'sequence') || null

    expect(strongSequenceContext).toBeTruthy()
    expect(strongSequenceContext?.memberGroupIds.length || 0).toBeGreaterThanOrEqual(3)
    expect(weakSequenceContext).toBeFalsy()
  })

  test('a lone horizontal line is preserved as a provisional fraction bar candidate', async () => {
    const strokes: InkStroke[] = [{
      ...makeStroke('line-only'),
      width: 6,
      points: [
        { x: 112, y: 236, t: 0 },
        { x: 286, y: 236, t: 16 },
      ],
    }]
    const analysis = analyzeHandwrittenExpression(strokes)
    const provisionalBar = analysis.roles.find((role) => role.role === 'provisionalFractionBar')

    expect(analysis.groups).toHaveLength(1)
    expect(provisionalBar).toBeTruthy()
    expect(provisionalBar?.recognizedSymbol?.value).toBe('fraction-bar')
    expect(provisionalBar?.evidence.some((entry) => entry.includes('operand evidence remains incomplete'))).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'unsupportedSymbol')).toBe(false)
  })

  test('a numerator plus bar forms a provisional numerator-bar pair before the denominator appears', async () => {
    const strokes: InkStroke[] = [
      {
        ...makeStroke('num-v'),
        points: [
          { x: 148, y: 170, t: 0 },
          { x: 168, y: 202, t: 16 },
          { x: 188, y: 170, t: 32 },
        ],
      },
      {
        ...makeStroke('bar-only'),
        width: 6,
        points: [
          { x: 116, y: 244, t: 0 },
          { x: 272, y: 244, t: 16 },
        ],
      },
    ]
    const analysis = analyzeHandwrittenExpression(strokes)
    const provisionalBar = analysis.roles.find((role) => role.role === 'provisionalFractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numeratorRoot = getSemanticRootRole(analysis, numeratorContext)

    expect(analysis.groups).toHaveLength(2)
    expect(provisionalBar).toBeTruthy()
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(false)
    expect(numeratorContext).toBeTruthy()
    expect(denominatorContext).toBeFalsy()
    expect(numeratorRoot?.role).toBe('baseline')
    expect(provisionalBar?.evidence.some((entry) => entry.startsWith('provisional-above='))).toBe(true)
  })

  test('a denominator plus bar forms a provisional denominator-bar pair before the numerator appears', async () => {
    const strokes: InkStroke[] = [
      {
        ...makeStroke('bar-only'),
        width: 6,
        points: [
          { x: 116, y: 244, t: 0 },
          { x: 272, y: 244, t: 16 },
        ],
      },
      {
        ...makeStroke('den-v'),
        points: [
          { x: 162, y: 288, t: 0 },
          { x: 182, y: 320, t: 16 },
          { x: 202, y: 288, t: 32 },
        ],
      },
    ]
    const analysis = analyzeHandwrittenExpression(strokes)
    const provisionalBar = analysis.roles.find((role) => role.role === 'provisionalFractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const denominatorRoot = getSemanticRootRole(analysis, denominatorContext)

    expect(analysis.groups).toHaveLength(2)
    expect(provisionalBar).toBeTruthy()
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(false)
    expect(numeratorContext).toBeFalsy()
    expect(denominatorContext).toBeTruthy()
    expect(denominatorRoot?.role).toBe('baseline')
    expect(provisionalBar?.evidence.some((entry) => entry.startsWith('provisional-below='))).toBe(true)
  })

  test('multiple numerator-labeled groups keep their local spacing during fraction normalization', async () => {
    const groups = [
      makeGroup('num-left', { left: 120, top: 150, right: 150, bottom: 188, width: 30, height: 38, centerX: 135, centerY: 169 }),
      makeGroup('num-plus', { left: 176, top: 148, right: 206, bottom: 190, width: 30, height: 42, centerX: 191, centerY: 169 }),
      makeGroup('num-right', { left: 232, top: 150, right: 262, bottom: 188, width: 30, height: 38, centerX: 247, centerY: 169 }),
      makeGroup('bar', { left: 112, top: 232, right: 270, bottom: 238, width: 158, height: 6, centerX: 191, centerY: 235 }),
      makeGroup('den', { left: 174, top: 276, right: 208, bottom: 318, width: 34, height: 42, centerX: 191, centerY: 297 }),
    ]
    const roles = [
      {
        groupId: 'num-left', role: 'numerator', descriptor: getRoleDescriptor('numerator'), score: 0.82, depth: 1, parentGroupId: 'bar', associationContextId: 'context:numerator:num-left', normalizationAnchorGroupIds: ['bar', 'num-left'], containerGroupIds: [], evidence: [],
      },
      {
        groupId: 'num-plus', role: 'numerator', descriptor: getRoleDescriptor('numerator'), score: 0.79, depth: 1, parentGroupId: 'bar', associationContextId: 'context:numerator:num-left', normalizationAnchorGroupIds: ['bar', 'num-left'], containerGroupIds: [], evidence: [],
      },
      {
        groupId: 'num-right', role: 'numerator', descriptor: getRoleDescriptor('numerator'), score: 0.8, depth: 1, parentGroupId: 'bar', associationContextId: 'context:numerator:num-left', normalizationAnchorGroupIds: ['bar', 'num-left'], containerGroupIds: [], evidence: [],
      },
      {
        groupId: 'bar', role: 'fractionBar', descriptor: getRoleDescriptor('fractionBar'), score: 0.9, depth: 0, parentGroupId: null, associationContextId: 'context:root', normalizationAnchorGroupIds: ['bar'], containerGroupIds: [], evidence: [],
      },
      {
        groupId: 'den', role: 'denominator', descriptor: getRoleDescriptor('denominator'), score: 0.82, depth: 1, parentGroupId: 'bar', associationContextId: 'context:denominator:den', normalizationAnchorGroupIds: ['bar', 'den'], containerGroupIds: [], evidence: [],
      },
    ] as const
    const contexts = [
      { id: 'context:root', kind: 'root', parentContextId: null, semanticRootGroupId: null, anchorGroupIds: ['bar'], memberGroupIds: groups.map((group) => group.id) },
      { id: 'context:fraction:bar', kind: 'fraction', parentContextId: 'context:root', semanticRootGroupId: 'bar', anchorGroupIds: ['bar', 'num-left', 'den'], memberGroupIds: groups.map((group) => group.id) },
      { id: 'context:numerator:num-left', kind: 'numerator', parentContextId: 'context:root', semanticRootGroupId: 'num-left', anchorGroupIds: ['bar', 'num-left'], memberGroupIds: ['num-left', 'num-plus', 'num-right'] },
      { id: 'context:denominator:den', kind: 'denominator', parentContextId: 'context:root', semanticRootGroupId: 'den', anchorGroupIds: ['bar', 'den'], memberGroupIds: ['den'] },
    ] as const
    const normalization = normalizeInkLayout(groups, [...roles], [...contexts])
    const normalizedById = new Map(normalization.groups.map((group) => [group.id, group]))

    expect((normalizedById.get('num-plus')?.bounds.centerX || 0)).toBeGreaterThan((normalizedById.get('num-left')?.bounds.centerX || 0) + 24)
    expect((normalizedById.get('num-right')?.bounds.centerX || 0)).toBeGreaterThan((normalizedById.get('num-plus')?.bounds.centerX || 0) + 24)
    expect((normalizedById.get('num-left')?.bounds.bottom || 0)).toBeLessThan((normalizedById.get('bar')?.bounds.top || 0) - 12)
    expect((normalizedById.get('num-right')?.bounds.bottom || 0)).toBeLessThan((normalizedById.get('bar')?.bounds.top || 0) - 12)
  })

  test('composite v-plus-v numerator stays a shared block in real analysis and normalization', async () => {
    const fixture = getHandwritingFixture('fractionCompositeNumerator')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numeratorRoot = getSemanticRootRole(analysis, numeratorContext)
    const denominatorRoot = getSemanticRootRole(analysis, denominatorContext)
    const normalizedById = new Map(analysis.normalization.groups.map((group) => [group.id, group]))
    const normalizedNumeratorMembers = (numeratorContext?.memberGroupIds || [])
      .map((groupId) => ({
        groupId,
        role: analysis.roles.find((role) => role.groupId === groupId) || null,
        normalized: normalizedById.get(groupId) || null,
      }))
      .filter((entry) => entry.normalized)
      .sort((left, right) => (left.normalized?.bounds.centerX || 0) - (right.normalized?.bounds.centerX || 0))
    const normalizedBar = fractionBar ? normalizedById.get(fractionBar.groupId) || null : null
    const vEntries = normalizedNumeratorMembers.filter((entry) => entry.role?.recognizedSymbol?.value === 'v')
    const plusEntry = normalizedNumeratorMembers.find((entry) => entry.role?.recognizedSymbol?.value === '+') || null
    const leftV = vEntries[0] || null
    const rightV = vEntries[1] || null

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
  expect(numeratorContext).toBeTruthy()
  expect(denominatorContext).toBeTruthy()
  expect(numeratorRoot?.role).toBe('baseline')
  expect(denominatorRoot?.role).toBe('baseline')
    expect(numeratorContext?.memberGroupIds).toHaveLength(3)
    expect(leftV?.normalized).toBeTruthy()
    expect(plusEntry?.normalized).toBeTruthy()
    expect(rightV?.normalized).toBeTruthy()
    expect(normalizedBar).toBeTruthy()
    expect((plusEntry?.normalized?.bounds.centerX || 0)).toBeGreaterThan((leftV?.normalized?.bounds.centerX || 0) + 22)
    expect((rightV?.normalized?.bounds.centerX || 0)).toBeGreaterThan((plusEntry?.normalized?.bounds.centerX || 0) + 22)
    expect((leftV?.normalized?.bounds.bottom || 0)).toBeLessThan((normalizedBar?.bounds.top || 0) - 12)
    expect((plusEntry?.normalized?.bounds.bottom || 0)).toBeLessThan((normalizedBar?.bounds.top || 0) - 12)
    expect((rightV?.normalized?.bounds.bottom || 0)).toBeLessThan((normalizedBar?.bounds.top || 0) - 12)
  })

  test('plain inline sequence can act as a broader base for an outer superscript', async () => {
    const fixture = getHandwritingFixture('sequenceOuterExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const outerSuperscript = analysis.roles.find((role) => role.role === 'superscript')
    const sequenceContext = analysis.contexts.find((context) => context.kind === 'sequence')
    const sequenceParseRoot = analysis.parseRoots.find((root) => root.contextId === sequenceContext?.id)
    const outerScriptParseNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.operatorGroupId === outerSuperscript?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(sequenceContext).toBeTruthy()
    expect(sequenceContext?.memberGroupIds.length || 0).toBeGreaterThanOrEqual(3)
    expect(outerSuperscript?.associationContextId).toBe(sequenceContext?.id)
    expect(outerSuperscript?.normalizationAnchorGroupIds).toEqual(expect.arrayContaining(sequenceContext?.anchorGroupIds || []))
    expect(sequenceParseRoot?.rootNodeId?.startsWith('parse:sequence:context:sequence:')).toBe(true)
    expect(outerScriptParseNode?.childNodeIds).toEqual([sequenceParseRoot?.rootNodeId || ''])
  })

  test('plain inline sequence can act as a broader base for an outer subscript', async () => {
    const fixture = getHandwritingFixture('sequenceOuterSubscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const outerSubscript = analysis.roles.find((role) => role.role === 'subscript')
    const sequenceContext = analysis.contexts.find((context) => context.id === outerSubscript?.associationContextId)
    const sequenceParseRoot = analysis.parseRoots.find((root) => root.contextId === sequenceContext?.id)
    const outerScriptParseNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.operatorGroupId === outerSubscript?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(outerSubscript).toBeTruthy()
    expect(sequenceContext).toBeTruthy()
    expect(sequenceContext?.kind).toBe('sequence')
    expect(sequenceContext?.anchorGroupIds.length || 0).toBeGreaterThanOrEqual(2)
    expect(outerSubscript?.associationContextId).toBe(sequenceContext?.id)
    expect(outerSubscript?.normalizationAnchorGroupIds).toEqual(expect.arrayContaining(sequenceContext?.anchorGroupIds || []))
    expect(sequenceParseRoot?.rootNodeId?.startsWith('parse:sequence:context:sequence:')).toBe(true)
    expect(outerScriptParseNode?.childNodeIds).toEqual([sequenceParseRoot?.rootNodeId || ''])
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

  test('later line-like bar stays provisional, keeps the strong superscript pair, and can still seed a numerator interpretation', async () => {
    const fixture = getHandwritingFixture('superscriptThenBar')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const numeratorRoot = getSemanticRootRole(analysis, numeratorContext)
    const superscript = analysis.roles.find((role) => role.role === 'superscript')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'provisionalFractionBar')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'superscript')).toBe(true)
    expect(numeratorContext).toBeTruthy()
    expect(getContextByKind(analysis, 'denominator')).toBeFalsy()
    expect(superscript?.parentGroupId).toBe(numeratorRoot?.groupId)
  })

  test('fraction can claim a local root while preserving its nested exponent', async () => {
    const fixture = getHandwritingFixture('fractionWithExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numeratorRoot = getSemanticRootRole(analysis, numeratorContext)
    const nestedSuperscript = analysis.roles.find((role) => role.role === 'superscript')
    const numeratorContextId = numeratorContext?.id || null
    const numeratorParseRoot = analysis.parseRoots.find((root) => root.contextId === numeratorContextId)
    const fractionParseNode = analysis.parseNodes.find((node) => node.kind === 'fractionExpression')
    const numeratorScriptNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.contextId === numeratorContextId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(true)
    expect(numeratorRoot).toBeTruthy()
    expect(denominatorContext).toBeTruthy()
    expect(numeratorRoot?.role).toBe('baseline')
    expect(nestedSuperscript?.parentGroupId).toBe(numeratorRoot?.groupId)
    expect(numeratorContext?.memberGroupIds).toHaveLength(2)
    expect(numeratorParseRoot?.rootNodeId?.startsWith('parse:sequence:context:numerator:')).toBe(true)
    expect(fractionParseNode?.childNodeIds).toContain(numeratorParseRoot?.rootNodeId || '')
    expect(numeratorScriptNode).toBeTruthy()
  })

  test('bare fraction can act as a broader base for an outer superscript', async () => {
    const fixture = getHandwritingFixture('fractionOuterExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numerator = getSemanticRootRole(analysis, numeratorContext)
    const denominator = getSemanticRootRole(analysis, denominatorContext)
    const outerSuperscript = analysis.roles.find((role) => role.role === 'superscript')
    const fractionContext = analysis.contexts.find((context) => context.kind === 'fraction' && context.semanticRootGroupId === fractionBar?.groupId)
    const fractionParseNode = analysis.parseNodes.find((node) => node.kind === 'fractionExpression' && node.operatorGroupId === fractionBar?.groupId)
    const outerScriptParseNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.operatorGroupId === outerSuperscript?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(fractionBar).toBeTruthy()
    expect(numerator).toBeTruthy()
    expect(denominator).toBeTruthy()
    expect(outerSuperscript).toBeTruthy()
    expect(fractionContext).toBeTruthy()
    expect(outerSuperscript?.associationContextId).toBe(fractionContext?.id)
    expect(outerSuperscript?.normalizationAnchorGroupIds).toEqual(expect.arrayContaining([fractionBar?.groupId || '', numerator?.groupId || '', denominator?.groupId || '']))
    expect(numeratorContext?.memberGroupIds).not.toContain(outerSuperscript?.groupId || '')
    expect(outerScriptParseNode?.childNodeIds).toEqual([fractionParseNode?.id || ''])
    expect(analysis.ambiguities.some((ambiguity) => ambiguity.groupId === outerSuperscript?.groupId && ambiguity.reason === 'fraction-wide-script-vs-baseline')).toBe(true)
    const ambiguityParseNode = analysis.parseNodes.find((node) => node.kind === 'ambiguityExpression' && node.groupIds.includes(outerSuperscript?.groupId || ''))
    expect(ambiguityParseNode).toBeTruthy()
    expect(ambiguityParseNode?.ambiguityReason).toBe('fraction-wide-script-vs-baseline')
    expect(ambiguityParseNode?.preferredChildNodeId).toBe(outerScriptParseNode?.id)
    expect(ambiguityParseNode?.alternatives?.map((alternative) => `${alternative.role}:${alternative.nodeKind}:${alternative.contextId || 'none'}`)).toEqual([
      `superscript:scriptApplication:${fractionContext?.id || 'none'}`,
      'baseline:group:context:root',
    ])
    expect(ambiguityParseNode?.alternatives?.map((alternative) => `${alternative.rank}:${alternative.role}:${alternative.relation}`)).toEqual([
      '1:superscript:chosen',
      '2:baseline:alternative',
    ])
  })

  test('denominator-side outer superscript is also promoted to the whole fraction', async () => {
    const fixture = getHandwritingFixture('fractionDenominatorOuterExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numerator = getSemanticRootRole(analysis, numeratorContext)
    const denominator = getSemanticRootRole(analysis, denominatorContext)
    const outerSuperscript = analysis.roles.find((role) => role.role === 'superscript')
    const fractionContext = analysis.contexts.find((context) => context.kind === 'fraction' && context.semanticRootGroupId === fractionBar?.groupId)
    const fractionParseNode = analysis.parseNodes.find((node) => node.kind === 'fractionExpression' && node.operatorGroupId === fractionBar?.groupId)
    const outerScriptParseNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.operatorGroupId === outerSuperscript?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(fractionBar).toBeTruthy()
    expect(numerator).toBeTruthy()
    expect(denominator).toBeTruthy()
    expect(outerSuperscript).toBeTruthy()
    expect(fractionContext).toBeTruthy()
    expect(outerSuperscript?.associationContextId).toBe(fractionContext?.id)
    expect(outerSuperscript?.normalizationAnchorGroupIds).toEqual(expect.arrayContaining([fractionBar?.groupId || '', numerator?.groupId || '', denominator?.groupId || '']))
    expect(denominatorContext?.memberGroupIds).not.toContain(outerSuperscript?.groupId || '')
    expect(outerScriptParseNode?.childNodeIds).toEqual([fractionParseNode?.id || ''])
  })

  test('bare fraction can act as a broader base for an outer subscript', async () => {
    const fixture = getHandwritingFixture('fractionOuterSubscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numerator = getSemanticRootRole(analysis, numeratorContext)
    const denominator = getSemanticRootRole(analysis, denominatorContext)
    const outerSubscript = analysis.roles.find((role) => role.role === 'subscript')
    const fractionContext = analysis.contexts.find((context) => context.kind === 'fraction' && context.semanticRootGroupId === fractionBar?.groupId)
    const fractionParseNode = analysis.parseNodes.find((node) => node.kind === 'fractionExpression' && node.operatorGroupId === fractionBar?.groupId)
    const outerScriptParseNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.operatorGroupId === outerSubscript?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(fractionBar).toBeTruthy()
    expect(numerator).toBeTruthy()
    expect(denominator).toBeTruthy()
    expect(outerSubscript).toBeTruthy()
    expect(fractionContext).toBeTruthy()
    expect(outerSubscript?.associationContextId).toBe(fractionContext?.id)
    expect(outerSubscript?.normalizationAnchorGroupIds).toEqual(expect.arrayContaining([fractionBar?.groupId || '', numerator?.groupId || '', denominator?.groupId || '']))
    expect(denominatorContext?.memberGroupIds).not.toContain(outerSubscript?.groupId || '')
    expect(outerScriptParseNode?.childNodeIds).toEqual([fractionParseNode?.id || ''])
  })

  test('denominator-side outer subscript is also promoted to the whole fraction', async () => {
    const fixture = getHandwritingFixture('fractionDenominatorOuterSubscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numerator = getSemanticRootRole(analysis, numeratorContext)
    const denominator = getSemanticRootRole(analysis, denominatorContext)
    const outerSubscript = analysis.roles.find((role) => role.role === 'subscript')
    const fractionContext = analysis.contexts.find((context) => context.kind === 'fraction' && context.semanticRootGroupId === fractionBar?.groupId)
    const fractionParseNode = analysis.parseNodes.find((node) => node.kind === 'fractionExpression' && node.operatorGroupId === fractionBar?.groupId)
    const outerScriptParseNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.operatorGroupId === outerSubscript?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(fractionBar).toBeTruthy()
    expect(numerator).toBeTruthy()
    expect(denominator).toBeTruthy()
    expect(outerSubscript).toBeTruthy()
    expect(fractionContext).toBeTruthy()
    expect(outerSubscript?.associationContextId).toBe(fractionContext?.id)
    expect(outerSubscript?.normalizationAnchorGroupIds).toEqual(expect.arrayContaining([fractionBar?.groupId || '', numerator?.groupId || '', denominator?.groupId || '']))
    expect(denominatorContext?.memberGroupIds).not.toContain(outerSubscript?.groupId || '')
    expect(outerScriptParseNode?.childNodeIds).toEqual([fractionParseNode?.id || ''])
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

  test('fraction bar blocks cross-bar script attachment even when the bar itself is recognized strongly', async () => {
    const fixture = getHandwritingFixture('barSeparatedPotentialScript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const incompleteFractionFlag = analysis.flags.find((flag) => flag.kind === 'incompleteFractionStructure')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(fractionBar).toBeTruthy()
    expect(analysis.roles.some((role) => role.role === 'superscript' || role.role === 'subscript')).toBe(false)
    expect(analysis.roles.filter((role) => role.role === 'baseline')).toHaveLength(2)
    expect(incompleteFractionFlag).toBeTruthy()
    expect(analysis.ambiguities.some((ambiguity) => ambiguity.reason === 'sequence-vs-script')).toBe(false)
  })

  test('operator-separated lowercase v stays inline instead of becoming a long-range subscript', async () => {
    const fixture = getHandwritingFixture('operatorSeparatedLowerV')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const plusRole = analysis.roles.find((role) => role.recognizedSymbol?.value === '+')
    const sequenceContext = analysis.contexts.find((context) => context.kind === 'sequence')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'subscript' || role.role === 'superscript')).toBe(false)
    expect(analysis.roles.filter((role) => role.role === 'baseline')).toHaveLength(3)
    expect(plusRole?.recognizedSymbol?.category).toBe('operator')
    expect(sequenceContext?.memberGroupIds).toHaveLength(3)
  })

  test('parenthesized superscript creates an enclosure structure without breaking local script ownership', async () => {
    const fixture = getHandwritingFixture('parenthesizedSuperscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const baseline = analysis.roles.find((role) => role.role === 'baseline')
    const superscript = analysis.roles.find((role) => role.role === 'superscript')
    const openBoundary = analysis.roles.find((role) => role.role === 'enclosureOpen')
    const closeBoundary = analysis.roles.find((role) => role.role === 'enclosureClose')
    const normalizedBaseline = analysis.normalization.groups.find((group) => group.id === baseline?.groupId)
    const normalizedSuperscript = analysis.normalization.groups.find((group) => group.id === superscript?.groupId)
    const normalizedOpen = analysis.normalization.groups.find((group) => group.id === openBoundary?.groupId)
    const normalizedClose = analysis.normalization.groups.find((group) => group.id === closeBoundary?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'enclosureOpen')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'enclosureClose')).toBe(true)
    expect(analysis.enclosures).toHaveLength(1)
    expect(baseline?.containerGroupIds).toHaveLength(2)
    expect(superscript?.parentGroupId).toBe(baseline?.groupId)
    expect(superscript?.containerGroupIds).toHaveLength(2)
    expect(openBoundary?.qualifiedRoleLabel).toBe('enclosureOpen-(')
    expect(closeBoundary?.qualifiedRoleLabel).toBe('enclosureClose-)')
    expect(normalizedBaseline).toBeTruthy()
    expect(normalizedSuperscript).toBeTruthy()
    expect(normalizedOpen).toBeTruthy()
    expect(normalizedClose).toBeTruthy()

    const enclosedContentLeft = normalizedOpen?.bounds.right || 0
    const enclosedContentRight = normalizedClose?.bounds.left || 0
    const enclosedContentTop = Math.max(normalizedOpen?.bounds.top || 0, normalizedClose?.bounds.top || 0)
    const enclosedContentBottom = Math.min(normalizedOpen?.bounds.bottom || 0, normalizedClose?.bounds.bottom || 0)
    const normalizedContentCenterX = ((normalizedBaseline?.bounds.centerX || 0) + (normalizedSuperscript?.bounds.centerX || 0)) / 2
    const normalizedContentCenterY = ((normalizedBaseline?.bounds.centerY || 0) + (normalizedSuperscript?.bounds.centerY || 0)) / 2
    const enclosureCenterX = (enclosedContentLeft + enclosedContentRight) / 2
    const enclosureCenterY = (enclosedContentTop + enclosedContentBottom) / 2
    const contentHeight = Math.max((normalizedBaseline?.bounds.bottom || 0), (normalizedSuperscript?.bounds.bottom || 0)) - Math.min((normalizedBaseline?.bounds.top || 0), (normalizedSuperscript?.bounds.top || 0))
    const enclosureHeight = enclosedContentBottom - enclosedContentTop

    expect(Math.abs(normalizedContentCenterX - enclosureCenterX)).toBeLessThan(18)
    expect(Math.abs(normalizedContentCenterY - enclosureCenterY)).toBeLessThan(22)
    expect(contentHeight).toBeGreaterThan(enclosureHeight * 0.34)
    expect(contentHeight).toBeLessThan(enclosureHeight * 0.88)
  })

  test('outer superscript attaches to the enclosed semantic root rather than an enclosure boundary', async () => {
    const fixture = getHandwritingFixture('parenthesizedExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const baseline = analysis.roles.find((role) => role.role === 'baseline')
    const superscripts = analysis.roles.filter((role) => role.role === 'superscript')
    const outerSuperscript = superscripts.find((role) => role.parentGroupId === baseline?.groupId && role.containerGroupIds.length === 0)
    const enclosureContext = analysis.contexts.find((context) => context.kind === 'enclosure' && context.semanticRootGroupId === baseline?.groupId)
    const enclosureParseRoot = analysis.parseRoots.find((root) => root.contextId === enclosureContext?.id)

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
    expect(analysis.ambiguities.some((ambiguity) => ambiguity.groupId === outerSuperscript?.groupId && ambiguity.reason === 'enclosure-wide-script-vs-baseline')).toBe(true)
    expect(analysis.parseNodes.some((node) => node.kind === 'enclosureExpression')).toBe(true)
    expect(analysis.parseNodes.find((node) => node.kind === 'enclosureExpression')?.childNodeIds).toContain(enclosureParseRoot?.rootNodeId || '')
    expect(analysis.parseNodes.some((node) => node.kind === 'scriptApplication' && node.childNodeIds.some((childId) => childId.startsWith('parse:enclosure:')))).toBe(true)
    const ambiguityParseNode = analysis.parseNodes.find((node) => node.kind === 'ambiguityExpression' && node.groupIds.includes(outerSuperscript?.groupId || ''))
    const outerScriptParseNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.operatorGroupId === outerSuperscript?.groupId)
    expect(ambiguityParseNode).toBeTruthy()
    expect(ambiguityParseNode?.ambiguityReason).toBe('enclosure-wide-script-vs-baseline')
    expect(ambiguityParseNode?.preferredChildNodeId).toBe(outerScriptParseNode?.id)
    expect(ambiguityParseNode?.alternatives?.map((alternative) => `${alternative.role}:${alternative.nodeKind}:${alternative.contextId || 'none'}`)).toEqual([
      `${outerSuperscript?.role || 'superscript'}:scriptApplication:${outerSuperscript?.associationContextId || 'none'}`,
      'baseline:group:context:root',
    ])
    expect(ambiguityParseNode?.alternatives?.map((alternative) => `${alternative.rank}:${alternative.role}:${alternative.relation}`)).toEqual([
      '1:superscript:chosen',
      '2:baseline:alternative',
    ])
    expect(analysis.parseNodes.some((node) => node.kind === 'sequenceExpression' && node.contextId === 'context:root')).toBe(true)
    expect(analysis.parseRoots.find((root) => root.contextId === 'context:root')?.rootNodeId?.startsWith('parse:sequence:')).toBe(true)
  })

  test('enclosed local expression can serve as a fraction numerator while preserving its internal ownership', async () => {
    const fixture = getHandwritingFixture('parenthesizedFractionNumerator')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numerator = getSemanticRootRole(analysis, numeratorContext)
    const superscript = analysis.roles.find((role) => role.role === 'superscript')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.enclosures).toHaveLength(1)
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(true)
    expect(numerator).toBeTruthy()
    expect(denominatorContext).toBeTruthy()
    expect(superscript?.parentGroupId).toBe(numerator?.groupId)
    expect(numerator?.containerGroupIds).toHaveLength(2)
    expect(analysis.parseNodes.some((node) => node.kind === 'fractionExpression')).toBe(true)
    expect(analysis.parseNodes.some((node) => node.kind === 'sequenceExpression' && node.contextId.startsWith('context:enclosure:'))).toBe(true)
  })

  test('parenthesized fraction can act as a local expression root for an outer superscript', async () => {
    const fixture = getHandwritingFixture('parenthesizedFractionExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorContext = getContextByKind(analysis, 'numerator')
    const denominatorContext = getContextByKind(analysis, 'denominator')
    const numerator = getSemanticRootRole(analysis, numeratorContext)
    const denominator = getSemanticRootRole(analysis, denominatorContext)
    const outerSuperscript = analysis.roles.find((role) => role.role === 'superscript' && role.containerGroupIds.length === 0)
    const enclosureContext = analysis.contexts.find((context) => context.kind === 'enclosure')
    const enclosureParseRoot = analysis.parseRoots.find((root) => root.contextId === enclosureContext?.id)
    const numeratorParseRoot = analysis.parseRoots.find((root) => root.contextId === numeratorContext?.id)
    const denominatorParseRoot = analysis.parseRoots.find((root) => root.contextId === denominatorContext?.id)
    const fractionParseNode = analysis.parseNodes.find((node) => node.kind === 'fractionExpression')
    const enclosureParseNode = analysis.parseNodes.find((node) => node.kind === 'enclosureExpression')
    const outerScriptParseNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.role === 'superscript' && node.operatorGroupId === outerSuperscript?.groupId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(fractionBar).toBeTruthy()
    expect(numerator).toBeTruthy()
    expect(denominator).toBeTruthy()
    expect(analysis.enclosures).toHaveLength(1)
    expect(outerSuperscript?.associationContextId).toBe(enclosureContext?.id)
    expect(enclosureParseRoot?.rootNodeId?.startsWith('parse:sequence:context:enclosure:')).toBe(true)
    expect(fractionParseNode?.childNodeIds).toEqual(expect.arrayContaining([
      numeratorParseRoot?.rootNodeId || '',
      denominatorParseRoot?.rootNodeId || '',
    ]))
    expect(enclosureParseNode?.childNodeIds).toEqual([enclosureParseRoot?.rootNodeId || ''])
    expect(outerScriptParseNode?.childNodeIds).toEqual([enclosureParseNode?.id || ''])
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

  test('all unary script roles keep a required parent operand reference', async () => {
    const analyses = [
      'superscript',
      'fractionWithExponent',
      'fractionOuterExponent',
      'fractionDenominatorOuterExponent',
      'fractionOuterSubscript',
      'fractionDenominatorOuterSubscript',
      'offsetLineSubscript',
      'parenthesizedSuperscript',
      'parenthesizedExponent',
      'parenthesizedFractionNumerator',
      'parenthesizedFractionExponent',
    ].map((name) => analyzeHandwrittenExpression(getHandwritingFixture(name as any).strokes))

    expect(analyses.every((analysis) => analysis.roles
      .filter((role) => role.role === 'superscript' || role.role === 'subscript')
      .every((role) => Boolean(role.parentGroupId)))).toBe(true)
    expect(analyses.every((analysis) => analysis.flags.every((flag) => flag.kind !== 'missingOperandReference'))).toBe(true)
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

  test('sequence-vs-script ambiguity is materialized as branch-local parse alternatives', async () => {
    const groups = [
      makeGroup('base', { left: 120, top: 226, right: 166, bottom: 278, width: 46, height: 52, centerX: 143, centerY: 252 }),
      makeGroup('candidate', { left: 201, top: 171, right: 241, bottom: 212, width: 40, height: 41, centerX: 221, centerY: 191.5 }),
    ]
    const edges = [
      makeEdge('base', 'candidate', 'superscriptCandidate', 0.56, { dx: 78, dy: -60.5, sizeRatio: 0.79 }),
      makeEdge('base', 'candidate', 'sequence', 0.47, { dx: 78, dy: -60.5 }),
    ]
    const analysis = inferStructuralRoles(groups, edges)
    const { parseNodes } = buildExpressionParseForest(groups, analysis.roles, analysis.contexts, analysis.enclosures, analysis.ambiguities)
    const ambiguityParseNode = parseNodes.find((node) => node.kind === 'ambiguityExpression' && node.groupIds.includes('candidate') && node.ambiguityReason === 'sequence-vs-script')

    expect(analysis.ambiguities.some((ambiguity) => ambiguity.groupId === 'candidate' && ambiguity.reason === 'sequence-vs-script')).toBe(true)
    expect(ambiguityParseNode).toBeTruthy()
    expect(ambiguityParseNode?.alternatives?.some((alternative) => alternative.role === 'superscript' && alternative.nodeKind === 'scriptApplication')).toBe(true)
    expect(ambiguityParseNode?.alternatives?.some((alternative) => alternative.role === 'baseline' && alternative.nodeKind === 'group' && alternative.contextId === 'context:root')).toBe(true)
  })

  test('sequence parse roots follow LEGO occupancy chain order', async () => {
    const groups = [
      makeGroup('a', { left: 100, top: 220, right: 132, bottom: 264, width: 32, height: 44, centerX: 116, centerY: 242 }),
      makeGroup('b', { left: 146, top: 220, right: 178, bottom: 264, width: 32, height: 44, centerX: 162, centerY: 242 }),
      makeGroup('c', { left: 192, top: 220, right: 224, bottom: 264, width: 32, height: 44, centerX: 208, centerY: 242 }),
    ]
    const roles: StructuralRole[] = groups.map((groupId) => ({
      groupId: groupId.id,
      role: 'baseline',
      descriptor: getRoleDescriptor('baseline'),
      score: 0.7,
      depth: 0,
      parentGroupId: null,
      associationContextId: 'context:sequence:test',
      normalizationAnchorGroupIds: [groupId.id],
      containerGroupIds: [],
      evidence: [],
    }))
    const contexts: ExpressionContext[] = [
      {
        id: 'context:root',
        kind: 'root',
        parentContextId: null,
        semanticRootGroupId: null,
        anchorGroupIds: ['a'],
        memberGroupIds: ['a', 'b', 'c'],
      },
      {
        id: 'context:sequence:test',
        kind: 'sequence',
        parentContextId: 'context:root',
        semanticRootGroupId: 'a',
        anchorGroupIds: ['a', 'b', 'c'],
        memberGroupIds: ['a', 'b', 'c'],
      },
    ]
    const occupancies: LegoBrickOccupancy[] = [
      { groupId: 'a', family: 'ordinaryBaselineSymbolBrick', field: 'center', score: 0.8, hostGroupId: null, hostContextId: 'context:sequence:test', evidence: [] },
      { groupId: 'c', family: 'ordinaryBaselineSymbolBrick', field: 'rightInline', score: 0.8, hostGroupId: 'a', hostContextId: 'context:sequence:test', evidence: [] },
      { groupId: 'b', family: 'ordinaryBaselineSymbolBrick', field: 'rightInline', score: 0.8, hostGroupId: 'c', hostContextId: 'context:sequence:test', evidence: [] },
    ]

    const { parseNodes, parseRoots } = buildExpressionParseForest(groups, roles, contexts, [], [], occupancies)
    const sequenceParseRoot = parseRoots.find((root) => root.contextId === 'context:sequence:test')
    const sequenceNode = parseNodes.find((node) => node.id === sequenceParseRoot?.rootNodeId)

    expect(sequenceNode?.childNodeIds).toEqual(['parse:group:a', 'parse:group:c', 'parse:group:b'])
  })

  test('fraction numerator parse roots follow LEGO occupancy chain order', async () => {
    const groups = [
      makeGroup('a', { left: 100, top: 150, right: 132, bottom: 194, width: 32, height: 44, centerX: 116, centerY: 172 }),
      makeGroup('b', { left: 146, top: 150, right: 178, bottom: 194, width: 32, height: 44, centerX: 162, centerY: 172 }),
      makeGroup('c', { left: 192, top: 150, right: 224, bottom: 194, width: 32, height: 44, centerX: 208, centerY: 172 }),
      makeGroup('bar', { left: 92, top: 214, right: 232, bottom: 224, width: 140, height: 10, centerX: 162, centerY: 219 }),
      makeGroup('d', { left: 150, top: 246, right: 182, bottom: 290, width: 32, height: 44, centerX: 166, centerY: 268 }),
    ]
    const roles: StructuralRole[] = [
      {
        groupId: 'a',
        role: 'baseline',
        descriptor: getRoleDescriptor('baseline'),
        score: 0.7,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:numerator:test',
        hostedContextKind: 'numerator',
        hostedContextId: 'context:numerator:test',
        normalizationAnchorGroupIds: ['a'],
        containerGroupIds: [],
        evidence: [],
      },
      {
        groupId: 'b',
        role: 'baseline',
        descriptor: getRoleDescriptor('baseline'),
        score: 0.7,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:numerator:test',
        hostedContextKind: 'numerator',
        hostedContextId: 'context:numerator:test',
        normalizationAnchorGroupIds: ['b'],
        containerGroupIds: [],
        evidence: [],
      },
      {
        groupId: 'c',
        role: 'baseline',
        descriptor: getRoleDescriptor('baseline'),
        score: 0.7,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:numerator:test',
        hostedContextKind: 'numerator',
        hostedContextId: 'context:numerator:test',
        normalizationAnchorGroupIds: ['c'],
        containerGroupIds: [],
        evidence: [],
      },
      {
        groupId: 'bar',
        role: 'fractionBar',
        descriptor: getRoleDescriptor('fractionBar'),
        score: 0.92,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:root',
        normalizationAnchorGroupIds: ['bar'],
        containerGroupIds: [],
        evidence: [],
      },
      {
        groupId: 'd',
        role: 'baseline',
        descriptor: getRoleDescriptor('baseline'),
        score: 0.7,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:denominator:test',
        hostedContextKind: 'denominator',
        hostedContextId: 'context:denominator:test',
        normalizationAnchorGroupIds: ['d'],
        containerGroupIds: [],
        evidence: [],
      },
    ]
    const contexts: ExpressionContext[] = [
      {
        id: 'context:root',
        kind: 'root',
        parentContextId: null,
        semanticRootGroupId: 'bar',
        anchorGroupIds: ['bar'],
        memberGroupIds: ['bar'],
      },
      {
        id: 'context:fraction:bar',
        kind: 'fraction',
        parentContextId: 'context:root',
        semanticRootGroupId: 'bar',
        anchorGroupIds: ['bar'],
        memberGroupIds: ['bar', 'a', 'b', 'c', 'd'],
      },
      {
        id: 'context:numerator:test',
        kind: 'numerator',
        parentContextId: 'context:fraction:bar',
        semanticRootGroupId: 'a',
        anchorGroupIds: ['a', 'b', 'c'],
        memberGroupIds: ['a', 'b', 'c'],
      },
      {
        id: 'context:denominator:test',
        kind: 'denominator',
        parentContextId: 'context:fraction:bar',
        semanticRootGroupId: 'd',
        anchorGroupIds: ['d'],
        memberGroupIds: ['d'],
      },
    ]
    const occupancies: LegoBrickOccupancy[] = [
      { groupId: 'a', family: 'ordinaryBaselineSymbolBrick', field: 'over', score: 0.8, hostGroupId: 'bar', hostContextId: 'context:numerator:test', evidence: [] },
      { groupId: 'c', family: 'ordinaryBaselineSymbolBrick', field: 'rightInline', score: 0.8, hostGroupId: 'a', hostContextId: 'context:numerator:test', evidence: [] },
      { groupId: 'b', family: 'ordinaryBaselineSymbolBrick', field: 'rightInline', score: 0.8, hostGroupId: 'c', hostContextId: 'context:numerator:test', evidence: [] },
      { groupId: 'bar', family: 'fractionBarBrick', field: 'center', score: 0.92, hostGroupId: null, hostContextId: 'context:root', evidence: [] },
      { groupId: 'd', family: 'ordinaryBaselineSymbolBrick', field: 'under', score: 0.8, hostGroupId: 'bar', hostContextId: 'context:denominator:test', evidence: [] },
    ]

    const { parseNodes, parseRoots } = buildExpressionParseForest(groups, roles, contexts, [], [], occupancies)
    const numeratorParseRoot = parseRoots.find((root) => root.contextId === 'context:numerator:test')
    const numeratorSequenceNode = parseNodes.find((node) => node.id === numeratorParseRoot?.rootNodeId)
    const fractionNode = parseNodes.find((node) => node.id === 'parse:fraction:bar')

    expect(numeratorSequenceNode?.childNodeIds).toEqual(['parse:group:a', 'parse:group:c', 'parse:group:b'])
    expect(fractionNode?.childNodeIds[0]).toBe(numeratorSequenceNode?.id)
  })

  test('radical expression consumes hosted index and radicand roots', async () => {
    const groups = [
      makeGroup('index', { left: 88, top: 152, right: 120, bottom: 188, width: 32, height: 36, centerX: 104, centerY: 170 }),
      makeGroup('radical', { left: 120, top: 160, right: 244, bottom: 252, width: 124, height: 92, centerX: 182, centerY: 206 }),
      makeGroup('radicand-a', { left: 210, top: 214, right: 242, bottom: 258, width: 32, height: 44, centerX: 226, centerY: 236 }),
      makeGroup('radicand-b', { left: 256, top: 214, right: 288, bottom: 258, width: 32, height: 44, centerX: 272, centerY: 236 }),
    ]
    const roles: StructuralRole[] = [
      {
        groupId: 'index',
        role: 'baseline',
        descriptor: getRoleDescriptor('baseline'),
        score: 0.72,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:radicalIndex:index',
        hostedContextKind: 'radicalIndex',
        hostedContextId: 'context:radicalIndex:index',
        normalizationAnchorGroupIds: ['index'],
        containerGroupIds: [],
        evidence: [],
      },
      {
        groupId: 'radical',
        role: 'radical',
        descriptor: getRoleDescriptor('radical'),
        score: 0.84,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:root',
        normalizationAnchorGroupIds: ['radical'],
        containerGroupIds: [],
        evidence: [],
      },
      {
        groupId: 'radicand-a',
        role: 'baseline',
        descriptor: getRoleDescriptor('baseline'),
        score: 0.72,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:radicand:radicand-a',
        hostedContextKind: 'radicand',
        hostedContextId: 'context:radicand:radicand-a',
        normalizationAnchorGroupIds: ['radicand-a'],
        containerGroupIds: [],
        evidence: [],
      },
      {
        groupId: 'radicand-b',
        role: 'baseline',
        descriptor: getRoleDescriptor('baseline'),
        score: 0.72,
        depth: 0,
        parentGroupId: null,
        associationContextId: 'context:radicand:radicand-a',
        hostedContextKind: 'radicand',
        hostedContextId: 'context:radicand:radicand-a',
        normalizationAnchorGroupIds: ['radicand-b'],
        containerGroupIds: [],
        evidence: [],
      },
    ]
    const contexts: ExpressionContext[] = [
      {
        id: 'context:root',
        kind: 'root',
        parentContextId: null,
        semanticRootGroupId: 'radical',
        anchorGroupIds: ['radical'],
        memberGroupIds: ['radical'],
      },
      {
        id: 'context:radical:radical',
        kind: 'radical',
        parentContextId: 'context:root',
        semanticRootGroupId: 'radical',
        anchorGroupIds: ['radical', 'index', 'radicand-a'],
        memberGroupIds: ['index', 'radical', 'radicand-a', 'radicand-b'],
      },
      {
        id: 'context:radicalIndex:index',
        kind: 'radicalIndex',
        parentContextId: 'context:radical:radical',
        semanticRootGroupId: 'index',
        anchorGroupIds: ['radical', 'index'],
        memberGroupIds: ['index'],
      },
      {
        id: 'context:radicand:radicand-a',
        kind: 'radicand',
        parentContextId: 'context:radical:radical',
        semanticRootGroupId: 'radicand-a',
        anchorGroupIds: ['radical', 'radicand-a'],
        memberGroupIds: ['radicand-a', 'radicand-b'],
      },
    ]
    const occupancies: LegoBrickOccupancy[] = [
      { groupId: 'index', family: 'ordinaryBaselineSymbolBrick', field: 'upperLeftScript', score: 0.74, hostGroupId: 'radical', hostContextId: 'context:radicalIndex:index', evidence: [] },
      { groupId: 'radical', family: 'radicalBrick', field: 'center', score: 0.84, hostGroupId: null, hostContextId: 'context:root', evidence: [] },
      { groupId: 'radicand-a', family: 'ordinaryBaselineSymbolBrick', field: 'interior', score: 0.78, hostGroupId: 'radical', hostContextId: 'context:radicand:radicand-a', evidence: [] },
      { groupId: 'radicand-b', family: 'ordinaryBaselineSymbolBrick', field: 'rightInline', score: 0.78, hostGroupId: 'radicand-a', hostContextId: 'context:radicand:radicand-a', evidence: [] },
    ]

    const { parseNodes, parseRoots } = buildExpressionParseForest(groups, roles, contexts, [], [], occupancies)
    const radicandParseRoot = parseRoots.find((root) => root.contextId === 'context:radicand:radicand-a')
    const radicandSequenceNode = parseNodes.find((node) => node.id === radicandParseRoot?.rootNodeId)
    const radicalNode = parseNodes.find((node) => node.id === 'parse:radical:radical')

    expect(radicandSequenceNode?.childNodeIds).toEqual(['parse:group:radicand-a', 'parse:group:radicand-b'])
    expect(radicandParseRoot?.assemblyStrategy).toBe('occupancyOrdered')
    expect(radicalNode?.childNodeIds).toEqual(['parse:sequence:context:radicalIndex:index', 'parse:sequence:context:radicand:radicand-a'])
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

  test('seeded symbol recognizer covers radical, greek pi, and baseline four prototypes', async () => {
    const radicalGroup = makeGroup('radical', { left: 120, top: 160, right: 244, bottom: 252, width: 124, height: 92, centerX: 182, centerY: 206 })
    radicalGroup.strokes = [{
      ...makeStroke('radical-stroke'),
      points: [
        { x: 120, y: 206, t: 0 },
        { x: 140, y: 230, t: 16 },
        { x: 168, y: 176, t: 32 },
        { x: 204, y: 164, t: 48 },
        { x: 244, y: 164, t: 64 },
      ],
    }]
    const piGroup = makeGroup('pi', { left: 120, top: 150, right: 234, bottom: 246, width: 114, height: 96, centerX: 177, centerY: 198 })
    piGroup.strokes = [
      { ...makeStroke('pi-top'), points: [{ x: 120, y: 158, t: 0 }, { x: 234, y: 158, t: 16 }] },
      { ...makeStroke('pi-left'), points: [{ x: 144, y: 158, t: 0 }, { x: 144, y: 246, t: 16 }] },
      { ...makeStroke('pi-right'), points: [{ x: 210, y: 158, t: 0 }, { x: 210, y: 246, t: 16 }] },
    ]
    const fourFixture = analyzeHandwrittenExpression(getHandwritingFixture('crossingFour').strokes)
    const fourRole = fourFixture.roles[0]

    expect(recognizeSymbolForRole(radicalGroup, {
      groupId: 'radical', role: 'baseline', descriptor: getRoleDescriptor('baseline'), score: 0.6, depth: 0, parentGroupId: null, associationContextId: 'context:root', normalizationAnchorGroupIds: ['radical'], containerGroupIds: [], evidence: [],
    }).value).toBe('√')
    expect(recognizeSymbolForRole(piGroup, {
      groupId: 'pi', role: 'baseline', descriptor: getRoleDescriptor('baseline'), score: 0.6, depth: 0, parentGroupId: null, associationContextId: 'context:root', normalizationAnchorGroupIds: ['pi'], containerGroupIds: [], evidence: [],
    }).value).toBe('π')
    expect(fourRole?.qualifiedRoleLabel).toBe('baseline-4')
  })
})