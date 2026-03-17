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
  | 'enclosureOpen'
  | 'enclosureClose'

export type StructuralRoleFamily = 'expressionRoot' | 'script' | 'fractionStructure' | 'fractionMember' | 'enclosureStructure'

export type StructuralRoleZone = 'center' | 'upper' | 'lower'

export type StructuralRoleAnchor = 'inline' | 'right' | 'centered'

export type StructuralRoleShape = 'freeform' | 'horizontalLine'

export type StructuralAssociationWeight = 'blocked' | 'weak' | 'medium' | 'strong'

export type StructuralLocalityProfile = {
  local: number
  adjacent: number
  distant: number
}

export type StructuralRoleDescriptor = {
  kind: StructuralRoleKind
  family: StructuralRoleFamily
  zone: StructuralRoleZone
  anchor: StructuralRoleAnchor
  shape: StructuralRoleShape
  canOwnScripts: boolean
  allowedChildRoles: StructuralRoleKind[]
  forbiddenChildRoles: StructuralRoleKind[]
  peerRoles: StructuralRoleKind[]
  locality: StructuralLocalityProfile
  structuralBarrier: boolean
  ancestry: string[]
  discriminators: string[]
}

export type StructuralRole = {
  groupId: string
  role: StructuralRoleKind
  descriptor: StructuralRoleDescriptor
  score: number
  depth: number
  parentGroupId?: string | null
  containerGroupIds: string[]
  evidence: string[]
}

export type StructuralRoleCandidate = {
  role: StructuralRoleKind
  score: number
  parentGroupId?: string | null
  evidence?: string[]
}

export type StructuralAmbiguity = {
  groupId: string
  reason: 'competing-relations' | 'sequence-vs-script' | 'fraction-membership'
  chosenRole: StructuralRoleKind
  candidates: StructuralRoleCandidate[]
}

export type LocalSubexpressionAttachment = {
  parentGroupId: string
  childGroupId: string
  role: 'superscript' | 'subscript'
  score: number
}

export type LocalSubexpression = {
  rootGroupId: string
  memberGroupIds: string[]
  attachments: LocalSubexpressionAttachment[]
  rootRole: 'baseline' | 'numerator' | 'denominator'
}

export type EnclosureStructure = {
  id: string
  kind: 'parentheses'
  openGroupId: string
  closeGroupId: string
  memberRootIds: string[]
  score: number
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
  subexpressions: LocalSubexpression[]
  enclosures: EnclosureStructure[]
  normalization: NormalizationResult
}