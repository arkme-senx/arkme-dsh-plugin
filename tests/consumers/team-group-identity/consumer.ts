import {ArkmeSdk,type TeamRepresentationSelection} from '@senguoyun/dsh-arkme/sdk';
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message)}
export async function verifyInstalledGroupIdentity(fetchImpl:typeof fetch,sourceRef:string){
 const sdk=new ArkmeSdk({fetchImpl});
 const context=await sdk.groupIdentityContext(sourceRef);
 assert(context.state==='ready'&&context.membershipPolicy==='independent','group candidate contract');
 const candidate=context.teams[0];assert(candidate?.representation,'ordinary member candidate');
 const selection:TeamRepresentationSelection=candidate.representation;
 const card=await sdk.teamPublicCard(candidate.jotmoId!);
 assert(card.navigation?.kind==='inbox'&&card.contact.state==='disabled','disabled member still has inbox');
 const unsupported=new ArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))});
 let rejected=false;try{await unsupported.groupIdentityContext(sourceRef)}catch{rejected=true}assert(rejected,'absent capability');
 const sent = await sdk.sendText(sourceRef,'代表身份连通验收',{recordUid:crypto.randomUUID(),relationUid:crypto.randomUUID(),sendAtMillis:Date.now(),representation:selection});
 assert(sent.localState==='synced','represented send receipt');
 assert(sent.representation?.name===candidate.name&&sent.representation.jotmoId===candidate.jotmoId,'accepted attribution in SDK receipt');
 return {context,card,selection,sent};
}

export async function verifyInstalledReadProjection(fetchImpl:typeof fetch,sourceRef:string,actionRef:string,selection:TeamRepresentationSelection,complete:(relationUids:string[])=>Promise<void>){
 const sdk=new ArkmeSdk({fetchImpl});
 const child=await sdk.extendSourceMessage(sourceRef,actionRef,'SDK 团队延展读取闭环',{representation:selection,sendAtMillis:Date.now()});
 assert(child.extension.representation?.jotmoId==='stack_team_7','accepted extension display');
 const personal=await sdk.extendSourceMessage(sourceRef,actionRef,'SDK 个人延展不能继承父身份');
 assert(personal.extension.representation===undefined,'personal extension cannot inherit parent Team');
 await complete([child.relationUid!,personal.relationUid!]);
 const tree=await sdk.sourceMessageExtensionContext(sourceRef,actionRef);
 assert(tree.extensions.find(item=>item.recordUid===child.recordUid)?.representation?.jotmoId==='stack_team_7','tree retains Team display');
 assert(tree.extensions.find(item=>item.recordUid===personal.recordUid)?.representation===undefined,'tree personal identity');
 const link=await sdk.copyMessageLink(sourceRef,[actionRef]);
 return {child,personal,tree,link};
}
