import { useEffect, useMemo, useRef, useState } from 'react'
import RecognitionDebugPanel, { type DebugSection } from './RecognitionDebugPanel'
import { analyzeHandwrittenExpression, createHandwritingIncrementalState, getHandwritingFixture, HANDWRITING_FIXTURE_ORDER, type InkBounds, type InkPoint, type InkStroke } from '../lib/handwritingNormalization'
import type { HandwritingFixtureName } from '../lib/handwritingNormalization/fixtures'

const VIEWPORT = { width: 760, height: 420, padding: 28 }

const getGlobalBounds = (strokes: InkStroke[]): InkBounds => {
  if (!strokes.length) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, centerX: 0, centerY: 0 }
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (point.x < left) left = point.x
      if (point.x > right) right = point.x
      if (point.y < top) top = point.y
      if (point.y > bottom) bottom = point.y
    }
  }
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  return { left, top, right, bottom, width, height, centerX: left + width / 2, centerY: top + height / 2 }
}

const fitPoint = (point: InkPoint, bounds: InkBounds) => {
  const scale = Math.min(
    (VIEWPORT.width - VIEWPORT.padding * 2) / Math.max(bounds.width, 1),
    (VIEWPORT.height - VIEWPORT.padding * 2) / Math.max(bounds.height, 1)
  )
  const offsetX = (VIEWPORT.width - bounds.width * scale) / 2 - bounds.left * scale
  const offsetY = (VIEWPORT.height - bounds.height * scale) / 2 - bounds.top * scale
  return { x: point.x * scale + offsetX, y: point.y * scale + offsetY }
}

const rawPoint = (point: InkPoint) => ({ x: point.x, y: point.y })

const strokePath = (stroke: InkStroke, bounds?: InkBounds | null) => {
  if (!stroke.points.length) return ''
  return stroke.points
    .map((point, index) => {
      const fitted = bounds ? fitPoint(point, bounds) : rawPoint(point)
      return `${index === 0 ? 'M' : 'L'} ${fitted.x.toFixed(2)} ${fitted.y.toFixed(2)}`
    })
    .join(' ')
}

const boundsRect = (bounds: InkBounds, globalBounds?: InkBounds | null) => {
  const topLeft = globalBounds ? fitPoint({ x: bounds.left, y: bounds.top }, globalBounds) : { x: bounds.left, y: bounds.top }
  const bottomRight = globalBounds ? fitPoint({ x: bounds.right, y: bounds.bottom }, globalBounds) : { x: bounds.right, y: bounds.bottom }
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  }
}

const roleColor = (role: string) => {
  if (role === 'unsupportedSymbol') return '#ff8f8f'
  if (role === 'superscript') return '#8bd0ff'
  if (role === 'subscript') return '#7ef0b0'
  if (role === 'fractionBar') return '#ffda6b'
  if (role === 'numerator') return '#f6a6ff'
  if (role === 'denominator') return '#ff9e7a'
  if (role === 'enclosureOpen' || role === 'enclosureClose') return '#ffd39a'
  return '#8fa7d8'
}

const fieldColor = (kind: string) => {
  if (kind === 'upperRightScript' || kind === 'lowerRightScript') return '#8bd0ff'
  if (kind === 'upperLeftScript' || kind === 'lowerLeftScript') return '#d5b4ff'
  if (kind === 'leftInline' || kind === 'rightInline') return '#7ef0b0'
  if (kind === 'over' || kind === 'under') return '#ffcf70'
  if (kind === 'interior') return '#ff9bc6'
  return '#c9d6ff'
}

