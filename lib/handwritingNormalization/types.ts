export type InkPoint = {
  x: number
  y: number
  t?: number
}

export type InkStroke = {
  id: string
  points: InkPoint[]
  color?: string | null
  width?: number | null
  startedAt?: number | null
  endedAt?: number | null
}

export type InkBounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export type GroupCentroid = {
  x: number
  y: number
}

export type StrokeGroup = {
  id: string
  strokeIds: string[]
  strokes: InkStroke[]
  bounds: InkBounds
  centroid: GroupCentroid
  baselineY: number
  aspectRatio: number
  flatness: number
  density: number
  strokeCount: number
  startedAt: number
  endedAt: number
}

export type LayoutRelationKind =
  | 'sequence'
  | 'superscriptCandidate'
  | 'subscriptCandidate'
  | 'stackedAbove'
  | 'stackedBelow'
  | 'inside'
  | 'overlap'

export type LayoutEdge = {
  id: string
  fromId: string
  toId: string
  kind: LayoutRelationKind
  score: number
  metrics: Record<string, number>
}

export type StructuralRoleKind =
  | 'baseline'
  | 'superscript'
  | 'subscript'
  | 'numerator'
  | 'denominator'
  | 'fractionBar'

export type StructuralRole = {
  groupId: string
  role: StructuralRoleKind
  score: number
  depth: number
  parentGroupId?: string | null
}

export type StructuralRoleCandidate = {
  role: StructuralRoleKind
  score: number
  parentGroupId?: string | null
}

export type StructuralAmbiguity = {
  groupId: string
  reason: 'competing-relations' | 'sequence-vs-script' | 'fraction-membership'
  chosenRole: StructuralRoleKind
  candidates: StructuralRoleCandidate[]
}

export type NormalizedGroup = {
  id: string
  bounds: InkBounds
  scale: number
  translateX: number
  translateY: number
}

export type NormalizationResult = {
  strokes: InkStroke[]
  groups: NormalizedGroup[]
}

export type HandwritingAnalysis = {
  groups: StrokeGroup[]
  edges: LayoutEdge[]
  roles: StructuralRole[]
  ambiguities: StructuralAmbiguity[]
  normalization: NormalizationResult
}