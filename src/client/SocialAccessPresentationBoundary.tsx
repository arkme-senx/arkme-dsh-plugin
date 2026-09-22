import { cloneElement, type HTMLAttributes, type ReactElement } from 'react'
import { useSocialAccessPresentation } from './social-access-store.js'

type SurfaceProps = HTMLAttributes<HTMLElement> & { inert?: string | undefined }

/** Keep the existing root, layout and editors mounted while resolving first display. */
export function SocialAccessPresentationBoundary({ children }: { children: ReactElement<SurfaceProps> }) {
  const { ready } = useSocialAccessPresentation()
  return cloneElement(children, {
    style: ready ? children.props.style : { ...children.props.style, opacity: 0, pointerEvents: 'none' },
    'aria-hidden': ready ? children.props['aria-hidden'] : true,
    'aria-busy': ready ? children.props['aria-busy'] : true,
    inert: ready ? children.props.inert : '',
  })
}
