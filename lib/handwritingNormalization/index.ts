import { buildLayoutGraph } from './graph'
import { getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, listHandwritingFixtures } from './fixtures'
import { groupInkStrokes } from './grouping'
import { inferLegoBrickHypotheses, inferLegoBrickOccupancies } from './legoModel'
import { normalizeInkLayout } from './normalize'
import { buildExpressionParseForest } from './parser'
import { inferStructuralRoles } from './roles'
import type { HandwritingAnalysis, InkStroke } from './types'

export * from './types'
export * from './legoModel'
export * from './roleTaxonomy'
export * from './symbolRecognition'
export type { HandwritingFixture, HandwritingFixtureExpectation, HandwritingFixtureName } from './fixtures'
export { getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, listHandwritingFixtures }

export const analyzeHandwrittenExpression = (strokes: InkStroke[]): HandwritingAnalysis => {
  const groups = groupInkStrokes(strokes)
  const brickHypotheses = inferLegoBrickHypotheses(groups)
  const edges = buildLayoutGraph(groups, brickHypotheses)
  const { roles, ambiguities, flags, subexpressions, enclosures, contexts } = inferStructuralRoles(groups, edges, brickHypotheses)
  const brickOccupancies = inferLegoBrickOccupancies(brickHypotheses, roles, contexts, edges)
  const { parseNodes, parseRoots } = buildExpressionParseForest(groups, roles, contexts, enclosures, ambiguities)
  const normalization = normalizeInkLayout(groups, roles, contexts)
  return { groups, edges, brickHypotheses, brickOccupancies, roles, ambiguities, flags, subexpressions, enclosures, contexts, parseNodes, parseRoots, normalization }
}