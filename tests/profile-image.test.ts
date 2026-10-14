import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import sharp from 'sharp'
import {expect,it} from 'vitest'
import {squareProfileImage,readProfileImage,authorizedStorageURL,PROFILE_IMAGE_SOURCE_LIMIT} from '../src/services/profile-image.js'
it.each([[60,40],[2000,1600],[1024,1024]])('normalizes %sx%s source to an immutable square JPEG',async(width,height)=>{
 const source=await sharp({create:{width,height,channels:3,background:'#369'}}).png().toBuffer()
 const a=await squareProfileImage(source.toString('base64')),b=await squareProfileImage(source.toString('base64'))
 const metadata=await sharp(a).metadata()
 expect(metadata.format).toBe('jpeg');expect(metadata.width).toBe(metadata.height);expect(metadata.width).toBeLessThanOrEqual(1024);expect(a.equals(b)).toBe(true)
})
it.each(['','garbage','YWJj','data:image/png;base64,YWJj'])('rejects invalid image bytes %s',async value=>{await expect(squareProfileImage(value)).rejects.toMatchObject({code:'team-avatar-invalid'})})
it('bounds staged bytes and respects cancellation, including paths with spaces',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'team profile '));const file=join(dir,'image source.jpg')
 try{await writeFile(file,Buffer.alloc(PROFILE_IMAGE_SOURCE_LIMIT+1));await expect(readProfileImage(file)).rejects.toMatchObject({code:'team-avatar-too-large'});await expect(readProfileImage(file,AbortSignal.abort())).rejects.toBeDefined()}finally{await rm(dir,{recursive:true,force:true})}
})
it('accepts owner-provided OSS and S3 origins and rejects unsafe targets',()=>{
 expect(authorizedStorageURL('https://bucket.s3.example.com/key?signature=secret').hostname).toBe('bucket.s3.example.com')
 for(const url of ['http://bucket.example/key','https://user:secret@bucket.example','https://127.0.0.1/key','https://[::1]/key','https://localhost/key'])expect(()=>authorizedStorageURL(url)).toThrow()
})
