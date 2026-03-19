import { clamp } from './geometry'
import type {
	ExpressionContext,
	LayoutEdge,
	LegoBrickFamilyDescriptor,
	LegoBrickFamilyKind,
	LegoBrickHypothesis,
	LegoBrickOccupancy,
	LegoBrickPrototypeKind,
	LegoFieldCapacity,
	LegoFieldKind,
	StrokeGroup,
	StructuralRole,
} from './types'

const makeField = (kind: LegoFieldKind, weight: number, capacity: LegoFieldCapacity, evidence: string[]) => ({
	kind,
	weight,
	capacity,
	evidence,
})

export const LEGO_BRICK_FAMILIES: Record<LegoBrickFamilyKind, LegoBrickFamilyDescriptor> = {
	ordinaryBaselineSymbolBrick: {
		kind: 'ordinaryBaselineSymbolBrick',
		prototypeKinds: ['compactGlyph', 'operatorCross', 'unknown'],
		fields: [
			makeField('center', 1, 'single', ['intrinsic symbol body']),
			makeField('rightInline', 0.94, 'sequence', ['baseline continuation to the right']),
			makeField('leftInline', 0.62, 'sequence', ['baseline continuation to the left']),
			makeField('upperRightScript', 0.96, 'stackable', ['ordinary superscript export']),
			makeField('lowerRightScript', 0.96, 'stackable', ['ordinary subscript export']),
			makeField('upperLeftScript', 0.32, 'stackable', ['prescript allowance']),
			makeField('lowerLeftScript', 0.32, 'stackable', ['pre-subscript allowance']),
			makeField('over', 0.18, 'single', ['weak over attachment field']),
			makeField('under', 0.18, 'single', ['weak under attachment field']),
		],
		evidence: ['ordinary symbol brick exports the local 3x3 LEGO scaffold around a baseline body'],
	},
	operatorBrick: {
		kind: 'operatorBrick',
		prototypeKinds: ['operatorCross', 'horizontalLine'],
		fields: [
			makeField('center', 1, 'single', ['operator body']),
			makeField('leftInline', 0.96, 'sequence', ['operator expects a left operand']),
			makeField('rightInline', 0.96, 'sequence', ['operator expects a right operand']),
			makeField('over', 0.22, 'single', ['weak annotation field over operator']),
			makeField('under', 0.22, 'single', ['weak annotation field under operator']),
		],
		evidence: ['operator bricks are baseline participants with stronger inline than script affordances'],
	},
	fractionBarBrick: {
		kind: 'fractionBarBrick',
		prototypeKinds: ['horizontalLine'],
		fields: [
			makeField('center', 1, 'single', ['fraction bar body']),
			makeField('over', 0.98, 'hostedRegion', ['numerator hosted region']),
			makeField('under', 0.98, 'hostedRegion', ['denominator hosted region']),
			makeField('leftInline', 0.24, 'sequence', ['weak inline continuation to the left']),
			makeField('rightInline', 0.24, 'sequence', ['weak inline continuation to the right']),
		],
		evidence: ['fraction bars export hosted over and under fields rather than ordinary right-script fields'],
	},
	enclosureBoundaryBrick: {
		kind: 'enclosureBoundaryBrick',
		prototypeKinds: ['boundaryStroke'],
		fields: [
			makeField('center', 1, 'single', ['boundary body']),
			makeField('interior', 0.98, 'hostedRegion', ['enclosure interior hosted region']),
			makeField('upperRightScript', 0.36, 'stackable', ['whole-enclosure superscript field']),
			makeField('lowerRightScript', 0.36, 'stackable', ['whole-enclosure subscript field']),
		],
		evidence: ['enclosure boundaries host interior content instead of behaving like baseline glyphs'],
	},
	radicalBrick: {
		kind: 'radicalBrick',
		prototypeKinds: ['radicalGlyph'],
		fields: [
			makeField('center', 1, 'single', ['radical sign body']),
			makeField('interior', 0.96, 'hostedRegion', ['radicand hosted region']),
			makeField('upperLeftScript', 0.42, 'stackable', ['index field for radicals']),
			makeField('upperRightScript', 0.56, 'stackable', ['whole-radical superscript field']),
			makeField('lowerRightScript', 0.56, 'stackable', ['whole-radical subscript field']),
			makeField('rightInline', 0.2, 'sequence', ['weak right inline continuation']),
		],
		evidence: ['radical bricks host interior content, optionally a left index field, and may export whole-radical right scripts'],
	},
	unsupportedBrick: {
		kind: 'unsupportedBrick',
		prototypeKinds: ['unknown'],
		fields: [makeField('center', 1, 'single', ['preserved ink without a strong brick family'])],
		evidence: ['fallback LEGO brick family used when no stronger affordance family is supported'],
	},
}

