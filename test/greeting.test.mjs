import assert from 'node:assert/strict'
import test from 'node:test'
import { greetingForDate, millisecondsUntilNextLocalHour } from '../.test-build/src/lib/greeting.js'

const inLagos = (hour, minute = 0) => new Date(Date.UTC(2026, 0, 15, hour - 1, minute))

test('uses every greeting boundary in an explicit timezone', () => {
  assert.equal(greetingForDate(inLagos(4, 59), 'Africa/Lagos'), 'Good night')
  assert.equal(greetingForDate(inLagos(5), 'Africa/Lagos'), 'Good morning')
  assert.equal(greetingForDate(inLagos(11, 59), 'Africa/Lagos'), 'Good morning')
  assert.equal(greetingForDate(inLagos(12), 'Africa/Lagos'), 'Good afternoon')
  assert.equal(greetingForDate(inLagos(16, 59), 'Africa/Lagos'), 'Good afternoon')
  assert.equal(greetingForDate(inLagos(17), 'Africa/Lagos'), 'Good evening')
  assert.equal(greetingForDate(inLagos(20, 59), 'Africa/Lagos'), 'Good evening')
  assert.equal(greetingForDate(inLagos(21), 'Africa/Lagos'), 'Good night')
  assert.equal(greetingForDate(inLagos(23, 59), 'Africa/Lagos'), 'Good night')
  assert.equal(greetingForDate(new Date(Date.UTC(2026, 0, 14, 23, 0)), 'Africa/Lagos'), 'Good night')
})

test('keeps the same greeting for devices configured to the same timezone', () => {
  const instant = new Date('2026-01-15T01:43:00.000Z')
  assert.equal(greetingForDate(instant, 'Africa/Lagos'), 'Good night')
  assert.equal(greetingForDate(instant, 'Africa/Lagos'), greetingForDate(instant, 'Africa/Lagos'))
})

test('schedules a refresh just after the next local-hour boundary', () => {
  assert.equal(millisecondsUntilNextLocalHour(new Date(2026, 0, 15, 4, 59, 59, 900)), 150)
})
