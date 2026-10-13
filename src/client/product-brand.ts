import { getArkmeLocale, useArkmeLocale, type ArkmeLocale } from './locale.js'
import { ARKME_ICON_DATA_URL } from './arkme-assets.js'
import { ARKME_WORDMARK_DATA_URL } from './arkme-wordmark.js'
import jiwoIcon from '../../assets/branding/jiwo-app-icon.png'
import jiwoWordmark from '../../assets/branding/arkme-navigation-logo.png'
import jiwoWordmarkDark from '../../assets/branding/arkme-navigation-logo-dark.png'
import arkmeAbout from '../../assets/branding/arkme-macos-app-icon.png'

const brands = {
  zh: {
    name: '即我', icon: `data:image/png;base64,${jiwoIcon}`,
    wordmark: `data:image/png;base64,${jiwoWordmark}`,
    wordmarkDark: `data:image/png;base64,${jiwoWordmarkDark}`,
    about: `data:image/png;base64,${jiwoWordmark}`,
  },
  en: {
    name: 'Arkme', icon: ARKME_ICON_DATA_URL,
    wordmark: ARKME_WORDMARK_DATA_URL, wordmarkDark: ARKME_WORDMARK_DATA_URL,
    about: `data:image/png;base64,${arkmeAbout}`,
  },
} as const

export const getArkmeBrand = (locale: ArkmeLocale = getArkmeLocale()) => brands[locale]
export const useArkmeBrand = () => getArkmeBrand(useArkmeLocale())
