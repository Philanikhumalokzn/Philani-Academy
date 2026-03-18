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
		prototypeKinds: ['operatorCross', 'horizontalLine', 'compactGlyph'],
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
			makeField('rightInline', 0.2, 'sequence', ['weak right inline continuation']),
		],
		evidence: ['radical bricks host interior content and optionally a left index field'],
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
	const tallEnough = clamp((group.bounds.height - 54) / 62, 0, 1)
	const narrowness = clamp(1 - group.bounds.width / Math.max(28, group.bounds.height * 0.72), 0, 1)
	const aspectBias = clamp((0.9 - group.aspectRatio) / 0.45, 0, 1)
	return tallEnough * 0.38 + narrowness * 0.34 + aspectBias * 0.28
}

const getCrossOperatorScore = (group: StrokeGroup) => {
	const strokeCountBias = group.strokeCount === 2 ? 1 : 0.32
	const compactness = clamp(1 - Math.abs(group.aspectRatio - 1) / 1.15, 0, 1)
	return strokeCountBias * 0.58 + compactness * 0.42
}

const getRadicalGlyphScore = (group: StrokeGroup) => {
	const singleStrokeBias = group.strokeCount === 1 ? 1 : 0.28
	const widthBias = clamp((group.bounds.width - 34) / 54, 0, 1)
	const heightBias = clamp((group.bounds.height - 26) / 46, 0, 1)
	return singleStrokeBias * 0.46 + widthBias * 0.28 + heightBias * 0.26
}

const getCompactGlyphScore = (group: StrokeGroup) => {
	const notTooFlat = clamp(1 - Math.max(group.aspectRatio - 3.4, 0) / 2.8, 0, 1)
	const notTooTall = clamp(1 - Math.max((group.bounds.height / Math.max(group.bounds.width, 1)) - 3.2, 0) / 2.2, 0, 1)
	const densityBias = clamp(group.density * 2200, 0, 1)
	return notTooFlat * 0.4 + notTooTall * 0.28 + densityBias * 0.32
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
	const radicalScore = getRadicalGlyphScore(group)
	const compactGlyphScore = getCompactGlyphScore(group)

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
			score: Math.max(operatorScore, horizontalLineScore * 0.72),
			evidence: [`operator-score=${Math.max(operatorScore, horizontalLineScore * 0.72).toFixed(2)}`, 'inline operator affordances are plausible'],
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
			score: Math.max(0.34, compactGlyphScore),
			evidence: [`compact-glyph-score=${compactGlyphScore.toFixed(2)}`, 'ordinary baseline symbol brick is the default local body family'],
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