const getFieldProfiles = (family: LegoBrickFamilyKind) => LEGO_BRICK_FAMILIES[family].fields

const getHorizontalLineScore = (group: StrokeGroup) => {
	const widthScore = clamp((group.bounds.width - 56) / 72, 0, 1)
	const heightScore = clamp(1 - Math.max(group.bounds.height - 18, 0) / 18, 0, 1)
	const flatnessScore = clamp((group.aspectRatio - 3.2) / 3.2, 0, 1)
	return widthScore * 0.32 + heightScore * 0.24 + flatnessScore * 0.44
}

const getBoundaryStrokeScore = (group: StrokeGroup) => {
	if (group.strokeCount !== 1) return 0.08
	const points = group.strokes?.[0]?.points || []
	if (points.length < 3) return 0.08
	let totalAbsDy = 0
	let directionalChanges = 0
	let previousDxSign = 0
	for (let index = 1; index < points.length; index += 1) {
		const dx = points[index].x - points[index - 1].x
		const dy = points[index].y - points[index - 1].y
		totalAbsDy += Math.abs(dy)
		const dxSign = Math.abs(dx) <= 1 ? 0 : Math.sign(dx)
		if (dxSign !== 0 && previousDxSign !== 0 && dxSign !== previousDxSign) {
			directionalChanges += 1
		}
		if (dxSign !== 0) previousDxSign = dxSign
	}
	const start = points[0]
	const end = points[points.length - 1]
	const tallEnough = clamp((group.bounds.height - 54) / 62, 0, 1)
	const narrowness = clamp(1 - group.bounds.width / Math.max(28, group.bounds.height * 0.72), 0, 1)
	const aspectBias = clamp((0.9 - group.aspectRatio) / 0.45, 0, 1)
	const verticalMonotonicity = totalAbsDy > 0 ? clamp(Math.abs(end.y - start.y) / totalAbsDy, 0, 1) : 0
	const endpointSpan = clamp(Math.abs(end.y - start.y) / Math.max(1, group.bounds.height), 0, 1)
	const lowReversalScore = clamp(1 - directionalChanges / 4, 0, 1)
	const compactGlyphInterference = clamp((getCompactGlyphScore(group) - 0.62) / 0.26, 0, 1)
	const rawScore = tallEnough * 0.28 + narrowness * 0.24 + aspectBias * 0.18 + verticalMonotonicity * 0.18 + endpointSpan * 0.08 + lowReversalScore * 0.04
	return clamp(rawScore - compactGlyphInterference * 0.22, 0, 1)
}

const getStrokeBounds = (group: StrokeGroup, strokeIndex: number) => {
	const stroke = group.strokes?.[strokeIndex]
	if (!stroke?.points?.length) return null
	const xs = stroke.points.map((point) => point.x)
	const ys = stroke.points.map((point) => point.y)
	const left = Math.min(...xs)
	const right = Math.max(...xs)
	const top = Math.min(...ys)
	const bottom = Math.max(...ys)
	return {
		left,
		right,
		top,
		bottom,
		width: right - left,
		height: bottom - top,
		centerX: (left + right) / 2,
		centerY: (top + bottom) / 2,
	}
}

const getStrokeProgressScore = (points: Array<{ x: number, y: number }>) => {
	if (points.length < 2) return 0
	let totalAbsDx = 0
	let forwardDx = 0
	for (let index = 1; index < points.length; index += 1) {
		const dx = points[index].x - points[index - 1].x
		totalAbsDx += Math.abs(dx)
		forwardDx += Math.max(dx, 0)
	}
	if (totalAbsDx <= 0) return 0
	return clamp(forwardDx / totalAbsDx, 0, 1)
}

