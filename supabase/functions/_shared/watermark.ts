import type { ImageSize } from './image-providers.ts'

const dimensions: Record<ImageSize, readonly [number, number]> = {
  '1024x1024': [1024, 1024],
  '1536x1024': [1536, 1024],
  '1024x1536': [1024, 1536],
}

/**
 * Produces the only asset written to Storage for a free generation. Keeping
 * the provider PNG in memory (rather than uploading it first) prevents a
 * clean original from being exposed by CEZIK's own delivery path.
 */
export function makeWatermarkedImageAsset(bytes: Uint8Array, contentType: 'image/png', size: ImageSize) {
  const [width, height] = dimensions[size]
  const source = `data:${contentType};base64,${toBase64(bytes)}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="cezik-watermark" width="300" height="170" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
      <text x="0" y="84" fill="#ffffff" fill-opacity="0.30" font-family="Arial, sans-serif" font-size="29" font-weight="700" letter-spacing="4">CEZIK AI</text>
    </pattern>
  </defs>
  <image href="${source}" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect width="${width}" height="${height}" fill="url(#cezik-watermark)"/>
</svg>`
  return { bytes: new TextEncoder().encode(svg), contentType: 'image/svg+xml', extension: 'svg' }
}

function toBase64(bytes: Uint8Array) {
  let output = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(output)
}
