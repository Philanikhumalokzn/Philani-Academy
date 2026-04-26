export const VALID_TOPICS = [
  'Algebra',
  'Functions',
  'Number Patterns',
  'Number, Operations and Relations',
  'Measurement',
  'Finance',
  'Trigonometry',
  'Euclidean Geometry',
  'Analytical Geometry',
  'Statistics',
  'Probability',
  'Calculus',
  'Sequences and Series',
  'Polynomials',
] as const

export type TopicLabel = typeof VALID_TOPICS[number]

type TopicRule = {
  term: string
  weight: number
}

type TopicScore = {
  topic: TopicLabel
  score: number
}

export type TopicCandidate = {
  topic: TopicLabel
  score: number
  share: number
}

const TOPIC_RULES: Record<TopicLabel, TopicRule[]> = {
  Algebra: [
    { term: 'solve', weight: 1.8 },
    { term: 'simplify', weight: 1.6 },
    { term: 'factorise', weight: 1.9 },
    { term: 'factorize', weight: 1.9 },
    { term: 'substitute', weight: 1.4 },
    { term: 'expand', weight: 1.5 },
    { term: 'equation', weight: 1.4 },
    { term: 'inequality', weight: 1.5 },
    { term: 'variable', weight: 1.1 },
    { term: 'expression', weight: 1.2 },
    { term: 'coefficient', weight: 1.2 },
    { term: 'constant', weight: 1.1 },
    { term: 'fraction', weight: 1.1 },
    { term: 'surd', weight: 1.3 },
    { term: 'rationalise', weight: 1.6 },
    { term: 'identity', weight: 1.1 },
    { term: 'simultaneous', weight: 1.3 },
    { term: 'substitution', weight: 1.2 },
    { term: 'elimination', weight: 1.2 },
  ],
  Functions: [
    { term: 'function', weight: 1.9 },
    { term: 'graph', weight: 1.8 },
    { term: 'domain', weight: 1.8 },
    { term: 'range', weight: 1.8 },
    { term: 'inverse', weight: 1.6 },
    { term: 'intercept', weight: 1.4 },
    { term: 'asymptote', weight: 1.9 },
    { term: 'turning point', weight: 1.7 },
    { term: 'maximum', weight: 1.2 },
    { term: 'minimum', weight: 1.2 },
    { term: 'translate', weight: 1.5 },
    { term: 'reflect', weight: 1.5 },
    { term: 'stretch', weight: 1.5 },
    { term: 'dilate', weight: 1.5 },
    { term: 'shift', weight: 1.4 },
    { term: 'map', weight: 1.1 },
    { term: 'composite', weight: 1.5 },
    { term: 'piecewise', weight: 1.4 },
    { term: 'transform', weight: 1.5 },
  ],
  'Number Patterns': [
    { term: 'pattern', weight: 1.9 },
    { term: 'difference', weight: 1.6 },
    { term: 'term', weight: 1.4 },
    { term: 'nth term', weight: 1.9 },
    { term: 'general term', weight: 1.8 },
    { term: 'recursive', weight: 1.7 },
    { term: 'recurrence', weight: 1.7 },
    { term: 'sequence', weight: 1.3 },
    { term: 'rule', weight: 1.3 },
    { term: 'generate', weight: 1.3 },
    { term: 'predict', weight: 1.2 },
    { term: 'extend', weight: 1.2 },
    { term: 'ratio', weight: 1.2 },
    { term: 'difference table', weight: 1.9 },
    { term: 'linear pattern', weight: 1.6 },
    { term: 'quadratic pattern', weight: 1.6 },
  ],
  'Number, Operations and Relations': [
    { term: 'integer', weight: 1.9 },
    { term: 'integers', weight: 1.9 },
    { term: 'whole number', weight: 1.8 },
    { term: 'natural number', weight: 1.7 },
    { term: 'rational', weight: 1.8 },
    { term: 'irrational', weight: 1.8 },
    { term: 'ratio', weight: 1.7 },
    { term: 'rate', weight: 1.7 },
    { term: 'proportion', weight: 1.8 },
    { term: 'percent', weight: 1.5 },
    { term: 'percentage', weight: 1.6 },
    { term: 'order of operations', weight: 1.9 },
    { term: 'bidmas', weight: 1.9 },
    { term: 'exponent', weight: 1.6 },
    { term: 'powers', weight: 1.6 },
    { term: 'prime', weight: 1.5 },
    { term: 'factor', weight: 1.4 },
    { term: 'multiple', weight: 1.4 },
  ],
  Measurement: [
    { term: 'measurement', weight: 1.9 },
    { term: 'perimeter', weight: 1.9 },
    { term: 'area', weight: 1.9 },
    { term: 'volume', weight: 1.9 },
    { term: 'surface area', weight: 1.9 },
    { term: 'capacity', weight: 1.8 },
    { term: 'length', weight: 1.6 },
    { term: 'mass', weight: 1.6 },
    { term: 'time', weight: 1.4 },
    { term: 'speed', weight: 1.7 },
    { term: 'distance', weight: 1.6 },
    { term: 'unit conversion', weight: 1.9 },
    { term: 'convert', weight: 1.5 },
    { term: 'mensuration', weight: 1.9 },
    { term: 'cylinder', weight: 1.6 },
    { term: 'cone', weight: 1.6 },
    { term: 'sphere', weight: 1.6 },
    { term: 'prism', weight: 1.6 },
  ],
  Finance: [
    { term: 'interest', weight: 1.9 },
    { term: 'compound', weight: 1.8 },
    { term: 'simple interest', weight: 1.9 },
    { term: 'annuity', weight: 1.9 },
    { term: 'loan', weight: 1.8 },
    { term: 'repay', weight: 1.7 },
    { term: 'instalment', weight: 1.8 },
    { term: 'deposit', weight: 1.6 },
    { term: 'withdraw', weight: 1.6 },
    { term: 'investment', weight: 1.8 },
    { term: 'inflation', weight: 1.8 },
    { term: 'depreciation', weight: 1.9 },
    { term: 'present value', weight: 1.8 },
    { term: 'future value', weight: 1.8 },
    { term: 'balance', weight: 1.4 },
    { term: 'amortise', weight: 1.8 },
    { term: 'bank', weight: 1.2 },
    { term: 'account', weight: 1.2 },
  ],
  Trigonometry: [
    { term: 'sin', weight: 1.8 },
    { term: 'cos', weight: 1.8 },
    { term: 'tan', weight: 1.8 },
    { term: 'trigonometry', weight: 1.9 },
    { term: 'identity', weight: 1.4 },
    { term: 'angle', weight: 1.3 },
    { term: 'radian', weight: 1.7 },
    { term: 'degree', weight: 1.4 },
    { term: 'period', weight: 1.5 },
    { term: 'amplitude', weight: 1.6 },
    { term: 'phase', weight: 1.5 },
    { term: 'sine rule', weight: 1.9 },
    { term: 'cosine rule', weight: 1.9 },
    { term: 'trig graph', weight: 1.8 },
    { term: 'double angle', weight: 1.8 },
    { term: 'cast diagram', weight: 1.9 },
  ],
  'Euclidean Geometry': [
    { term: 'prove', weight: 1.8 },
    { term: 'theorem', weight: 1.8 },
    { term: 'circle', weight: 1.7 },
    { term: 'chord', weight: 1.9 },
    { term: 'tangent', weight: 1.9 },
    { term: 'secant', weight: 1.8 },
    { term: 'arc', weight: 1.8 },
    { term: 'polygon', weight: 1.4 },
    { term: 'triangle', weight: 1.3 },
    { term: 'quadrilateral', weight: 1.6 },
    { term: 'parallel', weight: 1.4 },
    { term: 'congruent', weight: 1.7 },
    { term: 'similar', weight: 1.6 },
    { term: 'bisect', weight: 1.6 },
    { term: 'equal angle', weight: 1.4 },
    { term: 'cyclic', weight: 1.8 },
    { term: 'midpoint theorem', weight: 1.8 },
  ],
  'Analytical Geometry': [
    { term: 'gradient', weight: 1.9 },
    { term: 'slope', weight: 1.8 },
    { term: 'line', weight: 1.2 },
    { term: 'equation of line', weight: 1.9 },
    { term: 'distance', weight: 1.5 },
    { term: 'midpoint', weight: 1.8 },
    { term: 'coordinate', weight: 1.8 },
    { term: 'intercept', weight: 1.5 },
    { term: 'parallel line', weight: 1.7 },
    { term: 'perpendicular', weight: 1.7 },
    { term: 'circle equation', weight: 1.9 },
    { term: 'radius', weight: 1.3 },
    { term: 'center', weight: 1.3 },
    { term: 'centre', weight: 1.3 },
    { term: 'point', weight: 1.0 },
  ],
  Statistics: [
    { term: 'mean', weight: 1.8 },
    { term: 'median', weight: 1.8 },
    { term: 'mode', weight: 1.7 },
    { term: 'quartile', weight: 1.8 },
    { term: 'decile', weight: 1.7 },
    { term: 'percentile', weight: 1.7 },
    { term: 'distribution', weight: 1.6 },
    { term: 'histogram', weight: 1.9 },
    { term: 'box plot', weight: 1.9 },
    { term: 'scatter', weight: 1.8 },
    { term: 'outlier', weight: 1.8 },
    { term: 'variance', weight: 1.9 },
    { term: 'deviation', weight: 1.7 },
    { term: 'frequency', weight: 1.7 },
    { term: 'sample', weight: 1.4 },
    { term: 'survey', weight: 1.4 },
    { term: 'data', weight: 1.2 },
    { term: 'ogive', weight: 1.9 },
  ],
  Probability: [
    { term: 'probability', weight: 1.9 },
    { term: 'event', weight: 1.7 },
    { term: 'sample space', weight: 1.9 },
    { term: 'outcome', weight: 1.8 },
    { term: 'tree diagram', weight: 1.9 },
    { term: 'independent', weight: 1.7 },
    { term: 'dependent', weight: 1.7 },
    { term: 'mutually exclusive', weight: 1.9 },
    { term: 'replacement', weight: 1.8 },
    { term: 'without replacement', weight: 1.9 },
    { term: 'random variable', weight: 1.8 },
    { term: 'expected value', weight: 1.8 },
    { term: 'binomial', weight: 1.9 },
    { term: 'success', weight: 1.3 },
    { term: 'trial', weight: 1.4 },
  ],
  Calculus: [
    { term: 'differentiate', weight: 1.9 },
    { term: 'derivative', weight: 1.9 },
    { term: 'integrate', weight: 1.9 },
    { term: 'integral', weight: 1.9 },
    { term: 'stationary', weight: 1.7 },
    { term: 'gradient function', weight: 1.8 },
    { term: 'rate', weight: 1.4 },
    { term: 'instantaneous', weight: 1.7 },
    { term: 'area under', weight: 1.8 },
    { term: 'antiderivative', weight: 1.9 },
    { term: 'limit', weight: 1.5 },
    { term: 'increase', weight: 1.3 },
    { term: 'decrease', weight: 1.3 },
    { term: 'concave', weight: 1.7 },
    { term: 'inflection', weight: 1.8 },
    { term: 'maximize', weight: 1.5 },
    { term: 'minimize', weight: 1.5 },
  ],
  'Sequences and Series': [
    { term: 'sequence', weight: 1.9 },
    { term: 'series', weight: 1.9 },
    { term: 'arithmetic', weight: 1.8 },
    { term: 'geometric', weight: 1.8 },
    { term: 'common difference', weight: 1.9 },
    { term: 'common ratio', weight: 1.9 },
    { term: 'sum', weight: 1.6 },
    { term: 'sigma', weight: 1.8 },
    { term: 'partial sum', weight: 1.9 },
    { term: 'converge', weight: 1.6 },
    { term: 'diverge', weight: 1.6 },
    { term: 'nth term', weight: 1.7 },
    { term: 'first term', weight: 1.5 },
    { term: 'finite series', weight: 1.8 },
    { term: 'infinite series', weight: 1.8 },
  ],
  Polynomials: [
    { term: 'polynomial', weight: 1.9 },
    { term: 'degree', weight: 1.4 },
    { term: 'coefficient', weight: 1.3 },
    { term: 'factor theorem', weight: 1.9 },
    { term: 'remainder theorem', weight: 1.9 },
    { term: 'quotient', weight: 1.6 },
    { term: 'divisor', weight: 1.6 },
    { term: 'roots', weight: 1.7 },
    { term: 'zeroes', weight: 1.7 },
    { term: 'zeros', weight: 1.7 },
    { term: 'synthetic division', weight: 1.9 },
    { term: 'cubic', weight: 1.5 },
    { term: 'quadratic', weight: 1.5 },
    { term: 'factorise', weight: 1.6 },
    { term: 'factorize', weight: 1.6 },
  ],
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRuleRegex(term: string): RegExp {
  const escaped = escapeRegExp(term.trim()).replace(/\s+/g, '\\s+')
  return new RegExp(`\\b${escaped}\\b`, 'gi')
}

const COMPILED_RULES: Record<TopicLabel, Array<{ regex: RegExp; weight: number }>> = Object.fromEntries(
  Object.entries(TOPIC_RULES).map(([topic, rules]) => [
    topic,
    rules.map((rule) => ({ regex: new RegExp(`\\b${escapeRegExp(rule.term)}\\b`, 'i'), weight: rule.weight })),
  ]),
) as Record<TopicLabel, Array<{ regex: RegExp; weight: number }>>

function countMatches(input: string, regex: RegExp): number {
  regex.lastIndex = 0
  let count = 0
  while (regex.exec(input)) {
    count += 1
    if (count >= 8) break
  }
  return count
}

function normalizeCorpus(questionText: string, latex?: string | null, tableMarkdown?: string | null): string {
  return [questionText || '', latex || '', tableMarkdown || '']
    .join(' ')
    .toLowerCase()
    .replace(/[_^{}\\]/g, ' ')
    .replace(/[^a-z0-9\s.\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function scoreTopicMap(questionText: string, latex?: string | null, tableMarkdown?: string | null): Map<TopicLabel, number> {
  const corpus = normalizeCorpus(questionText, latex, tableMarkdown)
  const scores = new Map<TopicLabel, number>()

  // Initialize all valid topics with 0 score
  for (const topic of VALID_TOPICS) {
    scores.set(topic, 0)
  }

  if (!corpus) return scores

  for (const [topic, rules] of Object.entries(COMPILED_RULES) as Array<[TopicLabel, Array<{ regex: RegExp; weight: number }>]>) {
    let score = 0
    for (const rule of rules) {
      const matches = countMatches(corpus, rule.regex)
      if (!matches) continue
      score += Math.min(3, matches) * rule.weight
    }

    if (score > 0) {
      scores.set(topic, Number(score.toFixed(3)))
    }
  }

  return scores
}

function toSortedTopicScores(scoreMap: Map<TopicLabel, number>): TopicScore[] {
  return Array.from(scoreMap.entries())
    .map(([topic, score]) => ({ topic, score }))
    .sort((a, b) => b.score - a.score)
}

export function pickTopTopicCandidates(
  scoreMap: Map<TopicLabel, number>,
  opts?: { secondTopicThreshold?: number; minSecondScore?: number },
): TopicCandidate[] {
  const secondTopicThreshold = opts?.secondTopicThreshold ?? 0.8
  const minSecondScore = opts?.minSecondScore ?? 2.4
  const sorted = toSortedTopicScores(scoreMap)

  // Never return empty. If no scores are non-zero, pick the first valid topic.
  if (sorted.length === 0 || (sorted[0]?.score ?? 0) === 0) {
    return [{ topic: VALID_TOPICS[0], score: 0, share: 1 }]
  }

  const first = sorted[0]
  const second = sorted[1]
  const selected: TopicScore[] = [first]

  if (second && second.score >= minSecondScore && second.score >= first.score * secondTopicThreshold) {
    selected.push(second)
  }

  const total = selected.reduce((sum, item) => sum + item.score, 0)
  return selected.map((item) => ({
    topic: item.topic,
    score: Number(item.score.toFixed(3)),
    share: Number((item.score / (total || 1)).toFixed(4)),
  }))
}

export function blendTopicScores(
  questionScores: Map<TopicLabel, number>,
  rootScores: Map<TopicLabel, number>,
  opts?: { questionWeight?: number; rootWeight?: number },
): Map<TopicLabel, number> {
  const questionWeight = opts?.questionWeight ?? 0.65
  const rootWeight = opts?.rootWeight ?? 0.35

  const blended = new Map<TopicLabel, number>()
  
  // Initialize all valid topics with 0 score
  for (const topic of VALID_TOPICS) {
    blended.set(topic, 0)
  }

  // Blend scores for topics that have non-zero scores
  const keys = new Set<TopicLabel>([...questionScores.keys(), ...rootScores.keys()])
  for (const key of keys) {
    const questionScore = questionScores.get(key) || 0
    const rootScore = rootScores.get(key) || 0
    const mixed = questionScore * questionWeight + rootScore * rootWeight
    if (mixed > 0) blended.set(key, Number(mixed.toFixed(3)))
  }

  return blended
}

export function getQuestionRoot(questionNumber: string): string {
  const parts = String(questionNumber || '').trim().match(/\d+(?:\.\d+)*/)?.[0]?.split('.') || []
  return parts[0] || ''
}
