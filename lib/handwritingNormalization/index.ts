import { getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, listHandwritingFixtures } from './fixtures'
import { analyzeHandwrittenExpressionIteratively } from './refinement'
import type { HandwritingAnalysis, InkStroke } from './types'

export * from './types'
export * from './diagnostics'
export * from './legoModel'
export * from './refinement'
export * from './roleTaxonomy'
export * from './symbolRecognition'
export type { HandwritingFixture, HandwritingFixtureDiagnostics, HandwritingFixtureExpectation, HandwritingFixtureName } from './fixtures'
export { getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, listHandwritingFixtures }

export const analyzeHandwrittenExpression = (strokes: InkStroke[]): HandwritingAnalysis => analyzeHandwrittenExpressionIteratively(strokes)