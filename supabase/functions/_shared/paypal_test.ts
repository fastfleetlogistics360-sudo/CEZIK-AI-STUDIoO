import { completedCapture, paypalPublicConfig } from './paypal.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function withPaypalEnvironment(values: Record<string, string>, run: () => void) {
  const keys = Object.keys(values)
  const original = new Map(keys.map((key) => [key, Deno.env.get(key)]))
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value)
    run()
  } finally {
    for (const key of keys) {
      const value = original.get(key)
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  }
}

Deno.test('completedCapture accepts only a completed order with a completed capture', () => {
  const capture = completedCapture({
    id: 'ORDER-1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED', amount: { value: '10.00', currency_code: 'USD' } }] } }],
  })
  assert(capture?.captureId === 'CAPTURE-1', 'completed capture ID should be returned')
  assert(capture?.amount === '10.00' && capture.currency === 'USD', 'completed capture amount should be returned')
  assert(completedCapture({ id: 'ORDER-2', status: 'APPROVED' }) === null, 'uncompleted orders must not be creditable')
})

Deno.test('PayPal configuration fails closed outside the exact Sandbox base URL', () => {
  withPaypalEnvironment({
    CEZIK_PAYPAL_ENV: 'sandbox', PAYPAL_API_BASE_URL: 'https://api-m.sandbox.paypal.com', PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret',
  }, () => {
    assert(paypalPublicConfig().environment === 'sandbox', 'sandbox configuration should be accepted')
  })
  withPaypalEnvironment({
    CEZIK_PAYPAL_ENV: 'live', PAYPAL_API_BASE_URL: 'https://api-m.paypal.com', PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret',
  }, () => {
    let rejected = false
    try { paypalPublicConfig() } catch { rejected = true }
    assert(rejected, 'live configuration must be rejected during the Sandbox-only phase')
  })
})
