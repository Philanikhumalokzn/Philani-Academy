import { getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, listHandwritingFixtures } from './fixtures'
import { analyzeHandwrittenExpressionIteratively } from './refinement'
import type { HandwritingAnalysis, HandwritingAnalysisOptions, InkStroke } from './types'

export * from './types'
export * from './diagnostics'
export * from './legoModel'
export * from './refinement'
export * from './roleTaxonomy'
export * from './symbolRecognition'
export type { HandwritingFixture, HandwritingFixtureDiagnostics, HandwritingFixtureExpectation, HandwritingFixtureName } from './fixtures'
export { getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, listHandwritingFixtures }

export const analyzeHandwrittenExpression = (strokes: InkStroke[], options?: HandwritingAnalysisOptions): HandwritingAnalysis => analyzeHandwrittenExpressionIteratively(strokes, options)