export default function HandwritingNormalizationTestCanvas() {
  const [strokes, setStrokes] = useState<InkStroke[]>([])
  const [normalizationEnabled, setNormalizationEnabled] = useState(true)
  const [showBoxes, setShowBoxes] = useState(true)
  const [showEdges, setShowEdges] = useState(true)
  const [showFields, setShowFields] = useState(true)
  const [showFieldIntersections, setShowFieldIntersections] = useState(true)
  const [showDebugPanel, setShowDebugPanel] = useState(true)
  const [selectedFixture, setSelectedFixture] = useState<HandwritingFixtureName>('superscript')
  const activeStrokeRef = useRef<InkStroke | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const nextStrokeIdRef = useRef(1)
  const incrementalStateRef = useRef<ReturnType<typeof createHandwritingIncrementalState> | null>(null)

  const analysis = useMemo(() => analyzeHandwrittenExpression(strokes, { incrementalState: incrementalStateRef.current }), [strokes])
  const outputStrokes = normalizationEnabled ? analysis.normalization.strokes : strokes
  const outputBounds = useMemo(() => getGlobalBounds(outputStrokes), [outputStrokes])

  useEffect(() => {
    incrementalStateRef.current = createHandwritingIncrementalState(analysis)
  }, [analysis])

  const debugSections = useMemo<DebugSection[]>(() => {
    const grouped = analysis.groups.map((group) => `${group.id}: ${group.strokeIds.length} stroke(s), ${Math.round(group.bounds.width)}x${Math.round(group.bounds.height)}`)
    const brickHypotheses = analysis.brickHypotheses.map((hypothesis) => `${hypothesis.groupId}: ${hypothesis.family} prototype=${hypothesis.prototype} score=${hypothesis.score.toFixed(2)} fields=[${hypothesis.fields.map((field) => `${field.kind}:${field.capacity}:${field.weight.toFixed(2)}`).join(', ')}]${hypothesis.evidence.length ? ` :: ${hypothesis.evidence.join(' | ')}` : ''}`)
    const brickOccupancies = analysis.brickOccupancies.map((occupancy) => `${occupancy.groupId}: ${occupancy.family} field=${occupancy.field} score=${occupancy.score.toFixed(2)}${occupancy.hostGroupId ? ` host=${occupancy.hostGroupId}` : ''}${occupancy.hostContextId ? ` ctx=${occupancy.hostContextId}` : ''}${occupancy.evidence.length ? ` :: ${occupancy.evidence.join(' | ')}` : ''}`)
    const edges = analysis.edges.slice(0, 12).map((edge) => {
      if (edge.kind === 'sequence') {
        const fromRight = edge.metrics.fromRightInlineWeight
        const toLeft = edge.metrics.toLeftInlineWeight
        const inlineAffordance = edge.metrics.inlineAffordanceScore
        return `${edge.kind} ${edge.fromId} -> ${edge.toId} (${edge.score.toFixed(2)}) inline=${inlineAffordance >= 0 ? inlineAffordance.toFixed(2) : 'legacy'} fromRight=${fromRight >= 0 ? fromRight.toFixed(2) : 'legacy'} toLeft=${toLeft >= 0 ? toLeft.toFixed(2) : 'legacy'}`
      }

      return `${edge.kind} ${edge.fromId} -> ${edge.toId} (${edge.score.toFixed(2)})`
    })
    const roles = analysis.roles.map((role) => `${role.groupId}: ${role.role} label=${role.qualifiedRoleLabel || `${role.role}-unknown`} symbol=${role.recognizedSymbol?.value || 'unknown'} family=${role.descriptor.family} depth=${role.depth} score=${role.score.toFixed(2)}${role.parentGroupId ? ` parent=${role.parentGroupId}` : ''}${role.hostedContextKind ? ` hosted=${role.hostedContextKind}` : ''}${role.associationContextId ? ` assoc=${role.associationContextId}` : ''}${role.containerGroupIds.length ? ` containers=${role.containerGroupIds.join(',')}` : ''}${role.evidence.length ? ` :: ${role.evidence.join(' | ')}` : ''}`)
    const ambiguities = analysis.ambiguities.map((ambiguity) => {
      const alternatives = ambiguity.candidates.map((candidate) => `${candidate.role}:${candidate.score.toFixed(2)}`).join(' | ')
      return `${ambiguity.groupId}: ${ambiguity.reason} -> ${ambiguity.chosenRole} [${alternatives}]`
    })
    const flags = analysis.flags.map((flag) => `${flag.kind}: ${flag.groupIds.join(', ')} :: ${flag.message}`)
    const subexpressions = analysis.subexpressions.map((subexpression) => {
      const members = subexpression.memberGroupIds.join(', ')
      const attachments = subexpression.attachments.map((attachment) => `${attachment.parentGroupId}->${attachment.childGroupId}:${attachment.role}`).join(' | ')
      return `${subexpression.rootGroupId}: ${subexpression.rootRole} [${members}]${attachments ? ` :: ${attachments}` : ''}`
    })
    const enclosures = analysis.enclosures.map((enclosure) => `${enclosure.kind}: ${enclosure.openGroupId} ... ${enclosure.closeGroupId} members=[${enclosure.memberRootIds.join(', ')}] score=${enclosure.score.toFixed(2)}`)
    const contexts = analysis.contexts.map((context) => `${context.id}: ${context.kind}${context.parentContextId ? ` parent=${context.parentContextId}` : ''}${context.semanticRootGroupId ? ` root=${context.semanticRootGroupId}` : ''} anchors=[${context.anchorGroupIds.join(', ')}] members=[${context.memberGroupIds.join(', ')}]`)
    const fieldInstances = analysis.fieldInstances.map((field) => `${field.hostGroupId}: ${field.kind} family=${field.hostFamily} dir=${field.direction} topology=${field.topology} closure=${field.closureRatio.toFixed(2)} inner=${field.innerClosureRatio.toFixed(2)} outer=${field.outerClosureRatio.toFixed(2)} open=[${field.openSides.join(',') || 'none'}] strength=${field.ownershipStrength.toFixed(2)} bounds=${Math.round(field.bounds.left)},${Math.round(field.bounds.top)} ${Math.round(field.bounds.width)}x${Math.round(field.bounds.height)}`)
    const fieldIntersections = analysis.fieldIntersections.map((intersection) => `${intersection.leftHostGroupId}:${intersection.leftKind} x ${intersection.rightHostGroupId}:${intersection.rightKind} interaction=${intersection.interactionKind} overlap=${intersection.overlapRatio.toFixed(2)} coop=${intersection.cooperativeScore.toFixed(2)} comp=${intersection.competitiveScore.toFixed(2)} dominant=${intersection.dominantHostGroupId || 'tie'}:${intersection.dominantKind || 'tie'} margin=${intersection.dominanceMargin.toFixed(2)}`)
    const topFieldClaims = analysis.groups.map((group) => {
      const claims = analysis.fieldClaims
        .filter((claim) => claim.targetGroupId === group.id)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
      if (!claims.length) return `${group.id}: no external field owner claims`
      return `${group.id}: ${claims.map((claim) => `${claim.hostGroupId}:${claim.fieldKind}@${claim.score.toFixed(2)} topology=${claim.fieldTopology} dir=${claim.fieldDirection} closure=${claim.closureRatio.toFixed(2)} realize=${claim.realizationScore.toFixed(2)} compat=${claim.directionalCompatibilityScore.toFixed(2)} shared=${claim.sharedCompatibilityScore.toFixed(2)} counterpart=${claim.counterpartFieldKind || 'none'} overlap=${claim.overlapRatio.toFixed(2)}`).join(' | ')}`
    })
    const parseNodes = analysis.parseNodes.map((node) => {
      const alternatives = node.alternatives?.length
        ? ` alternatives=[${node.alternatives.map((alternative) => `#${alternative.rank}:${alternative.role}/${alternative.nodeKind}@${alternative.nodeId} ctx=${alternative.contextId || 'none'} parent=${alternative.parentGroupId || 'none'} score=${alternative.score.toFixed(2)} ${alternative.relation}`).join(' | ')}]`
        : ''
      return `${node.id}: ${node.kind} ctx=${node.contextId}${node.role ? ` role=${node.role}` : ''}${node.operatorGroupId ? ` op=${node.operatorGroupId}` : ''}${node.childOrderingStrategy ? ` assembly=${node.childOrderingStrategy}` : ''}${node.ambiguityReason ? ` ambiguity=${node.ambiguityReason}` : ''}${node.preferredChildNodeId ? ` preferred=${node.preferredChildNodeId}` : ''} groups=[${node.groupIds.join(', ')}] children=[${node.childNodeIds.join(', ')}]${alternatives}`
    })
    const parseRoots = analysis.parseRoots.map((root) => `${root.contextId}: root=${root.rootNodeId || 'none'} assembly=${root.assemblyStrategy || 'topLevelSpatial'} nodes=[${root.nodeIds.join(', ')}]`)

    return [
      {
        title: 'Input',
        fields: [
          { label: 'Stroke count', value: strokes.length },
          { label: 'Group count', value: analysis.groups.length },
          { label: 'Normalization', value: normalizationEnabled ? 'Enabled' : 'Disabled' },
          { label: 'Refinement passes', value: analysis.refinement?.passes.length || 0 },
          { label: 'Warm start', value: analysis.refinement?.warmStart?.enabled ? `${analysis.refinement?.warmStart?.matchedGroups || 0} matched` : 'Disabled' },
        ],
      },
      {
        title: 'Groups',
        fields: grouped.length ? grouped.map((value, index) => ({ label: `G${index + 1}`, value })) : [{ label: 'Groups', value: 'No grouped strokes yet' }],
      },
      {
        title: 'LEGO Hypotheses',
        fields: brickHypotheses.length ? brickHypotheses.map((value, index) => ({ label: `B${index + 1}`, value })) : [{ label: 'LEGO Hypotheses', value: 'No brick hypotheses yet' }],
      },
      {
        title: 'LEGO Occupancies',
        fields: brickOccupancies.length ? brickOccupancies.map((value, index) => ({ label: `O${index + 1}`, value })) : [{ label: 'LEGO Occupancies', value: 'No brick occupancies yet' }],
      },
      {
        title: 'Field Boxes',
        fields: fieldInstances.length ? fieldInstances.map((value, index) => ({ label: `FB${index + 1}`, value })) : [{ label: 'Field Boxes', value: 'No concrete field boxes yet' }],
      },
      {
        title: 'Field Intersections',
        fields: fieldIntersections.length ? fieldIntersections.map((value, index) => ({ label: `FI${index + 1}`, value })) : [{ label: 'Field Intersections', value: 'No competing field overlaps yet' }],
      },
      {
        title: 'Field Claims',
        fields: topFieldClaims.length ? topFieldClaims.map((value, index) => ({ label: `FC${index + 1}`, value })) : [{ label: 'Field Claims', value: 'No field ownership claims yet' }],
      },
      {
        title: 'Relations',
        fields: edges.length ? edges.map((value, index) => ({ label: `R${index + 1}`, value })) : [{ label: 'Relations', value: 'No scored relations yet' }],
      },
      {
        title: 'Roles',
        fields: roles.length ? roles.map((value, index) => ({ label: `Role ${index + 1}`, value })) : [{ label: 'Roles', value: 'No structural roles yet' }],
      },
      {
        title: 'Ambiguities',
        fields: ambiguities.length ? ambiguities.map((value, index) => ({ label: `A${index + 1}`, value })) : [{ label: 'Ambiguities', value: 'No close competing interpretations detected' }],
      },
      {
        title: 'Flags',
        fields: flags.length ? flags.map((value, index) => ({ label: `F${index + 1}`, value })) : [{ label: 'Flags', value: 'No structural warnings detected' }],
      },
      {
        title: 'Subexpressions',
        fields: subexpressions.length ? subexpressions.map((value, index) => ({ label: `S${index + 1}`, value })) : [{ label: 'Subexpressions', value: 'No owned local structures detected' }],
      },
      {
        title: 'Enclosures',
        fields: enclosures.length ? enclosures.map((value, index) => ({ label: `E${index + 1}`, value })) : [{ label: 'Enclosures', value: 'No enclosure structures detected' }],
      },
      {
        title: 'Contexts',
        fields: contexts.length ? contexts.map((value, index) => ({ label: `C${index + 1}`, value })) : [{ label: 'Contexts', value: 'No explicit expression contexts detected' }],
      },
      {
        title: 'Parse Nodes',
        fields: parseNodes.length ? parseNodes.map((value, index) => ({ label: `P${index + 1}`, value })) : [{ label: 'Parse Nodes', value: 'No explicit parse nodes detected' }],
      },
      {
        title: 'Parse Roots',
        fields: parseRoots.length ? parseRoots.map((value, index) => ({ label: `PR${index + 1}`, value })) : [{ label: 'Parse Roots', value: 'No context parse roots detected' }],
      },
    ]
  }, [analysis.ambiguities, analysis.brickHypotheses, analysis.brickOccupancies, analysis.contexts, analysis.edges, analysis.enclosures, analysis.fieldClaims, analysis.fieldInstances, analysis.fieldIntersections, analysis.flags, analysis.groups, analysis.parseNodes, analysis.parseRoots, analysis.roles, analysis.subexpressions, normalizationEnabled, strokes.length])

  const updateActiveStroke = (clientX: number, clientY: number, target: SVGSVGElement) => {
    const current = activeStrokeRef.current
    if (!current) return
    const rect = target.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * VIEWPORT.width
    const y = ((clientY - rect.top) / rect.height) * VIEWPORT.height
    const lastPoint = current.points[current.points.length - 1]
    if (lastPoint && Math.abs(lastPoint.x - x) < 0.5 && Math.abs(lastPoint.y - y) < 0.5) {
      return
    }
    current.points.push({ x, y, t: Date.now() })
    setStrokes((prev) => {
      const withoutLast = prev.slice(0, -1)
      return [...withoutLast, { ...current, points: [...current.points] }]
    })
  }

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const target = event.currentTarget
    activePointerIdRef.current = event.pointerId
    target.setPointerCapture(event.pointerId)
    const rect = target.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * VIEWPORT.width
    const y = ((event.clientY - rect.top) / rect.height) * VIEWPORT.height
    const stroke: InkStroke = {
      id: `stroke-${nextStrokeIdRef.current++}`,
      color: '#f8fbff',
      width: 4,
      startedAt: Date.now(),
      points: [{ x, y, t: Date.now() }],
    }
    activeStrokeRef.current = stroke
    setStrokes((prev) => [...prev, stroke])
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return
    updateActiveStroke(event.clientX, event.clientY, event.currentTarget)
  }

  const finishStroke = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return
    const target = event.currentTarget
    updateActiveStroke(event.clientX, event.clientY, target)
    target.releasePointerCapture(event.pointerId)
    activePointerIdRef.current = null
    const current = activeStrokeRef.current
    if (current) current.endedAt = Date.now()
    activeStrokeRef.current = null
  }

  const loadSample = (preset: HandwritingFixtureName) => {
    const fixture = getHandwritingFixture(preset)
    nextStrokeIdRef.current = fixture.strokes.length + 1
    incrementalStateRef.current = null
    setSelectedFixture(preset)
    setStrokes(fixture.strokes)
  }

  const renderStrokeLayer = (items: InkStroke[], bounds?: InkBounds | null, emphasizeRoles = false) => {
    return items.map((stroke) => {
      const strokeBounds = getGlobalBounds([stroke])
      const shouldRenderDot = stroke.points.length <= 1 || (strokeBounds.width < 3 && strokeBounds.height < 3)
      if (shouldRenderDot) {
        const point = stroke.points[0]
        if (!point) return null
        const mapped = bounds ? fitPoint(point, bounds) : rawPoint(point)
        return (
          <circle
            key={stroke.id}
            cx={mapped.x}
            cy={mapped.y}
            r={Math.max(2.2, ((stroke.width || 4) * 0.9) / 2)}
            fill={stroke.color || '#eef4ff'}
            opacity={emphasizeRoles ? 0.95 : 0.9}
          />
        )
      }

      return (
        <path
          key={stroke.id}
          d={strokePath(stroke, bounds)}
          fill="none"
          stroke={stroke.color || '#eef4ff'}
          strokeWidth={Math.max(1.8, (stroke.width || 4) * 0.9)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={emphasizeRoles ? 0.95 : 0.9}
        />
      )
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
        <button
          type="button"
          className="rounded-full border border-[#8cc9ff]/40 bg-[#0d2748] px-4 py-2 text-sm text-white transition hover:bg-[#12345c]"
          onClick={() => {
            incrementalStateRef.current = null
            setStrokes([])
          }}
        >
          Clear
        </button>
        {HANDWRITING_FIXTURE_ORDER.map((fixtureName) => {
          const fixture = getHandwritingFixture(fixtureName)
          const active = selectedFixture === fixtureName
          return (
            <button
              key={fixtureName}
              type="button"
              className={`rounded-full border px-4 py-2 text-sm transition ${active ? 'border-[#99ceff]/45 bg-[#16345b] text-white' : 'border-white/12 bg-white/8 text-white/88 hover:bg-white/12'}`}
              onClick={() => loadSample(fixtureName)}
              title={fixture.description}
            >
              {fixture.label}
            </button>
          )
        })}

        <label className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/88">
          <input type="checkbox" checked={normalizationEnabled} onChange={(event) => setNormalizationEnabled(event.target.checked)} />
          Normalize preview
        </label>
        <label className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/88">
          <input type="checkbox" checked={showBoxes} onChange={(event) => setShowBoxes(event.target.checked)} />
          Show groups
        </label>
        <label className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/88">
          <input type="checkbox" checked={showEdges} onChange={(event) => setShowEdges(event.target.checked)} />
          Show graph
        </label>
        <label className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/88">
          <input type="checkbox" checked={showFields} onChange={(event) => setShowFields(event.target.checked)} />
          Show field boxes
        </label>
        <label className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/88">
          <input type="checkbox" checked={showFieldIntersections} onChange={(event) => setShowFieldIntersections(event.target.checked)} />
          Show field intersections
        </label>
        <button type="button" className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-white/88 transition hover:bg-white/12" onClick={() => setShowDebugPanel((value) => !value)}>
          {showDebugPanel ? 'Hide debug' : 'Show debug'}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,17,43,0.96),rgba(4,10,28,0.94))] shadow-[0_24px_64px_rgba(2,6,23,0.32)]">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="text-xs uppercase tracking-[0.24em] text-[#7ea0d9]">Input ink</div>
            <div className="mt-1 text-lg font-semibold text-white">Raw handwritten capture</div>
            <div className="text-sm text-white/68">Draw directly here. The current milestone focuses on stronger grouping plus explicit ambiguity reporting before deeper parsing rules.</div>
          </div>
          <div className="flex-1 p-4">
            <svg
              viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`}
              className="h-full w-full rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_top,#102755,transparent_55%),linear-gradient(180deg,#051225,#020817)] touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
            >
              <rect x="0" y="0" width={VIEWPORT.width} height={VIEWPORT.height} fill="transparent" />
              {showFields && analysis.fieldInstances.map((field) => {
                const rect = boundsRect(field.bounds, null)
                const stroke = fieldColor(field.kind)
                const opacity = Math.min(0.34, 0.08 + field.ownershipStrength * 0.12 + field.closureRatio * 0.08)
                const dash = field.topology === 'semiBounded' || field.topology === 'unbounded' ? '4 4' : undefined
                return (
                  <g key={field.id}>
                    <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="12" fill={stroke} fillOpacity={opacity} stroke={stroke} strokeWidth="1.2" strokeOpacity="0.74" strokeDasharray={dash} />
                    <text x={rect.x + 8} y={Math.max(14, rect.y + 16)} fill={stroke} fontSize="10.5" fontWeight="600" opacity="0.96">
                      {field.kind}:{field.topology}
                    </text>
                  </g>
                )
              })}
              {showFieldIntersections && analysis.fieldIntersections.map((intersection) => {
                const rect = boundsRect(intersection.bounds, null)
                return (
                  <g key={intersection.id}>
                    <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="10" fill={intersection.interactionKind === 'cooperative' ? '#7ef0b0' : '#ff8ad8'} fillOpacity="0.12" stroke={intersection.interactionKind === 'cooperative' ? '#7ef0b0' : '#ff8ad8'} strokeWidth="1.3" strokeDasharray="4 4" opacity="0.9" />
                    <text x={rect.x + 6} y={Math.max(12, rect.y + 14)} fill="#ffc4ea" fontSize="10" fontWeight="600">
                      {intersection.interactionKind === 'cooperative' ? 'coop' : intersection.dominantKind || 'tie'}
                    </text>
                  </g>
                )
              })}
              {renderStrokeLayer(strokes, null)}
              {showBoxes && analysis.groups.map((group) => {
                const rect = boundsRect(group.bounds, null)
                const role = analysis.roles.find((entry) => entry.groupId === group.id)
                return (
                  <g key={group.id}>
                    <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="12" fill="none" stroke={roleColor(role?.role || 'baseline')} strokeWidth="1.6" strokeDasharray="6 5" opacity="0.9" />
                    <text x={rect.x + 10} y={Math.max(16, rect.y + 18)} fill={roleColor(role?.role || 'baseline')} fontSize="13" fontWeight="600">
                      {role?.role || 'baseline'}
                    </text>
                  </g>
                )
              })}
              {showEdges && analysis.edges.slice(0, 18).map((edge) => {
                const from = analysis.groups.find((group) => group.id === edge.fromId)
                const to = analysis.groups.find((group) => group.id === edge.toId)
                if (!from || !to) return null
                const start = rawPoint({ x: from.bounds.centerX, y: from.bounds.centerY })
                const end = rawPoint({ x: to.bounds.centerX, y: to.bounds.centerY })
                return (
                  <g key={edge.id} opacity={Math.max(0.28, edge.score)}>
                    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#67b9ff" strokeWidth="1.4" />
                    <text x={(start.x + end.x) / 2 + 6} y={(start.y + end.y) / 2 - 4} fill="#b5d9ff" fontSize="11">
                      {edge.kind} {edge.score.toFixed(2)}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
        </section>

        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,22,42,0.96),rgba(6,10,24,0.94))] shadow-[0_24px_64px_rgba(2,6,23,0.32)]">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="text-xs uppercase tracking-[0.24em] text-[#b4cfff]">Normalized output</div>
            <div className="mt-1 text-lg font-semibold text-white">Structure-aware handwritten preview</div>
            <div className="text-sm text-white/68">The output remains ink-based. Role inference drives scale, placement, and baseline alignment.</div>
          </div>
          <div className="flex-1 p-4">
            <svg viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`} className="h-full w-full rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_top,#15305e,transparent_58%),linear-gradient(180deg,#081427,#030813)]">
              <rect x="0" y="0" width={VIEWPORT.width} height={VIEWPORT.height} fill="transparent" />
              {renderStrokeLayer(outputStrokes, outputBounds, true)}
              {showBoxes && analysis.normalization.groups.map((group) => {
                const role = analysis.roles.find((entry) => entry.groupId === group.id)
                const rect = boundsRect(group.bounds, outputBounds)
                return <rect key={group.id} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="12" fill="none" stroke={roleColor(role?.role || 'baseline')} strokeWidth="1.6" opacity="0.92" />
              })}
            </svg>
          </div>
        </section>
      </div>

      <RecognitionDebugPanel
        visible={showDebugPanel}
        title="Normalization Lab Debug"
        sections={debugSections}
        onClose={() => setShowDebugPanel(false)}
        storageKey="philani:normalization-lab:debug-panel"
        defaultPosition={{ x: 32, y: 110 }}
      />
    </div>
  )
}