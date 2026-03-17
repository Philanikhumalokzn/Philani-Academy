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
    ancestry: ['expression', 'fraction', 'operator'],
    discriminators: ['must be line-like', 'prefers directly centered content above and below', 'prefers width comparable to the immediately above member span'],
  }),
}

export const getRoleDescriptor = (kind: StructuralRoleKind) => ROLE_TAXONOMY[kind]

export const roleCanOwnScripts = (kind: StructuralRoleKind) => ROLE_TAXONOMY[kind].canOwnScripts