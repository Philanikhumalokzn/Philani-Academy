#!/usr/bin/env node
/*
 * Utility script for managing Resend domains from the command line.
 *
 * Usage examples (ensure RESEND_API_KEY is exported first):
 *   node scripts/manage_resend_domain.js list
 *   node scripts/manage_resend_domain.js create philaniacademy.co.za --region us-east-1
 *   node scripts/manage_resend_domain.js verify <domain-id>
 *   node scripts/manage_resend_domain.js get <domain-id>
 *   node scripts/manage_resend_domain.js update <domain-id> --open-tracking=false --click-tracking=true
 *   node scripts/manage_resend_domain.js remove <domain-id>
 */

const { Resend } = require('resend')

function parseFlags(args) {
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const segment = args[i]
    if (!segment.startsWith('--')) continue
    const [key, rawValue] = segment.slice(2).split('=')
    const value = typeof rawValue === 'string' ? rawValue : args[i + 1]
    if (typeof rawValue !== 'string' && typeof args[i + 1] !== 'undefined' && !args[i + 1].startsWith('--')) {
      i++
    }
    flags[key] = value
  }
  return flags
}

function toBoolean(value, fallback) {
  if (typeof value === 'undefined') return fallback
  if (typeof value === 'boolean') return value
  const normalised = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true
  if (['false', '0', 'no', 'off'].includes(normalised)) return false
  return fallback
}

async function main() {
  const [, , action, ...args] = process.argv
  if (!action) {
    console.error('Action is required (create|get|verify|update|list|remove)')
    process.exit(1)
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('RESEND_API_KEY environment variable is required')
    process.exit(1)
  }

  const resend = new Resend(apiKey)
  const flags = parseFlags(args)

  try {
    switch (action) {
      case 'create': {
        const name = args.find((arg) => !arg.startsWith('--'))
        if (!name) {
          console.error('Domain name is required: create <domain> [--region value] [--custom-return-path value]')
          process.exit(1)
        }
        const payload = {
          name,
          region: flags.region,
          customReturnPath: flags['custom-return-path'],
          openTracking: toBoolean(flags['open-tracking'], undefined),
          clickTracking: toBoolean(flags['click-tracking'], undefined)
        }
        const response = await resend.domains.create(payload)
        console.log('Domain created:', response)
        break
      }
      case 'get': {
        const domainId = args.find((arg) => !arg.startsWith('--'))
        if (!domainId) {
          console.error('Domain id is required: get <domain-id>')
          process.exit(1)
        }
        const response = await resend.domains.get(domainId)
        console.log(response)
        break
      }
      case 'verify': {
        const domainId = args.find((arg) => !arg.startsWith('--'))
        if (!domainId) {
          console.error('Domain id is required: verify <domain-id>')
          process.exit(1)
        }
        const response = await resend.domains.verify(domainId)
        console.log('Verification response:', response)
        break
      }
      case 'update': {
        const domainId = args.find((arg) => !arg.startsWith('--'))
        if (!domainId) {
          console.error('Domain id is required: update <domain-id> [--open-tracking bool] [--click-tracking bool]')
          process.exit(1)
        }
        const response = await resend.domains.update({
          id: domainId,
          openTracking: toBoolean(flags['open-tracking'], undefined),
          clickTracking: toBoolean(flags['click-tracking'], undefined)
        })
        console.log('Update response:', response)
        break
      }
      case 'list': {
        const response = await resend.domains.list()
        console.log(response)
        break
      }
      case 'remove': {
        const domainId = args.find((arg) => !arg.startsWith('--'))
        if (!domainId) {
          console.error('Domain id is required: remove <domain-id>')
          process.exit(1)
        }
        await resend.domains.remove(domainId)
        console.log('Domain removed:', domainId)
        break
      }
      default:
        console.error(`Unknown action: ${action}`)
        process.exit(1)
    }
  } catch (err) {
    console.error(`Resend ${action} failed`, err)
    process.exit(1)
  }
}

main()
