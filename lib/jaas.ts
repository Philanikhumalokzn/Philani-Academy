export type JaasUser = {
  name?: string
  id?: string
  email?: string
  avatar?: string
}

export type JaasFeatures = {
  livestreaming: boolean
  'file-upload': boolean
  'outbound-call': boolean
  'sip-outbound-call': boolean
  transcription: boolean
  'list-visitors': boolean
  recording: boolean
  flip: boolean
}

export type BuildJaasPayloadOpts = {
  sub: string // JaaS tenant, e.g. vpaas-magic-cookie-... (no key id)
  room: string // room name or '*'
  ttlSeconds: number // token validity window
  moderator: boolean
  user: JaasUser
  nowSeconds?: number // override for testing
  featuresOverride?: Partial<JaasFeatures>
}

export function buildJaasPayload(opts: BuildJaasPayloadOpts) {
  const now = Math.floor((opts.nowSeconds ?? Date.now()) / 1000)
  const ttl = Math.max(1, Math.floor(opts.ttlSeconds))

  const defaultFeatures: JaasFeatures = {
    livestreaming: true,
    'file-upload': true,
    'outbound-call': true,
    'sip-outbound-call': false,
    transcription: true,
    'list-visitors': false,
    recording: true,
    flip: false,
  }

  const features: JaasFeatures = { ...defaultFeatures, ...(opts.featuresOverride || {}) }

  return {
    aud: 'jitsi',
    iss: 'chat',
    iat: now,
    exp: now + ttl,
    nbf: now - 5,
    sub: opts.sub,
    context: {
      features,
      user: {
        'hidden-from-recorder': false,
        moderator: !!opts.moderator,
        name: opts.user.name || '',
        id: opts.user.id || opts.user.email || '',
        avatar: opts.user.avatar || '',
        email: opts.user.email || '',
      },
    },
    room: opts.room || '*',
  }
}

export function parseJaasSubFromKid(kid?: string): string | undefined {
  // kid example: vpaas-.../abcdef -> sub is the part before '/'
  if (!kid) return undefined
  const slash = kid.indexOf('/')
  return slash > 0 ? kid.slice(0, slash) : undefined
}
