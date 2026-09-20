import { tr } from './locale.js'
import { IconSearchOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputHTMLAttributes } from 'react'

/** Keep every forwarding entry on DSH's native input surface and focus styles. */
export function ArkmeForwardSearch(props: Pick<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'disabled'>) {
  return <Input
    className="arkme-forward-search"
    icon={<IconSearchOutline16 />}
    aria-label={tr("搜索转发对象")}
    placeholder={tr("搜索转发对象")}
    {...props}
  />
}
