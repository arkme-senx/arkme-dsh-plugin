// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { publishNativeAnnotationInvalidation, subscribeNativeAnnotationInvalidation } from '../src/client/native-annotation-invalidation.js'
it('delivers only same-login hints to native frames and releases the listener', () => {
 const iframe=document.createElement('iframe');document.body.append(iframe)
 const original=window.frameElement
 Object.defineProperty(window,'frameElement',{configurable:true,value:iframe})
 const changed=vi.fn(),stop=subscribeNativeAnnotationInvalidation('test:42',changed)
 publishNativeAnnotationInvalidation('prod:42');publishNativeAnnotationInvalidation('test:43');expect(changed).not.toHaveBeenCalled()
 publishNativeAnnotationInvalidation('test:42');expect(changed).toHaveBeenCalledOnce()
 stop();publishNativeAnnotationInvalidation('test:42');expect(changed).toHaveBeenCalledOnce()
 Object.defineProperty(window,'frameElement',{configurable:true,value:original});iframe.remove()
})
