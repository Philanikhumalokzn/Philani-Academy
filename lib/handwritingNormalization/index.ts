import { buildLayoutGraph } from './graph'
import { getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, listHandwritingFixtures } from './fixtures'
import { groupInkStrokes } from './grouping'
import { normalizeInkLayout } from './normalize'
import { buildExpressionParseForest } from './parser'
import { inferStructuralRoles } from './roles'
import type { HandwritingAnalysis, InkStroke } from './types'

export * from './types'
export * from './roleTaxonomy'
export type { HandwritingFixture, HandwritingFixtureExpectation, HandwritingFixtureName } from './fixtures'
export { getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, listHandwritingFixtures }

export const analyzeHandwrittenExpression = (strokes: InkStroke[]): HandwritingAnalysis => {
  const groups = groupInkStrokes(strokes)
  const edges = buildLayoutGraph(groups)
  const { roles, ambiguities, flags, subexpressions, enclosures, contexts } = inferStructuralRoles(groups, edges)
  const { parseNodes, parseRoots } = buildExpressionParseForest(groups, roles, contexts, enclosures)
  const normalization = normalizeInkLayout(groups, roles)
  return { groups, edges, roles, ambiguities, flags, subexpressions, enclosures, contexts, parseNodes, parseRoots, normalization }
}