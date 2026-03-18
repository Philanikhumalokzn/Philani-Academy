import type { InkStroke, StructuralRoleKind } from './types'

export type HandwritingFixtureName = 'superscript' | 'fraction' | 'nested' | 'adjacentAmbiguous' | 'crossingFour' | 'superscriptThenBar' | 'fractionWithExponent' | 'fractionOuterExponent' | 'fractionDenominatorOuterExponent' | 'fractionOuterSubscript' | 'fractionDenominatorOuterSubscript' | 'offsetLineSubscript' | 'barSeparatedPotentialScript' | 'operatorSeparatedLowerV' | 'operatorSeparatedUpperTwo' | 'parenthesizedSuperscript' | 'parenthesizedExponent' | 'parenthesizedFractionNumerator' | 'parenthesizedFractionExponent' | 'parenthesizedFractionSubscript' | 'fractionCompositeNumerator' | 'sequenceOuterExponent' | 'sequenceOuterSubscript' | 'inlineOrdinaryPair' | 'inlineFractionBarTemptation' | 'radicalWithIndex' | 'stackedBaselinesUnsupported' | 'digitTwoSuperscriptSeven' | 'digitFiveRadicalTemptation' | 'digitTwoRadicalTemptation' | 'shortBarSuperscript' | 'shortBarSubscript' | 'compactTBaseline' | 'compactTSuperscript' | 'radicalLooseRoof' | 'tightFractionBar'

export type HandwritingFixtureExpectation = {
  groupCount: number
  requiredRoles: StructuralRoleKind[]
  minAmbiguities?: number
}

export type HandwritingFixtureDiagnostics = {
  recordTopBrickFamilies?: boolean
  recordStructuralRoles?: boolean
}

