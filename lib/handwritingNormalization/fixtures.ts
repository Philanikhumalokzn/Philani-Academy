import type { InkStroke, StructuralRoleKind } from './types'

export type HandwritingFixtureName = 'superscript' | 'fraction' | 'nested' | 'adjacentAmbiguous' | 'crossingFour'

export type HandwritingFixtureExpectation = {
  groupCount: number
  requiredRoles: StructuralRoleKind[]
  minAmbiguities?: number
}

export type HandwritingFixture = {
  name: HandwritingFixtureName
  label: string
  description: string
  strokes: InkStroke[]
  expectation: HandwritingFixtureExpectation
}

const makeStroke = (id: string, points: Array<[number, number]>, width = 4): InkStroke => ({
  id,
  width,
  color: '#e6eefc',
  startedAt: 0,
  endedAt: 0,
  points: points.map(([x, y], index) => ({ x, y, t: index * 16 })),
})

const fixtures: Record<HandwritingFixtureName, HandwritingFixture> = {
  superscript: {
    name: 'superscript',
    label: 'x² sample',
    description: 'Two crossing base strokes with a smaller stroke-group above-right.',
    strokes: [
      makeStroke('x-1', [[120, 240], [155, 285]]),
      makeStroke('x-2', [[156, 240], [120, 285]]),
      makeStroke('two-1', [[205, 165], [232, 145], [256, 150], [254, 172], [216, 193], [258, 193]]),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline', 'superscript'] },
  },
  fraction: {
    name: 'fraction',
    label: 'Fraction sample',
    description: 'Simple numerator, bar, and denominator layout.',
    strokes: [
      makeStroke('top-1', [[125, 165], [152, 192], [178, 165]]),
      makeStroke('plus-1', [[210, 155], [210, 195]]),
      makeStroke('plus-2', [[190, 175], [228, 175]]),
      makeStroke('top-2', [[258, 155], [286, 195], [312, 155]]),
      makeStroke('bar-1', [[118, 232], [324, 232]], 6),
      makeStroke('bottom-1', [[175, 278], [205, 318], [236, 278]]),
    ],
    expectation: { groupCount: 5, requiredRoles: ['fractionBar', 'numerator', 'denominator'] },
  },
  nested: {
    name: 'nested',
    label: 'Nested superscript sample',
    description: 'A baseline with an exponent and a second exponent of that exponent.',
    strokes: [
      makeStroke('base-1', [[110, 248], [146, 282]]),
      makeStroke('base-2', [[145, 246], [110, 284]]),
      makeStroke('inner-1', [[202, 180], [228, 160], [252, 166], [245, 188], [210, 206], [254, 207]]),
      makeStroke('outer-1', [[287, 126], [309, 111], [330, 116], [322, 133], [295, 148], [334, 149]]),
    ],
    expectation: { groupCount: 3, requiredRoles: ['baseline', 'superscript'] },
  },
  adjacentAmbiguous: {
    name: 'adjacentAmbiguous',
    label: 'Ambiguous x2 sample',
    description: 'A small right-side group that could be read as adjacency or superscript.',
    strokes: [
      makeStroke('x-1', [[128, 232], [165, 276]]),
      makeStroke('x-2', [[164, 234], [130, 277]]),
      makeStroke('two-1', [[196, 220], [225, 206], [249, 212], [246, 232], [211, 244], [247, 244]]),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline'] },
  },
  crossingFour: {
    name: 'crossingFour',
    label: 'Crossing 4 sample',
    description: 'Two visibly overlapping strokes that should be treated as one handwritten symbol.',
    strokes: [
      makeStroke('four-l', [[130, 270], [176, 222], [176, 300]]),
      makeStroke('four-v', [[150, 218], [150, 304]]),
    ],
    expectation: { groupCount: 1, requiredRoles: ['baseline'] },
  },
}

export const HANDWRITING_FIXTURE_ORDER: HandwritingFixtureName[] = ['superscript', 'fraction', 'nested', 'adjacentAmbiguous', 'crossingFour']

export const getHandwritingFixture = (name: HandwritingFixtureName) => {
  const fixture = fixtures[name]
  const baseNow = Date.now()
  return {
    ...fixture,
    strokes: fixture.strokes.map((stroke, index) => ({
      ...stroke,
      id: `${name}-${stroke.id}`,
      startedAt: baseNow + index * 32,
      endedAt: baseNow + index * 32 + 22,
      points: stroke.points.map((point, pointIndex) => ({ ...point, t: baseNow + index * 32 + pointIndex * 9 })),
    })),
  }
}

export const listHandwritingFixtures = () => HANDWRITING_FIXTURE_ORDER.map((name) => getHandwritingFixture(name))