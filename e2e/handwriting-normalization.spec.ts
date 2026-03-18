import { expect, test } from '@playwright/test'

import { analyzeHandwrittenExpression, getHandwritingFixture, getRoleDescriptor, recognizeSymbolForRole, roleAllowsChildRole } from '../lib/handwritingNormalization'
import { normalizeInkLayout } from '../lib/handwritingNormalization/normalize'
import { buildExpressionParseForest } from '../lib/handwritingNormalization/parser'
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

test.describe('handwriting normalization fixtures', () => {
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

  test('fraction fixture recognizes fraction structure', async () => {
    const fixture = getHandwritingFixture('fraction')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const barRole = analysis.roles.find((role) => role.role === 'fractionBar')
    const numerator = analysis.roles.find((role) => role.role === 'numerator')
    const numeratorAmbiguityParseNode = analysis.parseNodes.find((node) => node.kind === 'ambiguityExpression' && node.groupIds.includes(numerator?.groupId || '') && node.ambiguityReason === 'fraction-membership')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(barRole).toBeTruthy()
    expect(barRole?.descriptor.family).toBe('fractionStructure')
    expect(analysis.roles.some((role) => role.role === 'numerator')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(true)
    expect(numeratorAmbiguityParseNode).toBeTruthy()
    expect(numeratorAmbiguityParseNode?.alternatives?.map((alternative) => `${alternative.role}:${alternative.nodeKind}:${alternative.contextId || 'none'}`)).toEqual([
      `numerator:group:context:numerator:${numerator?.groupId || 'none'}`,
      'baseline:group:context:root',
    ])
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

    expect(analysis.groups).toHaveLength(2)
    expect(provisionalBar).toBeTruthy()
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(false)
    expect(analysis.roles.some((role) => role.role === 'numerator')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(false)
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

    expect(analysis.groups).toHaveLength(2)
    expect(provisionalBar).toBeTruthy()
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(false)
    expect(analysis.roles.some((role) => role.role === 'numerator')).toBe(false)
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(true)
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
    const numeratorRoles = analysis.roles.filter((role) => role.role === 'numerator')
    const denominatorRoles = analysis.roles.filter((role) => role.role === 'denominator')
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numeratorContext = analysis.contexts.find((context) => context.kind === 'numerator')
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
    expect(numeratorRoles).toHaveLength(1)
    expect(denominatorRoles).toHaveLength(1)
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
    const numerator = analysis.roles.find((role) => role.role === 'numerator')
    const superscript = analysis.roles.find((role) => role.role === 'superscript')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'provisionalFractionBar')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'superscript')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'numerator')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(false)
    expect(superscript?.parentGroupId).toBe(numerator?.groupId)
  })

  test('fraction can claim a local root while preserving its nested exponent', async () => {
    const fixture = getHandwritingFixture('fractionWithExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const numeratorRoot = analysis.roles.find((role) => role.role === 'numerator')
    const nestedSuperscript = analysis.roles.find((role) => role.role === 'superscript')
    const numeratorContextId = numeratorRoot ? `context:numerator:${numeratorRoot.groupId}` : null
    const numeratorParseRoot = analysis.parseRoots.find((root) => root.contextId === numeratorContextId)
    const fractionParseNode = analysis.parseNodes.find((node) => node.kind === 'fractionExpression')
    const numeratorScriptNode = analysis.parseNodes.find((node) => node.kind === 'scriptApplication' && node.contextId === numeratorContextId)

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'fractionBar')).toBe(true)
    expect(numeratorRoot).toBeTruthy()
    expect(analysis.roles.some((role) => role.role === 'denominator')).toBe(true)
    expect(nestedSuperscript?.parentGroupId).toBe(numeratorRoot?.groupId)
    expect(analysis.subexpressions.some((subexpression) => subexpression.rootGroupId === numeratorRoot?.groupId && subexpression.memberGroupIds.length === 2 && subexpression.rootRole === 'numerator')).toBe(true)
    expect(numeratorParseRoot?.rootNodeId?.startsWith('parse:sequence:context:numerator:')).toBe(true)
    expect(fractionParseNode?.childNodeIds).toContain(numeratorParseRoot?.rootNodeId || '')
    expect(numeratorScriptNode).toBeTruthy()
  })

  test('bare fraction can act as a broader base for an outer superscript', async () => {
    const fixture = getHandwritingFixture('fractionOuterExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numerator = analysis.roles.find((role) => role.role === 'numerator')
    const denominator = analysis.roles.find((role) => role.role === 'denominator')
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
    expect(analysis.contexts.find((context) => context.id === `context:numerator:${numerator?.groupId}`)?.memberGroupIds).not.toContain(outerSuperscript?.groupId || '')
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
    const numerator = analysis.roles.find((role) => role.role === 'numerator')
    const denominator = analysis.roles.find((role) => role.role === 'denominator')
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
    expect(analysis.contexts.find((context) => context.id === `context:denominator:${denominator?.groupId}`)?.memberGroupIds).not.toContain(outerSuperscript?.groupId || '')
    expect(outerScriptParseNode?.childNodeIds).toEqual([fractionParseNode?.id || ''])
  })

  test('bare fraction can act as a broader base for an outer subscript', async () => {
    const fixture = getHandwritingFixture('fractionOuterSubscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numerator = analysis.roles.find((role) => role.role === 'numerator')
    const denominator = analysis.roles.find((role) => role.role === 'denominator')
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
    expect(analysis.contexts.find((context) => context.id === `context:denominator:${denominator?.groupId}`)?.memberGroupIds).not.toContain(outerSubscript?.groupId || '')
    expect(outerScriptParseNode?.childNodeIds).toEqual([fractionParseNode?.id || ''])
  })

  test('denominator-side outer subscript is also promoted to the whole fraction', async () => {
    const fixture = getHandwritingFixture('fractionDenominatorOuterSubscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numerator = analysis.roles.find((role) => role.role === 'numerator')
    const denominator = analysis.roles.find((role) => role.role === 'denominator')
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
    expect(analysis.contexts.find((context) => context.id === `context:denominator:${denominator?.groupId}`)?.memberGroupIds).not.toContain(outerSubscript?.groupId || '')
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

  test('parenthesized superscript creates an enclosure structure without breaking local script ownership', async () => {
    const fixture = getHandwritingFixture('parenthesizedSuperscript')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const baseline = analysis.roles.find((role) => role.role === 'baseline')
    const superscript = analysis.roles.find((role) => role.role === 'superscript')
    const openBoundary = analysis.roles.find((role) => role.role === 'enclosureOpen')
    const closeBoundary = analysis.roles.find((role) => role.role === 'enclosureClose')

    expect(analysis.groups).toHaveLength(fixture.expectation.groupCount)
    expect(analysis.roles.some((role) => role.role === 'enclosureOpen')).toBe(true)
    expect(analysis.roles.some((role) => role.role === 'enclosureClose')).toBe(true)
    expect(analysis.enclosures).toHaveLength(1)
    expect(baseline?.containerGroupIds).toHaveLength(2)
    expect(superscript?.parentGroupId).toBe(baseline?.groupId)
    expect(superscript?.containerGroupIds).toHaveLength(2)
    expect(openBoundary?.qualifiedRoleLabel).toBe('enclosureOpen-(')
    expect(closeBoundary?.qualifiedRoleLabel).toBe('enclosureClose-)')
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
    expect(analysis.parseNodes.some((node) => node.kind === 'sequenceExpression' && node.contextId.startsWith('context:enclosure:'))).toBe(true)
  })

  test('parenthesized fraction can act as a local expression root for an outer superscript', async () => {
    const fixture = getHandwritingFixture('parenthesizedFractionExponent')
    const analysis = analyzeHandwrittenExpression(fixture.strokes)
    const fractionBar = analysis.roles.find((role) => role.role === 'fractionBar')
    const numerator = analysis.roles.find((role) => role.role === 'numerator')
    const denominator = analysis.roles.find((role) => role.role === 'denominator')
    const outerSuperscript = analysis.roles.find((role) => role.role === 'superscript' && role.containerGroupIds.length === 0)
    const enclosureContext = analysis.contexts.find((context) => context.kind === 'enclosure')
    const enclosureParseRoot = analysis.parseRoots.find((root) => root.contextId === enclosureContext?.id)
    const numeratorParseRoot = analysis.parseRoots.find((root) => root.contextId === `context:numerator:${numerator?.groupId}`)
    const denominatorParseRoot = analysis.parseRoots.find((root) => root.contextId === `context:denominator:${denominator?.groupId}`)
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