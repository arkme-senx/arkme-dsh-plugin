import { expect, it } from 'vitest'
import { parseDayReviewModels } from '../src/calendar-day-review.js'
import { dayReviewModelChoices, dshModelChoices, mergeModelChoices, modelSceneBilling } from '../src/model-directory.js'
const q={accountScope:'prod:7',bucketDate:'2026-11-04',timezone:'Asia/Shanghai'}
const alias='user-api/019a4c10-0000-7000-8000-000000000001'
const route=`${alias}/019a4c10-0000-7000-8000-000000000002`
const official={code:'shared-text',display_name:'共享官方模型',route:'managed-ai/shared-text',catalog_route:'shared-text',origin:'official'}
const user={code:alias,display_name:'我的 API',route,catalog_route:alias,origin:'user-provided'}
const response={schema_version:1,scope:'calendar_day',date:q.bucketDate,time_zone:q.timezone,unified_models_v1:true,default_code:'deepseek-v4-flash',default_route:route,models:[official,user]}
it('merges only exact published catalog identities and retains the version activation reference',()=>{
 const local=dayReviewModelChoices(parseDayReviewModels(response,q))
 const shared=dshModelChoices({items:[{provider:'arkme-managed',model:'shared-text',displayName:'共享官方模型',providerName:'Arkme'}]} as never)
 const all=mergeModelChoices(shared,local)
 expect(all).toHaveLength(2)
 expect(all[0]).toMatchObject({id:shared[0]!.id,dayReview:'managed-ai/shared-text'})
 expect(all[1]!.dayReview).toBe(route)
 expect(modelSceneBilling(all[0]!,'dayReview')).toBe('arkme-points')
 expect(modelSceneBilling(all[1]!,'dayReview')).toBe('provider-account')
 const unrelated={...shared[0]!,id:'different',dsh:{provider:'arkme-managed',model:'other'}}
 expect(mergeModelChoices([unrelated],local)).toHaveLength(3)
})
it.each([
 {...response,date:'2026-11-03'},
 {...response,models:[official,{...user,route:alias}]},
 {...response,models:[{...official,catalog_route:'wrong'}]},
 {...response,models:[{...user,route:'user-api/'+ '-'.repeat(36)+'/'+ '-'.repeat(36)}]},
 {...response,models:[official,official]},
])('rejects mismatched identities/scope before showing an activatable choice',value=>{
 expect(()=>parseDayReviewModels(value,q)).toThrow()
})
