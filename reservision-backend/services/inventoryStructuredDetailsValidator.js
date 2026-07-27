/**
 * Validation + normalization for Phase 3 structured inventory details.
 */

const SOURCES = new Set(['manual', 'ocr', 'migration'])
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/

export function normalizeAmenityName(name) {
  let text = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()

  if (!text) return ''

  if (/^(wifi|wifii|wirelessinternet)/.test(text) || text.includes('wifi')) {
    return 'wifi'
  }

  return text
}

export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

export function parseStructuredDetailsInput(raw) {
  if (raw == null || raw === '') return { present: false, value: undefined }
  if (typeof raw === 'object') return { present: true, value: raw }
  if (typeof raw === 'string') {
    try {
      return { present: true, value: JSON.parse(raw) }
    } catch {
      const err = new Error('structured_details must be valid JSON.')
      err.status = 400
      err.errors = { structured_details: 'structured_details must be valid JSON.' }
      throw err
    }
  }
  const err = new Error('structured_details must be an object.')
  err.status = 400
  err.errors = { structured_details: 'structured_details must be an object.' }
  throw err
}

const sanitizePlain = (value, max) => {
  const text = String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
  return text.slice(0, max)
}

const parseOptionalTime = (value, path, errors) => {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (!TIME_RE.test(text)) {
    errors[path] = 'Time must use HH:MM or HH:MM:SS format.'
    return null
  }
  return text.length === 5 ? `${text}:00` : text
}

const parseNonNegativeInt = (value, path, errors, { allowNull = false, min = 0 } = {}) => {
  if (value == null || value === '') {
    if (allowNull) return null
    errors[path] = 'Value is required.'
    return null
  }
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) {
    errors[path] = `Value must be an integer >= ${min}.`
    return null
  }
  return n
}

const parseNonNegativeMoney = (value, path, errors) => {
  if (value == null || value === '') return 0
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    errors[path] = 'Amount must be a non-negative number.'
    return null
  }
  return Math.round(n * 100) / 100
}

const rangesOverlap = (a, b) => {
  const aMax = a.max_age == null ? Number.POSITIVE_INFINITY : a.max_age
  const bMax = b.max_age == null ? Number.POSITIVE_INFINITY : b.max_age
  return a.min_age <= bMax && b.min_age <= aMax
}

/**
 * @param {object|undefined} structured
 * @param {'room'|'cottage'|'event'|string} categoryType
 * @returns {{ ok: true, value: object } | { ok: false, message: string, errors: object, status: number }}
 */
