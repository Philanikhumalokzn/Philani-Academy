import type { StructuralRoleDescriptor, StructuralRoleKind } from './types'

const defineDescriptor = (descriptor: StructuralRoleDescriptor) => descriptor

export const ROLE_TAXONOMY: Record<StructuralRoleKind, StructuralRoleDescriptor> = {
  baseline: defineDescriptor({
    kind: 'baseline',
    family: 'expressionRoot',
    zone: 'center',
    anchor: 'inline',
    shape: 'freeform',
    canOwnScripts: true,
    allowedChildRoles: ['superscript', 'subscript'],
    forbiddenChildRoles: ['numerator', 'denominator', 'fractionBar'],
    peerRoles: ['baseline', 'fractionBar'],
    locality: { local: 1, adjacent: 0.58, distant: 0.22 },
    structuralBarrier: false,
    ancestry: ['expression', 'root'],
    discriminators: ['participates in the main baseline flow', 'can host local script structures'],
  }),
  superscript: defineDescriptor({
    kind: 'superscript',
    family: 'script',
    zone: 'upper',
    anchor: 'right',
    shape: 'freeform',
    canOwnScripts: true,
    allowedChildRoles: ['superscript', 'subscript'],
    forbiddenChildRoles: ['numerator', 'denominator', 'fractionBar'],
    peerRoles: ['subscript'],
    locality: { local: 1, adjacent: 0.52, distant: 0.16 },
    structuralBarrier: false,
    ancestry: ['expression', 'script', 'upperScript'],
    discriminators: ['prefers above-right placement', 'can itself host another local script'],
  }),
  subscript: defineDescriptor({
    kind: 'subscript',
    family: 'script',
    zone: 'lower',
    anchor: 'right',
    shape: 'freeform',
    canOwnScripts: true,
    allowedChildRoles: ['superscript', 'subscript'],
    forbiddenChildRoles: ['numerator', 'denominator', 'fractionBar'],
    peerRoles: ['superscript'],
    locality: { local: 1, adjacent: 0.52, distant: 0.16 },
    structuralBarrier: false,
    ancestry: ['expression', 'script', 'lowerScript'],
    discriminators: ['prefers below-right placement', 'is penalized when directly centered below its parent'],
  }),
  numerator: defineDescriptor({
    kind: 'numerator',
    family: 'fractionMember',
    zone: 'upper',
    anchor: 'centered',
    shape: 'freeform',
    canOwnScripts: true,
    allowedChildRoles: ['superscript', 'subscript'],
    forbiddenChildRoles: ['numerator', 'denominator', 'fractionBar'],
    peerRoles: ['denominator'],
    locality: { local: 1, adjacent: 0.64, distant: 0.2 },
    structuralBarrier: false,
    ancestry: ['expression', 'fraction', 'member', 'upperMember'],
    discriminators: ['sits above a fraction bar', 'prefers horizontal centering with the bar'],
  }),
  denominator: defineDescriptor({
    kind: 'denominator',
    family: 'fractionMember',
    zone: 'lower',
    anchor: 'centered',
    shape: 'freeform',
    canOwnScripts: true,
    allowedChildRoles: ['superscript', 'subscript'],
    forbiddenChildRoles: ['numerator', 'denominator', 'fractionBar'],
    peerRoles: ['numerator'],
    locality: { local: 0.9, adjacent: 0.54, distant: 0.18 },
    structuralBarrier: false,
    ancestry: ['expression', 'fraction', 'member', 'lowerMember'],
    discriminators: ['sits below a fraction bar', 'prefers horizontal centering with the bar'],
  }),
  fractionBar: defineDescriptor({
    kind: 'fractionBar',
    family: 'fractionStructure',
    zone: 'lower',
    anchor: 'centered',
    shape: 'horizontalLine',
    canOwnScripts: false,
    allowedChildRoles: ['numerator', 'denominator'],
    forbiddenChildRoles: ['superscript', 'subscript', 'fractionBar', 'baseline'],
    peerRoles: ['baseline'],
    locality: { local: 1, adjacent: 0.72, distant: 0.08 },
    structuralBarrier: true,
    ancestry: ['expression', 'fraction', 'operator'],
    discriminators: ['must be line-like', 'prefers directly centered content above and below', 'prefers width comparable to the immediately above member span'],
  }),
}

export const getRoleDescriptor = (kind: StructuralRoleKind) => ROLE_TAXONOMY[kind]

export const roleCanOwnScripts = (kind: StructuralRoleKind) => ROLE_TAXONOMY[kind].canOwnScripts

export const roleAllowsChildRole = (parentRole: StructuralRoleKind, childRole: StructuralRoleKind) => {
  const descriptor = ROLE_TAXONOMY[parentRole]
  if (descriptor.forbiddenChildRoles.includes(childRole)) return false
  return descriptor.allowedChildRoles.includes(childRole)
}

export const getRoleLocalityBias = (kind: StructuralRoleKind) => ROLE_TAXONOMY[kind].locality