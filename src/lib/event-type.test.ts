import { describe, it, expect } from 'vitest'
import { classifyEventType, requiresFullBookingForm, EVENT_TYPE_LABELS } from './event-type'
import { isStudioBooking, isOffsiteShootTitle } from './event-category'

describe('classifyEventType — выездная съёмка', () => {
  it('classifies a title with "выезд" as OFFSITE_SHOOT, not STUDIO_BOOKING', () => {
    expect(classifyEventType('Выезд, интервью, Иванов')).toBe('OFFSITE_SHOOT')
  })

  it('still classifies a regular studio title as STUDIO_BOOKING', () => {
    expect(classifyEventType('Подкаст, тз, 3к, Соломатин')).toBe('STUDIO_BOOKING')
  })

  it('staff-unavailability detection still wins over the offsite check', () => {
    expect(classifyEventType('Не будет Ромы')).toBe('STAFF_UNAVAILABILITY')
  })
})

describe('isStudioBooking — выездная съёмка больше не студийный час', () => {
  it('returns false for an offsite-titled event (was true before the 2026-07-27 fix)', () => {
    expect(isStudioBooking('Выезд, интервью')).toBe(false)
  })

  it('still returns true for a known studio-booking title', () => {
    expect(isStudioBooking('Подкаст, тз, 3к')).toBe(true)
  })
})

describe('isOffsiteShootTitle', () => {
  it('matches any casing/substring of "выезд"', () => {
    expect(isOffsiteShootTitle('ВЫЕЗДНАЯ СЪЁМКА')).toBe(true)
    expect(isOffsiteShootTitle('Подкаст, тз, 3к')).toBe(false)
  })
})

describe('requiresFullBookingForm', () => {
  it('is true for both commercial shoot types', () => {
    expect(requiresFullBookingForm('STUDIO_BOOKING')).toBe(true)
    expect(requiresFullBookingForm('OFFSITE_SHOOT')).toBe(true)
  })

  it('is false for non-commercial event types', () => {
    expect(requiresFullBookingForm('MEETING')).toBe(false)
    expect(requiresFullBookingForm('STAFF_UNAVAILABILITY')).toBe(false)
    expect(requiresFullBookingForm('SERVICE_NOTE')).toBe(false)
    expect(requiresFullBookingForm('OTHER')).toBe(false)
  })
})

describe('EVENT_TYPE_LABELS — порядок пунктов в <select>', () => {
  it('places OFFSITE_SHOOT right after STUDIO_BOOKING', () => {
    const keys = Object.keys(EVENT_TYPE_LABELS)
    expect(keys.indexOf('OFFSITE_SHOOT')).toBe(keys.indexOf('STUDIO_BOOKING') + 1)
  })
})