export function validateStructuredDetails(structured, categoryType) {
  const errors = {}
  const type = String(categoryType || 'room').toLowerCase()
  const isEvent = type === 'event'
  const isAccommodation = type === 'room' || type === 'cottage'

  if (structured == null || typeof structured !== 'object' || Array.isArray(structured)) {
    return {
      ok: false,
      status: 400,
      message: 'structured_details must be an object.',
      errors: { structured_details: 'structured_details must be an object.' },
    }
  }

  const out = {
    amenities: undefined,
    accommodation: undefined,
    event: undefined,
  }

  if (hasOwn(structured, 'amenities')) {
    if (!Array.isArray(structured.amenities)) {
      errors['structured_details.amenities'] = 'Amenities must be an array.'
    } else {
      const seen = new Set()
      const amenities = []
      structured.amenities.forEach((row, index) => {
        const path = `structured_details.amenities.${index}`
        const name = sanitizePlain(row?.name, 150)
        if (!name) {
          errors[`${path}.name`] = 'Amenity name is required.'
          return
        }
        const normalized = normalizeAmenityName(name)
        if (!normalized) {
          errors[`${path}.name`] = 'Amenity name is invalid.'
          return
        }
        if (seen.has(normalized)) {
          errors[`${path}.name`] = 'Duplicate amenity names are not allowed.'
          return
        }
        seen.add(normalized)
        const source = String(row?.source || 'manual')
        if (!SOURCES.has(source)) {
          errors[`${path}.source`] = 'Source must be manual, ocr, or migration.'
        }
        const sortOrder = Number.isFinite(Number(row?.sort_order)) ? Number(row.sort_order) : index
        amenities.push({
          name,
          normalized_name: normalized,
          sort_order: sortOrder,
          source,
        })
      })
      out.amenities = amenities
    }
  }

  if (hasOwn(structured, 'accommodation')) {
    if (structured.accommodation === null) {
      if (isEvent) {
        out.accommodation = null
      } else {
        // Explicit null clears accommodation details for rooms/cottages.
        out.accommodation = null
      }
    } else if (typeof structured.accommodation !== 'object' || Array.isArray(structured.accommodation)) {
      errors['structured_details.accommodation'] = 'Accommodation must be an object or null.'
    } else if (isEvent) {
      errors['structured_details.accommodation'] = 'Accommodation details cannot be assigned to an event item.'
    } else if (!isAccommodation) {
      errors['structured_details.accommodation'] = 'Accommodation details are only valid for rooms and cottages.'
    } else {
      const acc = structured.accommodation
      const checkIn = hasOwn(acc, 'check_in_time')
        ? parseOptionalTime(acc.check_in_time, 'structured_details.accommodation.check_in_time', errors)
        : undefined
      const checkOut = hasOwn(acc, 'check_out_time')
        ? parseOptionalTime(acc.check_out_time, 'structured_details.accommodation.check_out_time', errors)
        : undefined
      const location = hasOwn(acc, 'location')
        ? (acc.location == null || acc.location === '' ? null : sanitizePlain(acc.location, 255))
        : undefined
      const maxExtra = hasOwn(acc, 'max_extra_guests')
        ? parseNonNegativeInt(acc.max_extra_guests, 'structured_details.accommodation.max_extra_guests', errors, { allowNull: true, min: 0 })
        : undefined

      let beds
      if (hasOwn(acc, 'beds')) {
        if (!Array.isArray(acc.beds)) {
          errors['structured_details.accommodation.beds'] = 'Beds must be an array.'
        } else {
          beds = []
          acc.beds.forEach((bed, index) => {
            const path = `structured_details.accommodation.beds.${index}`
            const bedType = sanitizePlain(bed?.bed_type || bed?.label, 100)
            if (!bedType) {
              errors[`${path}.bed_type`] = 'Bed type is required.'
              return
            }
            const quantity = parseNonNegativeInt(bed?.quantity ?? 1, `${path}.quantity`, errors, { min: 1 })
            if (quantity == null) return
            const source = String(bed?.source || 'manual')
            if (!SOURCES.has(source)) errors[`${path}.source`] = 'Source must be manual, ocr, or migration.'
            beds.push({
              bed_type: bedType,
              quantity,
              notes: bed?.notes == null || bed.notes === '' ? null : sanitizePlain(bed.notes, 255),
              sort_order: Number.isFinite(Number(bed?.sort_order)) ? Number(bed.sort_order) : index,
              source,
            })
          })
        }
      }

      let policies
      if (hasOwn(acc, 'extra_guest_policies')) {
        if (!Array.isArray(acc.extra_guest_policies)) {
          errors['structured_details.accommodation.extra_guest_policies'] = 'Extra guest policies must be an array.'
        } else {
          policies = []
          acc.extra_guest_policies.forEach((policy, index) => {
            const path = `structured_details.accommodation.extra_guest_policies.${index}`
            const minAge = parseNonNegativeInt(policy?.min_age, `${path}.min_age`, errors, { min: 0 })
            const maxAge = parseNonNegativeInt(policy?.max_age, `${path}.max_age`, errors, { allowNull: true, min: 0 })
            if (minAge == null) return
            if (maxAge != null && maxAge < minAge) {
              errors[`${path}.max_age`] = 'max_age must be greater than or equal to min_age.'
              return
            }
            const amount = parseNonNegativeMoney(policy?.amount, `${path}.amount`, errors)
            if (amount == null) return
            const source = String(policy?.source || 'manual')
            if (!SOURCES.has(source)) errors[`${path}.source`] = 'Source must be manual, ocr, or migration.'
            policies.push({
              min_age: minAge,
              max_age: maxAge,
              amount,
              label: policy?.label == null || policy.label === '' ? null : sanitizePlain(policy.label, 255),
              sort_order: Number.isFinite(Number(policy?.sort_order)) ? Number(policy.sort_order) : index,
              source,
            })
          })

          for (let i = 0; i < (policies?.length || 0); i += 1) {
            for (let j = i + 1; j < policies.length; j += 1) {
              if (rangesOverlap(policies[i], policies[j])) {
                errors['structured_details.accommodation.extra_guest_policies'] =
                  'Extra guest age ranges must not overlap.'
                break
              }
            }
          }
        }
      }

      out.accommodation = {
        check_in_time: checkIn,
        check_out_time: checkOut,
        location,
        max_extra_guests: maxExtra,
        beds,
        extra_guest_policies: policies,
        _partial: {
          check_in_time: hasOwn(acc, 'check_in_time'),
          check_out_time: hasOwn(acc, 'check_out_time'),
          location: hasOwn(acc, 'location'),
          max_extra_guests: hasOwn(acc, 'max_extra_guests'),
          beds: hasOwn(acc, 'beds'),
          extra_guest_policies: hasOwn(acc, 'extra_guest_policies'),
        },
      }
    }
  }

  if (hasOwn(structured, 'event')) {
    if (structured.event === null) {
      out.event = null
    } else if (typeof structured.event !== 'object' || Array.isArray(structured.event)) {
      errors['structured_details.event'] = 'Event details must be an object or null.'
    } else if (!isEvent) {
      errors['structured_details.event'] = 'Event details cannot be assigned to a room or cottage item.'
    } else {
      // Venue/location already live on inventory_items — accept for sync only.
      out.event = {
        venue: hasOwn(structured.event, 'venue')
          ? (structured.event.venue == null || structured.event.venue === ''
            ? null
            : sanitizePlain(structured.event.venue, 255))
          : undefined,
        location: hasOwn(structured.event, 'location')
          ? (structured.event.location == null || structured.event.location === ''
            ? null
            : sanitizePlain(structured.event.location, 255))
          : undefined,
        _partial: {
          venue: hasOwn(structured.event, 'venue'),
          location: hasOwn(structured.event, 'location'),
        },
      }
    }
  }

  if (Object.keys(errors).length) {
    return {
      ok: false,
      status: 422,
      message: 'Some inventory details are invalid.',
      errors,
    }
  }

  return { ok: true, value: out }
}
