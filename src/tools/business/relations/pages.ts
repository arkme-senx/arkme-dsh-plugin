import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const relationPagesTool = defineArkmeCoreToolModule({
  meta:{id:'business.relations.pages.v1',toolName:'arkme_relation_pages',kind:'business',phase:'core',effect:'read',profiles:['business','hybrid']},
  create:ports=>defineTool({
    name:'arkme_relation_pages',
    description:'Read current-account relations or grouped original records with all mention positions. list searches the complete directory by name, alias and contact remark. Pass opaque cursors unchanged with the same query/filter. searchPending means a bounded search needs explicit continuation; an empty page is not proof of no matches. totalKnown=false means total is unavailable. records requires an unchanged item ref. When available, personReferences includes each pronoun span and inferred display name: resolved is AI inference, unresolved needs identity confirmation, and group/generic do not identify a single person. Never fill missing identities or treat not_analyzed as a completed empty result. Refresh from the first page on expired cursors. Does not start AI recognition or modify identities. Never continuously poll.',
    parameters:{
      action:{type:'string',enum:['list','records'],required:true},
      query:{type:'string'},filter:{type:'string',description:'Entity type 1–9, or empty for all.'},
      ref:{type:'string',description:'Opaque relation item ref for records.'},cursor:{type:'string'},
      limit:{type:'integer',description:'List only, 1–100.'},
      include_counts:{type:'boolean',description:'List only. Include exact matching total and global type counts.'},
    },output:TEXT_OUTPUT,isConcurrencySafe:()=>true,
    execute:async(args,exec)=>{
      exec.signal?.throwIfAborted()
      if(args.action==='list'){
        if(args.ref!==undefined || (args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100)))throw new TypeError('关系列表参数不合法')
        return taggedJSON('关系',await ports.relationPage({...args.query!==undefined?{query:args.query}:{},...args.filter!==undefined?{filter:args.filter}:{},...args.cursor?{cursor:args.cursor}:{},...args.limit!==undefined?{limit:args.limit}:{},...args.include_counts!==undefined?{includeCounts:args.include_counts}:{}},exec.signal))
      }
      if(args.action!=='records'||!args.ref||args.query!==undefined||args.filter!==undefined||args.limit!==undefined||args.include_counts!==undefined)throw new TypeError('原文分页需要关系引用')
      return taggedJSON('关系原文',await ports.relationRecords({ref:args.ref,...args.cursor?{cursor:args.cursor}:{}},exec.signal))
    },
  }),
})
