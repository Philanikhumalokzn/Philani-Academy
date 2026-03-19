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

export type LegoBrickPrototypeKind =
  | 'compactGlyph'
  | 'horizontalLine'
  | 'boundaryStroke'
  | 'operatorCross'
  | 'radicalGlyph'
  | 'unknown'

export type LegoFieldKind =
  | 'center'
  | 'leftInline'
  | 'rightInline'
  | 'upperLeftScript'
  | 'upperRightScript'
  | 'lowerLeftScript'
  | 'lowerRightScript'
  | 'over'
  | 'under'
  | 'interior'

export type LegoFieldCapacity = 'single' | 'sequence' | 'hostedRegion' | 'stackable'

export type LegoFieldDirection = 'incoming' | 'outgoing' | 'bidirectional' | 'hosted' | 'interior' | 'neutral'

export type LegoFieldTopology = 'bounded' | 'semiBounded' | 'unbounded' | 'degenerate' | 'forbidden'

export type LegoFieldSide = 'top' | 'right' | 'bottom' | 'left'

export type LegoFieldBoundarySource = 'inner' | 'outer' | 'open' | 'degenerate'

export type LegoFieldBoundaryState = Record<LegoFieldSide, LegoFieldBoundarySource>

export type LegoFieldInteractionKind = 'cooperative' | 'competitive' | 'neutral'

export type LegoBrickFamilyKind =
  | 'ordinaryBaselineSymbolBrick'
  | 'operatorBrick'
  | 'fractionBarBrick'
  | 'enclosureBoundaryBrick'
  | 'radicalBrick'
  | 'unsupportedBrick'

export type LegoFieldProfile = {
  kind: LegoFieldKind
  weight: number
  capacity: LegoFieldCapacity
  evidence: string[]
}

export type LegoBrickFamilyDescriptor = {
  kind: LegoBrickFamilyKind
  prototypeKinds: LegoBrickPrototypeKind[]
  fields: LegoFieldProfile[]
  evidence: string[]
}

export type LegoBrickHypothesis = {
  id: string
  groupId: string
  prototype: LegoBrickPrototypeKind
  family: LegoBrickFamilyKind
  score: number
  fields: LegoFieldProfile[]
  evidence: string[]
}

export type LegoBrickOccupancy = {
  groupId: string
  family: LegoBrickFamilyKind
  field: LegoFieldKind
  score: number
  hostGroupId?: string | null
  hostContextId?: string | null
  evidence: string[]
}

export type LegoFieldInstance = {
  id: string
  hypothesisId: string
  hostGroupId: string
  hostFamily: LegoBrickFamilyKind
  hostPrototype: LegoBrickPrototypeKind
  hypothesisScore: number
  kind: LegoFieldKind
  capacity: LegoFieldCapacity
  direction: LegoFieldDirection
  topology: LegoFieldTopology
  weight: number
  strength: number
  ownershipStrength: number
  bounds: InkBounds
  realizedArea: number
  closureRatio: number
  innerClosureRatio: number
  outerClosureRatio: number
  openSides: LegoFieldSide[]
  boundaryState: LegoFieldBoundaryState
  counterpartKinds: LegoFieldKind[]
  evidence: string[]
}

export type LegoFieldIntersection = {
  id: string
  leftFieldId: string
  rightFieldId: string
  leftHostGroupId: string
  rightHostGroupId: string
  leftKind: LegoFieldKind
  rightKind: LegoFieldKind
  bounds: InkBounds
  overlapArea: number
  overlapRatio: number
  interactionKind: LegoFieldInteractionKind
  cooperativeScore: number
  competitiveScore: number
  dominantFieldId?: string | null
  dominantHostGroupId?: string | null
  dominantKind?: LegoFieldKind | null
  dominanceMargin: number
  evidence: string[]
}

