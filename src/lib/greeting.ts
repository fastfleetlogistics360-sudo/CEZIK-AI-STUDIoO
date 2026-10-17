export type Greeting = 'Good morning' | 'Good afternoon' | 'Good evening' | 'Good night'

/**
 * Returns a greeting for a real instant in either the device's local timezone
 * (the default) or an explicit IANA timezone. Keeping this independent of UI
 * prevents UTC/server time from leaking into the dashboard.
 */
export function greetingForDate(date = new Date(), timeZone?: string): Greeting {
  const hour = timeZone
    ? Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).formatToParts(date)
      .find((part) => part.type === 'hour')?.value)
    : date.getHours()

  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 21) return 'Good evening'
  return 'Good night'
}

/** Schedule the next check at the next local-hour boundary, with a small buffer. */
export function millisecondsUntilNextLocalHour(date = new Date()) {
  return ((60 - date.getMinutes()) * 60 - date.getSeconds()) * 1000 - date.getMilliseconds() + 50
}
