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
  | 'unsupportedSymbol'
  | 'provisionalFractionBar'
  | 'superscript'
  | 'subscript'
  | 'numerator'
  | 'denominator'
  | 'fractionBar'
  | 'enclosureOpen'
  | 'enclosureClose'

export type StructuralRoleFamily = 'expressionRoot' | 'specialSymbol' | 'script' | 'fractionStructure' | 'fractionMember' | 'enclosureStructure'

export type StructuralRoleZone = 'center' | 'upper' | 'lower'

export type StructuralRoleAnchor = 'inline' | 'right' | 'centered'

export type StructuralRoleShape = 'freeform' | 'horizontalLine'

export type StructuralAssociationWeight = 'blocked' | 'weak' | 'medium' | 'strong'

export type StructuralOperatorKind = 'none' | 'unaryReference' | 'binaryStructure'

export type StructuralOperandReferenceMode = 'none' | 'parent' | 'children'

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
  operatorKind: StructuralOperatorKind
  operandReferenceMode: StructuralOperandReferenceMode
  requiresOperandReference: boolean
  allowedOperandRoles: StructuralRoleKind[]
  canOwnScripts: boolean
  allowedChildRoles: StructuralRoleKind[]
  forbiddenChildRoles: StructuralRoleKind[]
  peerRoles: StructuralRoleKind[]
  locality: StructuralLocalityProfile
  structuralBarrier: boolean
  ancestry: string[]
  discriminators: string[]
}

export type RecognizedSymbolCategory = 'digit' | 'latin' | 'greek' | 'operator' | 'encloser' | 'structure' | 'unknown'

export type RecognizedSymbol = {
  category: RecognizedSymbolCategory
  value: string
  confidence: number
  evidence: string[]
}

export type StructuralRole = {
  groupId: string
  role: StructuralRoleKind
  descriptor: StructuralRoleDescriptor
  score: number
  depth: number
  parentGroupId?: string | null
  associationContextId?: string | null
  normalizationAnchorGroupIds: string[]
  containerGroupIds: string[]
  recognizedSymbol?: RecognizedSymbol | null
  qualifiedRoleLabel?: string | null
  evidence: string[]
}

export type StructuralRoleCandidate = {
  role: StructuralRoleKind
  score: number
  parentGroupId?: string | null
  associationContextId?: string | null
  containerGroupIds?: string[]
  normalizationAnchorGroupIds?: string[]
  evidence?: string[]
}

export type StructuralAmbiguity = {
  groupId: string
  reason: 'competing-relations' | 'sequence-vs-script' | 'fraction-membership' | 'fraction-wide-script-vs-baseline' | 'enclosure-wide-script-vs-baseline'
  chosenRole: StructuralRoleKind
  candidates: StructuralRoleCandidate[]
}

export type StructuralFlag =
  | {
    kind: 'sameContextStackedBaselines'
    severity: 'warning'
    groupIds: string[]
    message: string
    contextKey: string
  }
  | {
    kind: 'sameParentStackedScripts'
    severity: 'warning'
    groupIds: string[]
    message: string
    contextKey: string
    parentGroupId: string
    scriptRole: 'superscript' | 'subscript'
  }
  | {
    kind: 'missingOperandReference'
    severity: 'warning'
    groupIds: string[]
    message: string
    operatorRole: 'superscript' | 'subscript'
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

export type ExpressionContext = {
  id: string
  kind: 'root' | 'enclosure' | 'fraction' | 'numerator' | 'denominator'
  parentContextId?: string | null
  semanticRootGroupId?: string | null
  anchorGroupIds: string[]
  memberGroupIds: string[]
}

export type ExpressionParseNodeKind = 'group' | 'scriptApplication' | 'enclosureExpression' | 'fractionExpression' | 'sequenceExpression' | 'ambiguityExpression'

export type ExpressionParseAlternative = {
  nodeId: string
  nodeKind: ExpressionParseNodeKind
  role: StructuralRoleKind
  rank: number
  score: number
  parentGroupId?: string | null
  contextId?: string | null
  relation: 'chosen' | 'alternative'
  label: string
}

export type ExpressionParseNode = {
  id: string
  kind: ExpressionParseNodeKind
  contextId: string
  groupIds: string[]
  childNodeIds: string[]
  operatorGroupId?: string | null
  role?: StructuralRoleKind
  ambiguityReason?: StructuralAmbiguity['reason']
  preferredChildNodeId?: string | null
  alternatives?: ExpressionParseAlternative[]
  label: string
}

export type ContextParseRoot = {
  contextId: string
  nodeIds: string[]
  rootNodeId?: string | null
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
  flags: StructuralFlag[]
  subexpressions: LocalSubexpression[]
  enclosures: EnclosureStructure[]
  contexts: ExpressionContext[]
  parseNodes: ExpressionParseNode[]
  parseRoots: ContextParseRoot[]
  normalization: NormalizationResult
}