export type LegoFieldClaim = {
  id: string
  targetGroupId: string
  fieldId: string
  hostGroupId: string
  hostFamily: LegoBrickFamilyKind
  fieldKind: LegoFieldKind
  fieldDirection: LegoFieldDirection
  fieldTopology: LegoFieldTopology
  score: number
  overlapRatio: number
  centerInside: boolean
  distanceScore: number
  dominanceBoost: number
  ownershipStrength: number
  closureRatio: number
  realizationScore: number
  directionalCompatibilityScore: number
  sharedCompatibilityScore: number
  latentPenalty: number
  counterpartFieldKind?: LegoFieldKind | null
  counterpartFieldScore: number
  counterpartFieldTopology?: LegoFieldTopology | null
  evidence: string[]
}

export type StructuralRoleKind =
  | 'baseline'
  | 'unsupportedSymbol'
  | 'radical'
  | 'provisionalFractionBar'
  | 'superscript'
  | 'subscript'
  | 'numerator'
  | 'denominator'
  | 'fractionBar'
  | 'enclosureOpen'
  | 'enclosureClose'

export type StructuralRoleFamily = 'expressionRoot' | 'specialSymbol' | 'script' | 'fractionStructure' | 'fractionMember' | 'enclosureStructure' | 'radicalStructure'

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
  hostedContextId?: string | null
  hostedContextKind?: ExpressionContext['kind'] | null
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
  reason: 'competing-relations' | 'sequence-vs-script' | 'fraction-membership' | 'fraction-wide-script-vs-baseline' | 'radical-wide-script-vs-baseline' | 'enclosure-wide-script-vs-baseline'
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
  | {
    kind: 'incompleteFractionStructure'
    severity: 'warning'
    groupIds: string[]
    message: string
    barGroupId: string
    missingSide: 'numerator' | 'denominator' | 'both'
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
  kind: 'root' | 'enclosure' | 'fraction' | 'numerator' | 'denominator' | 'radical' | 'radicand' | 'radicalIndex' | 'sequence'
  parentContextId?: string | null
  semanticRootGroupId?: string | null
  anchorGroupIds: string[]
  memberGroupIds: string[]
}

export type ParseAssemblyStrategy = 'topLevelSpatial' | 'occupancyOrdered' | 'semanticFallback'

export type ExpressionParseNodeKind = 'group' | 'scriptApplication' | 'enclosureExpression' | 'fractionExpression' | 'radicalExpression' | 'sequenceExpression' | 'ambiguityExpression'

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
  childOrderingStrategy?: ParseAssemblyStrategy
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
  assemblyStrategy?: ParseAssemblyStrategy
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

export type HandwritingRefinementPass = {
  iteration: number
  signature: string
  changed: boolean
}

export type HandwritingIncrementalGroupState = {
  groupId: string
  strokeIds: string[]
  bounds: InkBounds
  topFamily: LegoBrickFamilyKind | null
  topFamilyScore: number
}

export type HandwritingIncrementalState = {
  groups: HandwritingIncrementalGroupState[]
  analysis: HandwritingAnalysis
}

export type HandwritingIncrementalWarmStartSummary = {
  enabled: boolean
  matchedGroups: number
  reusedFamilySeeds: number
  averageMatchScore: number
}

export type HandwritingRefinementSummary = {
  iterations: number
  converged: boolean
  maxIterations: number
  passes: HandwritingRefinementPass[]
  warmStart?: HandwritingIncrementalWarmStartSummary
}

export type HandwritingAnalysisOptions = {
  incrementalState?: HandwritingIncrementalState | null
}

export type HandwritingAnalysis = {
  groups: StrokeGroup[]
  edges: LayoutEdge[]
  brickHypotheses: LegoBrickHypothesis[]
  brickOccupancies: LegoBrickOccupancy[]
  fieldInstances: LegoFieldInstance[]
  fieldIntersections: LegoFieldIntersection[]
  fieldClaims: LegoFieldClaim[]
  roles: StructuralRole[]
  ambiguities: StructuralAmbiguity[]
  flags: StructuralFlag[]
  subexpressions: LocalSubexpression[]
  enclosures: EnclosureStructure[]
  contexts: ExpressionContext[]
  parseNodes: ExpressionParseNode[]
  parseRoots: ContextParseRoot[]
  normalization: NormalizationResult
  refinement?: HandwritingRefinementSummary
}