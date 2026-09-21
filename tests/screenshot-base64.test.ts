import {expect,it} from 'vitest';
import {decodeScreenshotBase64} from '../src/client/native-screenshot.js';
it('preserves every byte in screenshot PNG payloads',()=>{
 const bytes=Uint8Array.from({length:256},(_,i)=>i);
 const encoded=Buffer.from(bytes).toString('base64');
 expect(decodeScreenshotBase64(encoded)).toEqual(bytes);
});
it('decodes identically on older clients without the native base64 decoder',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(Uint8Array,'fromBase64');
 Object.defineProperty(Uint8Array,'fromBase64',{value:undefined,configurable:true});
 try {expect([...decodeScreenshotBase64('AP+Aqg==')]).toEqual([0,255,128,170]);}
 finally {if(descriptor)Object.defineProperty(Uint8Array,'fromBase64',descriptor);else Reflect.deleteProperty(Uint8Array,'fromBase64');}
});
it('rejects invalid image base64 instead of silently changing pixels',()=>{
 expect(()=>decodeScreenshotBase64('invalid!')).toThrow();
});