const getOrthogonalCrossScore = (group: StrokeGroup) => {
	if ((group.strokes?.length || 0) !== 2) return 0
	const first = getStrokeBounds(group, 0)
	const second = getStrokeBounds(group, 1)
	if (!first || !second) return 0
	const firstHorizontal = first.width >= Math.max(18, first.height * 1.8)
	const firstVertical = first.height >= Math.max(18, first.width * 1.8)
	const secondHorizontal = second.width >= Math.max(18, second.height * 1.8)
	const secondVertical = second.height >= Math.max(18, second.width * 1.8)
	const orthogonalPair = (firstHorizontal && secondVertical) || (firstVertical && secondHorizontal)
	if (!orthogonalPair) return 0
	const centerDistance = Math.abs(first.centerX - second.centerX) + Math.abs(first.centerY - second.centerY)
	const centeredCross = clamp(1 - centerDistance / Math.max(18, (group.bounds.width + group.bounds.height) * 0.18), 0, 1)
	const spanBalance = clamp(1 - Math.abs(first.width - second.height) / Math.max(24, Math.max(first.width, second.height)), 0, 1)
	return centeredCross * 0.68 + spanBalance * 0.32
}

const getCrossOperatorScore = (group: StrokeGroup) => {
	const orthogonalCrossScore = getOrthogonalCrossScore(group)
	if (orthogonalCrossScore <= 0) return 0
	const compactness = clamp(1 - Math.abs(group.aspectRatio - 1) / 1.15, 0, 1)
	return orthogonalCrossScore * 0.82 + compactness * 0.18
}

const getExplicitOperatorCrossBoost = (group: StrokeGroup) => {
	return getOrthogonalCrossScore(group) * 0.24
}

const getRadicalGlyphScore = (group: StrokeGroup) => {
	if (group.strokeCount !== 1) return 0.12
	const points = group.strokes?.[0]?.points || []
	if (points.length < 4) return 0.12
	const valleyIndex = points.reduce((bestIndex, point, index, entries) => point.y > entries[bestIndex].y ? index : bestIndex, 0)
	const valley = points[valleyIndex]
	const end = points[points.length - 1]
	const previous = points[points.length - 2]
	const xProgressScore = getStrokeProgressScore(points)
	const valleyPlacementScore = clamp(1 - Math.abs((valleyIndex / Math.max(points.length - 1, 1)) - 0.28) / 0.24, 0, 1)
	const reboundScore = clamp((valley.y - end.y) / Math.max(18, group.bounds.height * 0.42), 0, 1)
	const roofHorizontalScore = clamp((end.x - previous.x) / Math.max(18, group.bounds.width * 0.18), 0, 1)
	const roofFlatnessScore = clamp(1 - Math.abs(end.y - previous.y) / Math.max(8, group.bounds.height * 0.12), 0, 1)
	const roofScore = roofHorizontalScore * roofFlatnessScore
	const widthBias = clamp((group.bounds.width - 34) / 54, 0, 1)
	return clamp(
		xProgressScore * 0.34
			+ valleyPlacementScore * 0.18
			+ reboundScore * 0.24
			+ roofScore * 0.16
			+ widthBias * 0.08,
		0,
		1,
	)
}

const getCompactGlyphScore = (group: StrokeGroup) => {
	const notTooFlat = clamp(1 - Math.max(group.aspectRatio - 3.4, 0) / 2.8, 0, 1)
	const notTooTall = clamp(1 - Math.max((group.bounds.height / Math.max(group.bounds.width, 1)) - 3.2, 0) / 2.2, 0, 1)
	const densityBias = clamp(group.density * 2200, 0, 1)
	return notTooFlat * 0.4 + notTooTall * 0.28 + densityBias * 0.32
}

const getOrdinaryBaselineSymbolScore = (
	compactGlyphScore: number,
	horizontalLineScore: number,
	boundaryScore: number,
	boostedOperatorScore: number,
	radicalScore: number,
	ordinaryBaselinePenalty: number,
	operatorDominancePenalty: number,
) => {
	const strongestStructuralAlternative = Math.max(horizontalLineScore, boundaryScore, boostedOperatorScore, radicalScore)
	const contextualPenalty = clamp((strongestStructuralAlternative - 0.3) / 0.52, 0, 0.22)
	return clamp(
		0.22
			+ compactGlyphScore * 0.46
			+ (1 - strongestStructuralAlternative) * 0.16
			- ordinaryBaselinePenalty
			- operatorDominancePenalty
			- contextualPenalty,
		0.26,
		0.88,
	)
}

