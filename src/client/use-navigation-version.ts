import { useEffect, useState } from 'react'
import { currentClientVersionCode } from './product-version.js'

interface ProductVersionBridge {
  showClientVersionCode(pluginVersion: string): Promise<boolean>
}

/** The desktop owns durable update history; older clients retain the plain version. */
export function useNavigationVersion(pluginVersion: string): string {
  const [qualifiedPlugin, setQualifiedPlugin] = useState<string>()
  const clientVersionCode = currentClientVersionCode()
  useEffect(() => {
    let active = true
    const bridge = typeof window === 'undefined' ? undefined
      : (window as Window & { arkmeDesktop?: { productVersion?: ProductVersionBridge } }).arkmeDesktop?.productVersion
    setQualifiedPlugin(undefined)
    if (bridge) {
      void Promise.resolve().then(() => bridge.showClientVersionCode(pluginVersion)).then(show => {
        if (active) setQualifiedPlugin(show === true ? pluginVersion : undefined)
      }).catch(() => { /* Unavailable history must not prevent navigation from rendering. */ })
    }
    return () => { active = false }
  }, [pluginVersion, clientVersionCode])
  const validCode = Number.isSafeInteger(clientVersionCode) && (clientVersionCode as number) > 0
    && (clientVersionCode as number) <= 2_147_483_647
  return qualifiedPlugin === pluginVersion && validCode
    ? `v${pluginVersion}+${clientVersionCode}` : `v${pluginVersion}`
}
