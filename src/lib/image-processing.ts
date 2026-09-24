export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export type ImageDetails = {
  width: number
  height: number
  bytes: number
  type: string
}

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 6000
export const acceptedImageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const

const extensionByType: Record<OutputFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

let backgroundRemover: Promise<BackgroundRemovalPipeline> | null = null

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function filenameFor(file: File, extension: string) {
  const stem = file.name.replace(/\.[^.]+$/, '') || 'cezik-image'
  return `${stem}-cezik.${extension}`
}

export function validateImageFile(file: File) {
  if (!acceptedImageTypes.includes(file.type as (typeof acceptedImageTypes)[number])) {
    return 'Please choose a JPG, PNG, or WebP image.'
  }
  if (file.size > MAX_IMAGE_BYTES) return 'Please choose an image smaller than 12 MB.'
  return null
}

export async function readImageDetails(file: Blob): Promise<ImageDetails> {
  const bitmap = await createImageBitmap(file)
  const details = { width: bitmap.width, height: bitmap.height, bytes: file.size, type: file.type }
  bitmap.close()
  if (details.width > MAX_IMAGE_DIMENSION || details.height > MAX_IMAGE_DIMENSION) {
    throw new Error('Please choose an image no wider or taller than 6,000 pixels.')
  }
  return details
}

async function drawImage(file: Blob, width?: number, height?: number) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width ?? bitmap.width)
  canvas.height = Math.round(height ?? bitmap.height)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('Your browser could not prepare this image.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: OutputFormat, quality?: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  if (!blob) throw new Error('Your browser could not export this image. Please try another format.')
  return blob
}

export async function compressImage(file: File, format: Extract<OutputFormat, 'image/jpeg' | 'image/webp'>, quality: number) {
  const canvas = await drawImage(file)
  return canvasToBlob(canvas, format, quality)
}

export async function resizeImage(file: File, width: number, height: number, format: OutputFormat) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Please enter a width and height greater than zero.')
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new Error('Please keep each side at 6,000 pixels or less.')
  }
  const canvas = await drawImage(file, width, height)
  return canvasToBlob(canvas, format, format === 'image/png' ? undefined : 0.92)
}

export async function convertImage(file: File, format: OutputFormat) {
  const canvas = await drawImage(file)
  return canvasToBlob(canvas, format, format === 'image/png' ? undefined : 0.92)
}

export async function removeBackground(file: File, onProgress?: (percent: number) => void) {
  const source = URL.createObjectURL(file)
  try {
    if (!backgroundRemover) {
      backgroundRemover = import('@huggingface/transformers').then(async ({ pipeline }) => {
        return pipeline('background-removal', 'Xenova/modnet', {
          dtype: 'uint8',
          progress_callback: (event: { status?: string; progress?: number }) => {
            if (event.status === 'progress_total' && typeof event.progress === 'number') onProgress?.(event.progress)
          },
        })
      })
    }
    const loadingPipeline = backgroundRemover
    let segment: BackgroundRemovalPipeline
    try {
      segment = await loadingPipeline
    } catch (error) {
      if (backgroundRemover === loadingPipeline) backgroundRemover = null
      throw error
    }
    onProgress?.(100)
    const result = await segment(source)
    const canvas = document.createElement('canvas')
    canvas.width = result.width
    canvas.height = result.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not prepare this image.')
    context.putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0)
    return canvasToBlob(canvas, 'image/png')
  } finally {
    URL.revokeObjectURL(source)
  }
}

export { extensionByType }
import type { BackgroundRemovalPipeline } from '@huggingface/transformers'