const getPrototypeScore = (group: StrokeGroup, prototype: LegoBrickPrototypeKind) => {
	switch (prototype) {
		case 'horizontalLine':
			return getHorizontalLineScore(group)
		case 'boundaryStroke':
			return getBoundaryStrokeScore(group)
		case 'operatorCross':
			return getCrossOperatorScore(group)
		case 'radicalGlyph':
			return getRadicalGlyphScore(group)
		case 'compactGlyph':
			return getCompactGlyphScore(group)
		case 'unknown':
		default:
			return 0.18
	}
}

const inferFamilyCandidatesForGroup = (group: StrokeGroup) => {
	const horizontalLineScore = getHorizontalLineScore(group)
	const boundaryScore = getBoundaryStrokeScore(group)
	const operatorScore = getCrossOperatorScore(group)
	const explicitOperatorCrossBoost = getExplicitOperatorCrossBoost(group)
	const operatorLineScore = group.bounds.height <= Math.max(18, group.bounds.width * 0.28)
		? horizontalLineScore * 0.72
		: horizontalLineScore * 0.18
	const boostedOperatorScore = clamp(Math.max(operatorScore, operatorLineScore) + explicitOperatorCrossBoost, 0, 1)
	const radicalScore = getRadicalGlyphScore(group)
	const compactGlyphScore = getCompactGlyphScore(group)
	const ordinaryBaselinePenalty = radicalScore >= 0.72 ? clamp((radicalScore - 0.7) / 0.24, 0, 0.34) : 0
	const operatorDominancePenalty = explicitOperatorCrossBoost > 0 && boostedOperatorScore >= 0.9
		? clamp((boostedOperatorScore - 0.88) / 0.12, 0, 0.32)
		: 0
	const ordinaryBaselineScore = getOrdinaryBaselineSymbolScore(
		compactGlyphScore,
		horizontalLineScore,
		boundaryScore,
		boostedOperatorScore,
		radicalScore,
		ordinaryBaselinePenalty,
		operatorDominancePenalty,
	)

	const candidates: Array<{ family: LegoBrickFamilyKind, prototype: LegoBrickPrototypeKind, score: number, evidence: string[] }> = [
		{
			family: 'fractionBarBrick',
			prototype: 'horizontalLine',
			score: horizontalLineScore,
			evidence: [`horizontal-line-score=${horizontalLineScore.toFixed(2)}`, 'hosted over/under regions are plausible'],
		},
		{
			family: 'enclosureBoundaryBrick',
			prototype: 'boundaryStroke',
			score: boundaryScore,
			evidence: [`boundary-stroke-score=${boundaryScore.toFixed(2)}`, 'tall narrow boundary-like stroke is plausible'],
		},
		{
			family: 'operatorBrick',
			prototype: horizontalLineScore >= operatorScore ? 'horizontalLine' : 'operatorCross',
			score: boostedOperatorScore,
			evidence: [`operator-score=${boostedOperatorScore.toFixed(2)}`, `explicit-cross-boost=${explicitOperatorCrossBoost.toFixed(2)}`, 'inline operator affordances are plausible'],
		},
		{
			family: 'radicalBrick',
			prototype: 'radicalGlyph',
			score: radicalScore,
			evidence: [`radical-score=${radicalScore.toFixed(2)}`, 'radical-like hosted interior is plausible'],
		},
		{
			family: 'ordinaryBaselineSymbolBrick',
			prototype: compactGlyphScore >= operatorScore ? 'compactGlyph' : 'operatorCross',
			score: ordinaryBaselineScore,
			evidence: [
				`compact-glyph-score=${compactGlyphScore.toFixed(2)}`,
				`ordinary-score=${ordinaryBaselineScore.toFixed(2)}`,
				`alternative-pressure=${Math.max(horizontalLineScore, boundaryScore, boostedOperatorScore, radicalScore).toFixed(2)}`,
				'ordinary baseline symbol brick is a strong default local body family, but it is damped by competing structural affordances',
			],
		},
		{
			family: 'unsupportedBrick',
			prototype: 'unknown',
			score: 0.12,
			evidence: ['fallback unsupported brick candidate'],
		},
	]

	return candidates
		.filter((candidate) => candidate.score >= 0.2 || candidate.family === 'ordinaryBaselineSymbolBrick' || candidate.family === 'unsupportedBrick')
		.sort((left, right) => right.score - left.score)
}

