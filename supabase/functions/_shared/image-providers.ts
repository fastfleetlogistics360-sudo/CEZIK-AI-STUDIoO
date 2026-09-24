export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536'

export type ImageGenerationRequest = {
  prompt: string
  size: ImageSize
  outputFormat: 'png'
  jobId: string
  userId: string
}

export type ImageGenerationResult = {
  bytes: Uint8Array
  contentType: 'image/png'
  extension: 'png'
  provider: string
  model: string
  metadata: Record<string, unknown>
}

export interface ImageGenerationProvider {
  readonly id: string
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>
}

type OpenAiImageResponse = {
  data?: Array<{ b64_json?: string }>
  error?: { message?: string }
}

class OpenAIImageProvider implements ImageGenerationProvider {
  readonly id = 'openai:gpt-image-1'

  constructor(private readonly apiKey: string) {}

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: request.prompt,
        size: request.size,
        output_format: request.outputFormat,
      }),
    })
    const payload: OpenAiImageResponse = await response.json().catch(() => ({}))
    const base64 = payload.data?.[0]?.b64_json
    if (!response.ok || !base64) throw new Error(payload.error?.message ?? 'The image provider returned no image.')

    const raw = atob(base64)
    return {
      bytes: Uint8Array.from(raw, (character) => character.charCodeAt(0)),
      contentType: 'image/png',
      extension: 'png',
      provider: 'openai',
      model: 'gpt-image-1',
      metadata: { provider: 'openai', model: 'gpt-image-1', size: request.size, output_format: 'png' },
    }
  }
}

/**
 * Maps a server-side provider id to a CEZIK-owned contract. New vendors or a
 * self-hosted adapter are added here; callers never consume vendor payloads.
 */
export function resolveImageGenerationProvider(
  providerId: string,
  secrets: { openAiApiKey?: string },
): ImageGenerationProvider | null {
  if (providerId === 'openai:gpt-image-1' && secrets.openAiApiKey) {
    return new OpenAIImageProvider(secrets.openAiApiKey)
  }
  return null
}
