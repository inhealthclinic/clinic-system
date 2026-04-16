import type { KeyboardEvent } from 'react'

// ============================================================
// src/lib/utils/phone.ts
// ────────────────────────────────────────────────────────────
// Kazakhstan phone-number normalisation & helpers.
//
// Storage rule:
//   Always persist phones in the canonical form  +77XXXXXXXXX
//   (12 chars, exactly 11 digits after the leading '+', country
//    code 7 + carrier code 7XX).
//
// UI rule:
//   The +77 prefix is "locked" — the user can edit only the
//   trailing 9 digits. enforcePhonePrefix() / formatPhoneInput()
//   take any string the user types/pastes and return the value
//   the controlled <input> should display.
// ============================================================

export const PHONE_PREFIX = '+77'
export const PHONE_TOTAL_DIGITS = 11 // 7 + 7 + 9 trailing
const TRAILING_DIGITS = 9

/**
 * Take any user input and return a value safe for the controlled
 * <input>:
 *   - always starts with +77
 *   - drops everything that is not a digit
 *   - keeps at most 9 trailing digits
 *   - tolerates 8XXXXXXXXXX, 7XXXXXXXXXX, +7XXXXXXXXXX paste
 */
export function formatPhoneInput(raw: string | null | undefined): string {
  if (!raw) return PHONE_PREFIX
  let digits = raw.replace(/\D/g, '')

  // Strip common leading variants so we always end up with the 9-digit tail.
  if (digits.startsWith('77')) digits = digits.slice(2)
  else if (digits.startsWith('87')) digits = digits.slice(2)
  else if (digits.startsWith('7') && digits.length >= 10) digits = digits.slice(1)
  else if (digits.startsWith('8') && digits.length >= 10) digits = digits.slice(1)

  digits = digits.slice(0, TRAILING_DIGITS)
  return PHONE_PREFIX + digits
}

/**
 * Returns the canonical +77XXXXXXXXX form, or `null` if the input
 * doesn't contain enough digits to make a valid Kazakh mobile number.
 */
export function normalizePhoneKZ(raw: string | null | undefined): string | null {
  if (!raw) return null
  const formatted = formatPhoneInput(raw)
  // formatted is always at least '+77' = 3 chars
  if (formatted.length !== PHONE_PREFIX.length + TRAILING_DIGITS) return null
  return formatted
}

export function isValidPhoneKZ(raw: string | null | undefined): boolean {
  return normalizePhoneKZ(raw) !== null
}

/**
 * Pretty form for read-only display:  +7 708 919 29 29
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return ''
  const norm = normalizePhoneKZ(raw)
  if (!norm) return raw // show whatever we have if it's not valid yet
  // norm = +77XXXXXXXXX
  const digits = norm.slice(1) // 77XXXXXXXXX (11 chars)
  // 7 7XX XXX XX XX
  return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`
}

/**
 * For a controlled-input onChange handler: prevent the user from
 * deleting the +77 prefix by always re-applying formatPhoneInput.
 *
 * Usage:
 *   const [phone, setPhone] = useState(PHONE_PREFIX)
 *   <input value={phone} onChange={e => setPhone(formatPhoneInput(e.target.value))} />
 */
export function enforcePhonePrefix(value: string): string {
  return formatPhoneInput(value)
}

/**
 * Caret guard: when a user presses Backspace and the cursor is at
 * position <= 3 (inside the locked +77 prefix), swallow the event so
 * the prefix stays intact.
 *
 * Usage in JSX:
 *   <input onKeyDown={onPhoneKeyDown} ... />
 */
export function onPhoneKeyDown(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return
  const target = e.currentTarget
  const start = target.selectionStart ?? 0
  const end = target.selectionEnd ?? 0
  // No selection AND caret is inside or at the end of the prefix → block.
  if (start === end && start <= PHONE_PREFIX.length) {
    e.preventDefault()
  }
}
