/**
 * Shared mixed-legacy description detection for Phase 5.
 * Pure helper — no DB access.
 *
 * A short customer overview may mention "room", "pool", or "breakfast".
 * Mixed legacy content is detected via section headings, schedules,
 * contacts, age-fee lines, and large inclusion-style HTML lists.
 */

const MIXED_RULES = [
  {
    id: 'room_inclusions_heading',
    reason: 'Contains a room/cottage/venue inclusions heading',
    test: (text) => /(?:^|\n)\s*(?:room|cottage|venue)?\s*inclusions?\s*(?::|\n|$)/i.test(text)
      || /<h[1-6][^>]*>\s*(?:room|cottage|venue)?\s*inclusions?/i.test(text),
  },
  {
    id: 'complete_amenities_heading',
    reason: 'Contains a complete amenities heading',
    test: (text) => /complete\s+amenities/i.test(text),
  },
  {
    id: 'check_in_schedule',
    reason: 'Contains check-in schedule text',
    test: (text) => /check[\s-]?in(?:\s+time)?\s*[:=]/i.test(text),
  },
  {
    id: 'check_out_schedule',
    reason: 'Contains check-out schedule text',
    test: (text) => /check[\s-]?out(?:\s+time)?\s*[:=]/i.test(text),
  },
  {
    id: 'extra_guest_policy',
    reason: 'Contains extra person/guest policy text',
    test: (text) => /extra\s+(?:person|guest)/i.test(text),
  },
  {
    id: 'contact_block',
    reason: 'Contains a contact / more-information block',
    test: (text) => /for\s+more\s+information|please\s+contact/i.test(text),
  },
  {
    id: 'phone_numbers',
    reason: 'Contains phone numbers that belong outside the overview',
    test: (text) => /(?:\+63|0?9\d{2}[\s-]?\d{3}[\s-]?\d{4}|\(\d{3}\)\s*\d{3,4}[- ]?\d{3,4})/.test(text),
  },
  {
    id: 'age_fee_lines',
    reason: 'Contains age-range fee lines',
    test: (text) => /\b(?:yrs?|years?)\s*old\b/i.test(text)
      && /(?:php|₱|\bfree\b|\d{2,})/i.test(text),
  },
  {
    id: 'inclusion_html_list',
    reason: 'Contains a large amenity-style HTML list',
    test: (html, plain) => {
      const listItems = (String(html || '').match(/<li\b/gi) || []).length
      if (listItems >= 3) return true
      // Plain multi-line amenity dumps after an inclusions-like cue
      const lines = plain.split(/\n+/).map((l) => l.trim()).filter(Boolean)
      return lines.length >= 8 && /inclusions?|amenities/i.test(plain)
    },
  },
]

const stripToPlain = (value = '') => String(value || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(?:p|div|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{2,}/g, '\n')
  .trim()

/**
 * @param {string} description
 * @returns {{ isMixed: boolean, reasons: string[], reasonIds: string[] }}
 */
export function detectLegacyMixedDescription(description = '') {
  const html = String(description || '')
  const plain = stripToPlain(html)
  if (!plain) {
    return { isMixed: false, reasons: [], reasonIds: [] }
  }

  const reasonIds = []
  const reasons = []
  for (const rule of MIXED_RULES) {
    const hit = rule.test.length >= 2
      ? rule.test(html, plain)
      : rule.test(plain)
    if (hit && !reasonIds.includes(rule.id)) {
      reasonIds.push(rule.id)
      reasons.push(rule.reason)
    }
  }

  return {
    isMixed: reasonIds.length > 0,
    reasons,
    reasonIds,
  }
}

export function isCleanOverviewDescription(description = '') {
  return !detectLegacyMixedDescription(description).isMixed
}

export const MIXED_LEGACY_DESCRIPTION_CODE = 'MIXED_LEGACY_DESCRIPTION'
export const MIXED_LEGACY_DESCRIPTION_MESSAGE =
  'The description should contain only a short overview. Add amenities, schedules, beds, and policies in their structured sections.'
