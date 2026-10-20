import { afterEach, expect, it } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeComposerDraftStore as drafts } from '../src/client/composer-draft-store.js'
import '../src/client/composer-draft-auth-binding.js'
afterEach(()=>arkmeAuthStore.setAuth({status:'logged-out',environment:'test'}))
it('evicts in-memory content when the environment changes even if the numeric user id is equal',()=>{
 arkmeAuthStore.setAuth({status:'authenticated',environment:'prod',userId:42})
 const key='arkme-composer:42:arko';drafts.setText(key,'production only')
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
 expect(drafts.get(key).text).toBe('')
})
