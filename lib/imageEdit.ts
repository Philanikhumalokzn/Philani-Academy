export type CropAreaPixels = { x: number; y: number; width: number; height: number }

const createImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.src = url
  })

const getRadianAngle = (degreeValue: number) => (degreeValue * Math.PI) / 180

const rotateSize = (width: number, height: number, rotation: number) => {
  const rotRad = getRadianAngle(rotation)
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  }
}

const extensionForMime = (mime: string) => {
  const m = String(mime || '').toLowerCase()
  if (m === 'image/jpeg') return '.jpg'
  if (m === 'image/webp') return '.webp'
  if (m === 'image/png') return '.png'
  return '.png'
}

const sanitizeBaseFilename = (name: string) => {
  const base = String(name || 'image').replace(/\.[^/.]+$/, '')
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'image'
}

export async function cropAndRotateImageToFile(opts: {
  imageUrl: string
  crop: CropAreaPixels
  rotation: number
  mimeType?: string
  quality?: number
  filenameHint?: string
}) {
  const { imageUrl, crop, rotation, mimeType, quality, filenameHint } = opts

  const safeMime = ['image/png', 'image/jpeg', 'image/webp'].includes(String(mimeType || '')) ? String(mimeType) : 'image/png'
  const safeQuality = typeof quality === 'number' && Number.isFinite(quality) ? Math.min(1, Math.max(0.1, quality)) : 0.92

  const image = await createImage(imageUrl)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')

  const rotRad = getRadianAngle(rotation)

  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(image.width, image.height, rotation)
  canvas.width = Math.round(bBoxWidth)
  canvas.height = Math.round(bBoxHeight)

  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(rotRad)
  ctx.translate(-image.width / 2, -image.height / 2)
  ctx.drawImage(image, 0, 0)

  const croppedCanvas = document.createElement('canvas')
  const croppedCtx = croppedCanvas.getContext('2d')
  if (!croppedCtx) throw new Error('Canvas not supported')

  croppedCanvas.width = Math.round(crop.width)
  croppedCanvas.height = Math.round(crop.height)

  croppedCtx.drawImage(
    canvas,
    Math.round(crop.x),
    Math.round(crop.y),
    Math.round(crop.width),
    Math.round(crop.height),
    0,
    0,
    Math.round(crop.width),
    Math.round(crop.height)
  )

  const blob: Blob = await new Promise((resolve, reject) => {
    try {
      croppedCanvas.toBlob(
        (b) => {
          if (!b) return reject(new Error('Failed to create image blob'))
          resolve(b)
        },
        safeMime,
        safeMime === 'image/jpeg' ? safeQuality : undefined
      )
    } catch (e) {
      reject(e)
    }
  })

  const base = sanitizeBaseFilename(filenameHint || 'edited')
  const ext = extensionForMime(blob.type || safeMime)
  const filename = `${base}_edited${ext}`

  return new File([blob], filename, { type: blob.type || safeMime })
}
