import { describe, it, expect, beforeEach } from 'vitest'
import { t, setLocale, detectLocale, localeNames } from '../src/view/i18n.js'

describe('i18n', async () => {
  beforeEach(() => {
    setLocale('en')
  })

  describe('t', () => {
    it('returns the English value under the default locale', () => {
      expect(t('prompt.task')).toBe('task> ')
    })

    it('returns the Chinese value after setLocale(zh)', () => {
      setLocale('zh')
      expect(t('prompt.task')).toBe('任务> ')
    })

    it('flips back to English after setLocale(en)', () => {
      setLocale('zh')
      setLocale('en')
      expect(t('prompt.task')).toBe('task> ')
    })

    it('falls back to the key string for an unknown key', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key')
    })

    it('interpolates {name} placeholders from params', () => {
      setLocale('zh')
      expect(t('lang.switched', { locale: 'zh' })).toBe('语言: zh')
    })
  })

  describe('localeNames', () => {
    it('lists the available locales', () => {
      expect(localeNames()).toEqual(['en', 'zh'])
    })
  })

  describe('detectLocale', () => {
    it('maps zh_CN.UTF-8 to zh', () => {
      expect(detectLocale({ LANG: 'zh_CN.UTF-8' })).toBe('zh')
    })

    it('maps en_US.UTF-8 to en', () => {
      expect(detectLocale({ LANG: 'en_US.UTF-8' })).toBe('en')
    })

    it('defaults to en when no locale env is set', () => {
      expect(detectLocale({})).toBe('en')
    })

    it('checks LC_ALL when LANG is absent', () => {
      expect(detectLocale({ LC_ALL: 'zh_CN.UTF-8' })).toBe('zh')
    })

    it('checks LC_MESSAGES when LANG and LC_ALL are absent', () => {
      expect(detectLocale({ LC_MESSAGES: 'zh_CN.UTF-8' })).toBe('zh')
    })
  })

  describe('localized mode names', () => {
    it('returns the English mode name under en', async () => {
      setLocale('en')
      const { workMode } = await import('../src/view/modes.js') as typeof import('../src/view/modes.js')
      expect(workMode('standard')?.name()).toBe('Standard')
    })

    it('returns the Chinese mode name under zh', async () => {
      setLocale('zh')
      const { workMode } = await import('../src/view/modes.js') as typeof import('../src/view/modes.js')
      expect(workMode('standard')?.name()).toBe('标准模式')
    })
  })
})