export const inferLegoBrickHypotheses = (groups: StrokeGroup[]) => {
	return groups.flatMap((group) => {
		const familyCandidates = inferFamilyCandidatesForGroup(group)
		return familyCandidates.map((candidate, index) => ({
			id: `brick:${group.id}:${candidate.family}:${index + 1}`,
			groupId: group.id,
			prototype: candidate.prototype,
			family: candidate.family,
			score: candidate.score,
			fields: getFieldProfiles(candidate.family),
			evidence: [...candidate.evidence, ...LEGO_BRICK_FAMILIES[candidate.family].evidence],
		}))
	})
}

export const getTopBrickHypothesisByGroupId = (brickHypotheses: LegoBrickHypothesis[]) => {
	const hypothesisMap = new Map<string, LegoBrickHypothesis>()
	for (const hypothesis of brickHypotheses) {
		const current = hypothesisMap.get(hypothesis.groupId)
		if (!current || current.score < hypothesis.score) {
			hypothesisMap.set(hypothesis.groupId, hypothesis)
		}
	}
	return hypothesisMap
}

export const inferLegoBrickOccupancies = (
	brickHypotheses: LegoBrickHypothesis[],
	roles: StructuralRole[],
	contexts: ExpressionContext[],
	edges: LayoutEdge[],
) => {
	const topHypothesisByGroupId = getTopBrickHypothesisByGroupId(brickHypotheses)
	const contextMap = new Map(contexts.map((context) => [context.id, context]))
	const bestSequenceParentByGroupId = new Map<string, string>()

	for (const edge of edges.filter((entry) => entry.kind === 'sequence').sort((left, right) => right.score - left.score)) {
		if (!bestSequenceParentByGroupId.has(edge.toId)) {
			bestSequenceParentByGroupId.set(edge.toId, edge.fromId)
		}
	}

	return roles.map<LegoBrickOccupancy>((role) => {
		const topFamily = topHypothesisByGroupId.get(role.groupId)?.family || 'unsupportedBrick'
		if (role.role === 'superscript') {
			return {
				groupId: role.groupId,
				family: topFamily,
				field: 'upperRightScript',
				score: role.score,
				hostGroupId: role.parentGroupId || null,
				hostContextId: role.associationContextId || null,
				evidence: ['occupies the upper-right script field of its host brick'],
			}
		}

		if (role.role === 'subscript') {
			return {
				groupId: role.groupId,
				family: topFamily,
				field: 'lowerRightScript',
				score: role.score,
				hostGroupId: role.parentGroupId || null,
				hostContextId: role.associationContextId || null,
				evidence: ['occupies the lower-right script field of its host brick'],
			}
		}

		if (role.role === 'fractionBar' || role.role === 'provisionalFractionBar') {
			return {
				groupId: role.groupId,
				family: 'fractionBarBrick',
				field: 'center',
				score: role.score,
				hostGroupId: null,
				hostContextId: role.associationContextId || null,
				evidence: ['exports the LEGO over and under hosted fields'],
			}
		}

		if (role.role === 'radical') {
			return {
				groupId: role.groupId,
				family: 'radicalBrick',
				field: 'center',
				score: role.score,
				hostGroupId: null,
				hostContextId: role.associationContextId || null,
				evidence: ['exports the LEGO interior hosted field and optional upper-left index field'],
			}
		}

		if (role.hostedContextKind === 'numerator' || role.hostedContextKind === 'denominator') {
			const memberContext = role.hostedContextId ? contextMap.get(role.hostedContextId) || null : null
			const fractionContext = memberContext?.parentContextId ? contextMap.get(memberContext.parentContextId) || null : null
			const hostedSequenceParentId = bestSequenceParentByGroupId.get(role.groupId) || null
			if (hostedSequenceParentId && memberContext?.memberGroupIds.includes(hostedSequenceParentId)) {
				return {
					groupId: role.groupId,
					family: topFamily,
					field: 'rightInline',
					score: role.score,
					hostGroupId: hostedSequenceParentId,
					hostContextId: role.hostedContextId || null,
					evidence: [`occupies the right-inline field within the ${role.hostedContextKind} hosted region`],
				}
			}
			return {
				groupId: role.groupId,
				family: topFamily,
				field: role.hostedContextKind === 'numerator' ? 'over' : 'under',
				score: role.score,
				hostGroupId: fractionContext?.semanticRootGroupId || null,
				hostContextId: role.hostedContextId || null,
				evidence: [`occupies the ${role.hostedContextKind === 'numerator' ? 'over' : 'under'} hosted field of a fraction bar brick`],
			}
		}

		if (role.hostedContextKind === 'radicand') {
			const memberContext = role.hostedContextId ? contextMap.get(role.hostedContextId) || null : null
			const radicalContext = memberContext?.parentContextId ? contextMap.get(memberContext.parentContextId) || null : null
			const hostedSequenceParentId = bestSequenceParentByGroupId.get(role.groupId) || null
			if (hostedSequenceParentId && memberContext?.memberGroupIds.includes(hostedSequenceParentId)) {
				return {
					groupId: role.groupId,
					family: topFamily,
					field: 'rightInline',
					score: role.score,
					hostGroupId: hostedSequenceParentId,
					hostContextId: role.hostedContextId || null,
					evidence: ['occupies the right-inline field within the radicand hosted region'],
				}
			}
			return {
				groupId: role.groupId,
				family: topFamily,
				field: 'interior',
				score: role.score,
				hostGroupId: radicalContext?.semanticRootGroupId || null,
				hostContextId: role.hostedContextId || null,
				evidence: ['occupies the interior hosted field of a radical brick'],
			}
		}

		if (role.hostedContextKind === 'radicalIndex') {
			const memberContext = role.hostedContextId ? contextMap.get(role.hostedContextId) || null : null
			const radicalContext = memberContext?.parentContextId ? contextMap.get(memberContext.parentContextId) || null : null
			const hostedSequenceParentId = bestSequenceParentByGroupId.get(role.groupId) || null
			if (hostedSequenceParentId && memberContext?.memberGroupIds.includes(hostedSequenceParentId)) {
				return {
					groupId: role.groupId,
					family: topFamily,
					field: 'rightInline',
					score: role.score,
					hostGroupId: hostedSequenceParentId,
					hostContextId: role.hostedContextId || null,
					evidence: ['occupies the right-inline field within the radical index hosted region'],
				}
			}
			return {
				groupId: role.groupId,
				family: topFamily,
				field: 'upperLeftScript',
				score: role.score,
				hostGroupId: radicalContext?.semanticRootGroupId || null,
				hostContextId: role.hostedContextId || null,
				evidence: ['occupies the upper-left index field of a radical brick'],
			}
		}

		if (role.hostedContextKind === 'enclosure') {
			const memberContext = role.hostedContextId ? contextMap.get(role.hostedContextId) || null : null
			const hostedSequenceParentId = bestSequenceParentByGroupId.get(role.groupId) || null
			if (hostedSequenceParentId && memberContext?.memberGroupIds.includes(hostedSequenceParentId)) {
				return {
					groupId: role.groupId,
					family: topFamily,
					field: 'rightInline',
					score: role.score,
					hostGroupId: hostedSequenceParentId,
					hostContextId: role.hostedContextId || null,
					evidence: ['occupies the right-inline field within the enclosure interior'],
				}
			}
			return {
				groupId: role.groupId,
				family: topFamily,
				field: 'interior',
				score: role.score,
				hostGroupId: null,
				hostContextId: role.hostedContextId || null,
				evidence: ['occupies the interior hosted field of an enclosure boundary pair'],
			}
		}

		return {
			groupId: role.groupId,
			family: topFamily,
			field: bestSequenceParentByGroupId.has(role.groupId) ? 'rightInline' : 'center',
			score: role.score,
			hostGroupId: bestSequenceParentByGroupId.get(role.groupId) || null,
			hostContextId: role.associationContextId || null,
			evidence: bestSequenceParentByGroupId.has(role.groupId)
				? ['occupies the right-inline field in the current sequence frontier']
				: ['acts as a local center brick in its current context'],
		}
	})
}