export type HandwritingFixture = {
  name: HandwritingFixtureName
  label: string
  description: string
  strokes: InkStroke[]
  expectation: HandwritingFixtureExpectation
  diagnostics?: HandwritingFixtureDiagnostics
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
  superscriptThenBar: {
    name: 'superscriptThenBar',
    label: 'x² then bar sample',
    description: 'A strong base-plus-superscript pair with a later fraction bar added underneath.',
    strokes: [
      makeStroke('x-1', [[124, 216], [159, 261]]),
      makeStroke('x-2', [[160, 216], [124, 261]]),
      makeStroke('two-1', [[202, 154], [228, 138], [248, 143], [244, 165], [214, 179], [246, 179]]),
      makeStroke('bar-1', [[112, 308], [286, 308]], 6),
    ],
    expectation: { groupCount: 3, requiredRoles: ['baseline', 'superscript', 'fractionBar'] },
  },
  fractionWithExponent: {
    name: 'fractionWithExponent',
    label: 'Fraction with exponent',
    description: 'A numerator root carrying a superscript, with a denominator below a fraction bar.',
    strokes: [
      makeStroke('x-1', [[124, 198], [158, 242]]),
      makeStroke('x-2', [[158, 198], [124, 242]]),
      makeStroke('two-1', [[198, 144], [224, 129], [244, 134], [240, 156], [209, 170], [243, 170]]),
      makeStroke('bar-1', [[112, 284], [286, 284]], 6),
      makeStroke('den-1', [[176, 326], [205, 364], [234, 326]]),
    ],
    expectation: { groupCount: 4, requiredRoles: ['fractionBar', 'numerator', 'superscript', 'denominator'] },
  },
  fractionOuterExponent: {
    name: 'fractionOuterExponent',
    label: 'x / y ^2 sample',
    description: 'A bare fraction with a superscript placed above-right of the whole fraction, not inside the numerator local context.',
    strokes: [
      makeStroke('num-1', [[130, 184], [158, 224], [186, 184]]),
      makeStroke('bar-1', [[112, 252], [258, 252]], 6),
      makeStroke('den-1', [[150, 296], [170, 338], [182, 306], [194, 350]]),
      makeStroke('two-1', [[282, 138], [306, 122], [326, 127], [322, 146], [294, 161], [328, 162]]),
    ],
    expectation: { groupCount: 4, requiredRoles: ['fractionBar', 'numerator', 'denominator', 'superscript'] },
  },
  fractionDenominatorOuterExponent: {
    name: 'fractionDenominatorOuterExponent',
    label: 'x / z ^2 sample',
    description: 'A bare fraction whose right-biased denominator tempts a local denominator superscript, but the outer script should still promote to the whole fraction.',
    strokes: [
      makeStroke('num-1', [[138, 182], [164, 222], [192, 182]]),
      makeStroke('bar-1', [[118, 250], [268, 250]], 6),
      makeStroke('den-1', [[198, 294], [236, 294], [200, 344], [238, 344]]),
      makeStroke('den-2', [[234, 294], [198, 344]]),
      makeStroke('two-1', [[286, 252], [308, 238], [327, 242], [323, 258], [298, 270], [329, 271]]),
    ],
    expectation: { groupCount: 4, requiredRoles: ['fractionBar', 'numerator', 'denominator', 'superscript'] },
  },
  fractionOuterSubscript: {
    name: 'fractionOuterSubscript',
    label: 'x / y _2 sample',
    description: 'A bare fraction with a subscript placed below-right of the whole fraction, not inside the denominator local context.',
    strokes: [
      makeStroke('num-1', [[138, 182], [164, 222], [192, 182]]),
      makeStroke('bar-1', [[118, 250], [268, 250]], 6),
      makeStroke('den-1', [[198, 294], [236, 294], [200, 344], [238, 344]]),
      makeStroke('den-2', [[234, 294], [198, 344]]),
      makeStroke('two-1', [[286, 360], [308, 346], [327, 350], [323, 366], [298, 378], [329, 379]]),
    ],
    expectation: { groupCount: 4, requiredRoles: ['fractionBar', 'numerator', 'denominator', 'subscript'] },
  },
  fractionDenominatorOuterSubscript: {
    name: 'fractionDenominatorOuterSubscript',
    label: 'x / z _2 sample',
    description: 'A bare fraction whose right-biased denominator tempts a local denominator subscript, but the outer script should still promote to the whole fraction.',
    strokes: [
      makeStroke('num-1', [[138, 182], [164, 222], [192, 182]]),
      makeStroke('bar-1', [[118, 250], [268, 250]], 6),
      makeStroke('den-1', [[198, 294], [236, 294], [200, 344], [238, 344]]),
      makeStroke('den-2', [[234, 294], [198, 344]]),
      makeStroke('two-1', [[286, 360], [308, 346], [327, 350], [323, 366], [298, 378], [329, 379]]),
    ],
    expectation: { groupCount: 4, requiredRoles: ['fractionBar', 'numerator', 'denominator', 'subscript'] },
  },
  offsetLineSubscript: {
    name: 'offsetLineSubscript',
    label: 'Offset line subscript',
    description: 'A horizontal line-like child that sits below-right of a base instead of directly below it.',
    strokes: [
      makeStroke('x-1', [[118, 218], [156, 265]]),
      makeStroke('x-2', [[156, 220], [120, 264]]),
      makeStroke('line-1', [[205, 286], [262, 286]], 6),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline', 'subscript'] },
  },
  barSeparatedPotentialScript: {
    name: 'barSeparatedPotentialScript',
    label: 'Bar-separated script temptation',
    description: 'A baseline-like x, an isolated fraction-like bar, and a later 4 that should not create a cross-bar script attachment.',
    strokes: [
      makeStroke('x-1', [[122, 206], [156, 248]]),
      makeStroke('x-2', [[156, 206], [122, 248]]),
      makeStroke('bar-1', [[186, 230], [262, 230]], 6),
      makeStroke('four-1', [[296, 204], [318, 182], [318, 260]]),
      makeStroke('four-2', [[286, 226], [330, 226]]),
    ],
    expectation: { groupCount: 3, requiredRoles: ['baseline', 'provisionalFractionBar'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  operatorSeparatedLowerV: {
    name: 'operatorSeparatedLowerV',
    label: 'V + v inline separation',
    description: 'A capital-V-like symbol, a plus operator, and a smaller lowercase-v-like symbol that should remain inline rather than becoming a cross-operator subscript.',
    strokes: [
      makeStroke('cap-v-1', [[120, 210], [144, 258], [168, 210]]),
      makeStroke('plus-1', [[214, 204], [214, 250]]),
      makeStroke('plus-2', [[192, 227], [236, 227]]),
      makeStroke('small-v-1', [[274, 226], [290, 250], [306, 226]]),
    ],
    expectation: { groupCount: 3, requiredRoles: ['baseline'] },
  },
  operatorSeparatedUpperTwo: {
    name: 'operatorSeparatedUpperTwo',
    label: 'V + 2 superscript temptation',
    description: 'A capital-V-like symbol, a plus operator, and a slightly elevated 2-like symbol that should remain inline rather than becoming a cross-operator superscript.',
    strokes: [
      makeStroke('cap-v-1', [[120, 210], [144, 258], [168, 210]]),
      makeStroke('plus-1', [[214, 204], [214, 250]]),
      makeStroke('plus-2', [[192, 227], [236, 227]]),
      makeStroke('two-1', [[270, 198], [292, 184], [311, 189], [307, 208], [281, 220], [312, 221]]),
    ],
    expectation: { groupCount: 3, requiredRoles: ['baseline'] },
    diagnostics: { recordTopBrickFamilies: true, recordStructuralRoles: true },
  },
  parenthesizedSuperscript: {
    name: 'parenthesizedSuperscript',
    label: '(x^2) sample',
    description: 'A locally enclosed base-plus-superscript expression bounded by tall left and right enclosure marks.',
    strokes: [
      makeStroke('open-1', [[116, 140], [98, 188], [94, 248], [100, 306], [118, 354]]),
      makeStroke('x-1', [[162, 232], [198, 278]]),
      makeStroke('x-2', [[198, 232], [162, 278]]),
      makeStroke('two-1', [[226, 168], [252, 151], [272, 156], [268, 176], [239, 191], [272, 192]]),
      makeStroke('close-1', [[320, 140], [338, 188], [342, 248], [336, 306], [318, 354]]),
    ],
    expectation: { groupCount: 4, requiredRoles: ['baseline', 'superscript', 'enclosureOpen', 'enclosureClose'] },
  },
  parenthesizedExponent: {
    name: 'parenthesizedExponent',
    label: '(x^2)^3 sample',
    description: 'An enclosed local base-plus-superscript expression with an outer superscript attached to the enclosure as a whole.',
    strokes: [
      makeStroke('open-1', [[116, 140], [98, 188], [94, 248], [100, 306], [118, 354]]),
      makeStroke('x-1', [[162, 232], [198, 278]]),
      makeStroke('x-2', [[198, 232], [162, 278]]),
      makeStroke('two-1', [[226, 168], [252, 151], [272, 156], [268, 176], [239, 191], [272, 192]]),
      makeStroke('close-1', [[320, 140], [338, 188], [342, 248], [336, 306], [318, 354]]),
      makeStroke('three-1', [[366, 126], [392, 112], [414, 118], [398, 133], [416, 148], [392, 162], [368, 156]]),
    ],
    expectation: { groupCount: 5, requiredRoles: ['baseline', 'superscript', 'enclosureOpen', 'enclosureClose'] },
  },
  parenthesizedFractionNumerator: {
    name: 'parenthesizedFractionNumerator',
    label: '(x^2) / y sample',
    description: 'An enclosed local expression serving as the numerator of a fraction.',
    strokes: [
      makeStroke('open-1', [[102, 128], [84, 176], [80, 236], [86, 294], [104, 342]]),
      makeStroke('x-1', [[144, 220], [180, 266]]),
      makeStroke('x-2', [[180, 220], [144, 266]]),
      makeStroke('two-1', [[210, 160], [236, 145], [256, 149], [252, 169], [223, 184], [256, 185]]),
      makeStroke('close-1', [[304, 128], [322, 176], [326, 236], [320, 294], [302, 342]]),
      makeStroke('bar-1', [[104, 382], [330, 382]], 6),
      makeStroke('den-1', [[184, 430], [210, 474], [236, 430]]),
    ],
    expectation: { groupCount: 6, requiredRoles: ['enclosureOpen', 'enclosureClose', 'fractionBar', 'numerator', 'denominator', 'superscript'] },
  },
  parenthesizedFractionExponent: {
    name: 'parenthesizedFractionExponent',
    label: '(x / y)^2 sample',
    description: 'A local fraction enclosed in parentheses with an outer superscript attached to the enclosure as a whole.',
    strokes: [
      makeStroke('open-1', [[102, 114], [84, 164], [80, 226], [86, 286], [104, 338]]),
      makeStroke('num-1', [[150, 178], [176, 216], [202, 178]]),
      makeStroke('bar-1', [[126, 246], [246, 246]], 6),
      makeStroke('den-1', [[166, 292], [184, 332], [194, 300], [206, 344]]),
      makeStroke('close-1', [[264, 114], [282, 164], [286, 226], [280, 286], [262, 338]]),
      makeStroke('two-1', [[314, 120], [338, 104], [358, 108], [354, 128], [327, 143], [360, 144]]),
    ],
    expectation: { groupCount: 6, requiredRoles: ['enclosureOpen', 'enclosureClose', 'fractionBar', 'numerator', 'denominator', 'superscript'] },
  },
  parenthesizedFractionSubscript: {
    name: 'parenthesizedFractionSubscript',
    label: '(x / y)_2 sample',
    description: 'A local fraction enclosed in parentheses with an outer subscript attached to the enclosure as a whole.',
    strokes: [
      makeStroke('open-1', [[102, 114], [84, 164], [80, 226], [86, 286], [104, 338]]),
      makeStroke('num-1', [[150, 178], [176, 216], [202, 178]]),
      makeStroke('bar-1', [[126, 246], [246, 246]], 6),
      makeStroke('den-1', [[166, 292], [184, 332], [194, 300], [206, 344]]),
      makeStroke('close-1', [[264, 114], [282, 164], [286, 226], [280, 286], [262, 338]]),
      makeStroke('two-1', [[314, 334], [338, 318], [358, 324], [354, 344], [327, 359], [360, 360]]),
    ],
    expectation: { groupCount: 6, requiredRoles: ['enclosureOpen', 'enclosureClose', 'fractionBar', 'numerator', 'denominator', 'subscript'] },
    diagnostics: { recordStructuralRoles: true },
  },
  fractionCompositeNumerator: {
    name: 'fractionCompositeNumerator',
    label: 'v+v over v sample',
    description: 'A three-group numerator that must remain one shared numerator block during normalization.',
    strokes: [
      makeStroke('num-left-1', [[124, 170], [142, 198], [160, 170]]),
      makeStroke('plus-1', [[200, 156], [200, 204]]),
      makeStroke('plus-2', [[178, 180], [222, 180]]),
      makeStroke('num-right-1', [[250, 170], [268, 198], [286, 170]]),
      makeStroke('bar-1', [[116, 242], [294, 242]], 6),
      makeStroke('den-1', [[186, 286], [206, 318], [226, 286]]),
    ],
    expectation: { groupCount: 5, requiredRoles: ['fractionBar', 'numerator', 'denominator'] },
  },
  sequenceOuterExponent: {
    name: 'sequenceOuterExponent',
    label: 'v+v whole-sequence exponent',
    description: 'A plain inline v+v sequence with an exponent placed beyond the whole sequence so it should bind to the sequence expression rather than only the last symbol.',
    strokes: [
      makeStroke('left-v-1', [[122, 232], [140, 264], [158, 232]]),
      makeStroke('plus-1', [[196, 218], [196, 266]]),
      makeStroke('plus-2', [[174, 242], [218, 242]]),
      makeStroke('right-v-1', [[248, 232], [266, 264], [284, 232]]),
      makeStroke('two-1', [[342, 170], [368, 154], [388, 160], [384, 180], [355, 194], [389, 195]]),
    ],
    expectation: { groupCount: 4, requiredRoles: ['baseline', 'superscript'] },
  },
  sequenceOuterSubscript: {
    name: 'sequenceOuterSubscript',
    label: 'v+v whole-sequence subscript',
    description: 'A plain inline v+v sequence with a subscript placed beyond the whole sequence so it should bind to the sequence expression rather than only the last symbol.',
    strokes: [
      makeStroke('left-v-1', [[122, 232], [140, 264], [158, 232]]),
      makeStroke('plus-1', [[196, 218], [196, 266]]),
      makeStroke('plus-2', [[174, 242], [218, 242]]),
      makeStroke('right-v-1', [[248, 232], [266, 264], [284, 232]]),
      makeStroke('two-1', [[342, 296], [368, 280], [388, 286], [384, 306], [355, 320], [389, 321]]),
    ],
    expectation: { groupCount: 4, requiredRoles: ['baseline', 'subscript'] },
  },
  inlineOrdinaryPair: {
    name: 'inlineOrdinaryPair',
    label: 'Strong inline pair',
    description: 'Two ordinary baseline symbols placed in a clean left-to-right inline relation so the sequence edge should stay strong.',
    strokes: [
      makeStroke('left-x-1', [[118, 232], [152, 274]]),
      makeStroke('left-x-2', [[152, 232], [118, 274]]),
      makeStroke('right-v-1', [[160, 234], [178, 266], [196, 234]]),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline'] },
  },
  inlineFractionBarTemptation: {
    name: 'inlineFractionBarTemptation',
    label: 'Weak inline to bar-like line',
    description: 'A baseline symbol followed by a horizontal line-like group; inline scoring should be weakened by LEGO affordances even when geometry is rightward.',
    strokes: [
      makeStroke('left-x-1', [[118, 232], [152, 274]]),
      makeStroke('left-x-2', [[152, 232], [118, 274]]),
      makeStroke('line-1', [[162, 252], [224, 252]], 6),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline', 'provisionalFractionBar'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  radicalWithIndex: {
    name: 'radicalWithIndex',
    label: 'Indexed radical',
    description: 'A radical sign with hosted radicand content and a small upper-left index.',
    strokes: [
      makeStroke('index-1', [[46, 154], [64, 142], [79, 146], [66, 160], [81, 172], [60, 182], [44, 176]]),
      makeStroke('radical-1', [[122, 226], [142, 250], [170, 196], [206, 184], [248, 184]]),
      makeStroke('x-1', [[286, 220], [320, 262]]),
      makeStroke('x-2', [[320, 220], [286, 262]]),
    ],
    expectation: { groupCount: 3, requiredRoles: ['radical', 'baseline'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  stackedBaselinesUnsupported: {
    name: 'stackedBaselinesUnsupported',
    label: 'Stacked baselines warning',
    description: 'Two non-overlapping baseline-like groups stacked vertically in one local context should be preserved and flagged.',
    strokes: [
      makeStroke('x-1', [[164, 174], [198, 216]]),
      makeStroke('x-2', [[198, 174], [164, 216]]),
      makeStroke('y-1', [[168, 278], [186, 318], [196, 288], [208, 330]]),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline'] },
  },
  digitTwoSuperscriptSeven: {
    name: 'digitTwoSuperscriptSeven',
    label: '2^7 sample',
    description: 'A digit-like baseline 2 with a smaller 7 above-right should resolve as a hosted superscript rather than leaving the 7 on the baseline.',
    strokes: [
      makeStroke('two-1', [[126, 196], [156, 168], [190, 164], [204, 174], [206, 202], [188, 238], [166, 268], [142, 296], [120, 316], [154, 324], [188, 332], [224, 330]]),
      makeStroke('seven-1', [[258, 154], [296, 152], [282, 176], [268, 206]]),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline', 'superscript'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  digitFiveRadicalTemptation: {
    name: 'digitFiveRadicalTemptation',
    label: '5 radical temptation',
    description: 'A single-stroke 5-like digit with a descending kink that should remain an ordinary baseline symbol rather than being promoted to a radical.',
    strokes: [
      makeStroke('five-1', [[226, 164], [176, 164], [174, 194], [208, 194], [228, 210], [230, 240], [212, 268], [184, 286], [154, 280]]),
    ],
    expectation: { groupCount: 1, requiredRoles: ['baseline'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  digitTwoRadicalTemptation: {
    name: 'digitTwoRadicalTemptation',
    label: '2 radical temptation',
    description: 'A compact single-stroke 2-like digit that leans forward enough to flirt with radical geometry but should stay an ordinary baseline symbol.',
    strokes: [
      makeStroke('two-1', [[144, 168], [176, 150], [208, 152], [226, 170], [228, 194], [208, 220], [184, 246], [160, 272], [142, 294], [178, 298], [214, 300]]),
    ],
    expectation: { groupCount: 1, requiredRoles: ['baseline'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  shortBarSuperscript: {
    name: 'shortBarSuperscript',
    label: 'Short bar superscript',
    description: 'A baseline x with a short mostly-horizontal mark above-right that should behave as a local superscript rather than a fraction bar.',
    strokes: [
      makeStroke('x-1', [[120, 240], [155, 285]]),
      makeStroke('x-2', [[156, 240], [120, 285]]),
      makeStroke('bar-1', [[188, 202], [232, 194]], 6),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline', 'superscript'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  shortBarSubscript: {
    name: 'shortBarSubscript',
    label: 'Short bar subscript',
    description: 'A baseline x with a short horizontal mark below-right that should behave as a local subscript rather than a fraction bar.',
    strokes: [
      makeStroke('x-1', [[120, 226], [155, 271]]),
      makeStroke('x-2', [[156, 226], [120, 271]]),
      makeStroke('bar-1', [[206, 292], [246, 292]], 6),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline', 'subscript'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  compactTBaseline: {
    name: 'compactTBaseline',
    label: 'Compact t-like symbol',
    description: 'A compact cross-like t shape that should stay an ordinary baseline symbol instead of an operator brick.',
    strokes: [
      makeStroke('stem-1', [[172, 168], [172, 302]]),
      makeStroke('bar-1', [[146, 190], [198, 190]]),
    ],
    expectation: { groupCount: 1, requiredRoles: ['baseline'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  compactTSuperscript: {
    name: 'compactTSuperscript',
    label: 'Compact t with exponent',
    description: 'A compact t-like host with an upper-right 7 that should still resolve as an ordinary baseline host plus superscript.',
    strokes: [
      makeStroke('stem-1', [[172, 176], [172, 308]]),
      makeStroke('bar-1', [[146, 198], [198, 198]]),
      makeStroke('seven-1', [[228, 150], [264, 150], [250, 174], [236, 202]]),
    ],
    expectation: { groupCount: 2, requiredRoles: ['baseline', 'superscript'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  radicalLooseRoof: {
    name: 'radicalLooseRoof',
    label: 'Loose-roof radical',
    description: 'A slightly flatter radical sign with hosted interior content that should still resolve as a radical despite the roof being less canonical.',
    strokes: [
      makeStroke('radical-1', [[122, 234], [144, 256], [170, 214], [208, 200], [246, 194], [282, 198]]),
      makeStroke('x-1', [[304, 222], [338, 264]]),
      makeStroke('x-2', [[338, 222], [304, 264]]),
    ],
    expectation: { groupCount: 2, requiredRoles: ['radical', 'baseline'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
  tightFractionBar: {
    name: 'tightFractionBar',
    label: 'Tight fraction bar',
    description: 'A shorter bar with closely packed numerator and denominator members that should still form a fraction structure.',
    strokes: [
      makeStroke('num-1', [[164, 176], [184, 206], [204, 176]]),
      makeStroke('bar-1', [[154, 234], [236, 234]], 6),
      makeStroke('den-1', [[172, 272], [192, 304], [212, 272]]),
    ],
    expectation: { groupCount: 3, requiredRoles: ['fractionBar', 'numerator', 'denominator'] },
    diagnostics: { recordTopBrickFamilies: true },
  },
}

export const HANDWRITING_FIXTURE_ORDER: HandwritingFixtureName[] = ['superscript', 'fraction', 'nested', 'adjacentAmbiguous', 'crossingFour', 'superscriptThenBar', 'fractionWithExponent', 'fractionOuterExponent', 'fractionDenominatorOuterExponent', 'fractionOuterSubscript', 'fractionDenominatorOuterSubscript', 'offsetLineSubscript', 'barSeparatedPotentialScript', 'operatorSeparatedLowerV', 'operatorSeparatedUpperTwo', 'parenthesizedSuperscript', 'parenthesizedExponent', 'parenthesizedFractionNumerator', 'parenthesizedFractionExponent', 'parenthesizedFractionSubscript', 'fractionCompositeNumerator', 'sequenceOuterExponent', 'sequenceOuterSubscript', 'inlineOrdinaryPair', 'inlineFractionBarTemptation', 'radicalWithIndex', 'stackedBaselinesUnsupported', 'digitTwoSuperscriptSeven', 'digitFiveRadicalTemptation', 'digitTwoRadicalTemptation', 'shortBarSuperscript', 'shortBarSubscript', 'compactTBaseline', 'compactTSuperscript', 'radicalLooseRoof', 'tightFractionBar']

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