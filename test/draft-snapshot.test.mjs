import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendDraftFiles, subtractSubmittedDraft, draftFingerprint } from '../shared/draft-snapshot.mjs';
const original = {text:'先发这句',textToken:'edit1',cursor:4,files:[{id:'image1',kind:'image',blobId:'image1'}],quotes:[{id:'quote1',text:'引文'}],highDetail:false,submission:{id:'send1',fingerprint:'x'}};
test('a late send receipt consumes only the submitted file/quote ids and unchanged text token',()=>{
  const later={...original,text:'后来写的',textToken:'edit2',files:[...original.files,{id:'file2',kind:'pdf'}],quotes:[...original.quotes,{id:'quote2',text:'新引文'}]};
  const next=subtractSubmittedDraft(later,original);
  assert.equal(next.text,'后来写的');assert.deepEqual(next.files.map(f=>f.id),['file2']);assert.deepEqual(next.quotes.map(q=>q.id),['quote2']);
});
test('retyping the identical text is a new draft, not an acknowledged old input',()=>{
  assert.equal(subtractSubmittedDraft({...original,textToken:'edit-new'},original).text,original.text);
  assert.equal(subtractSubmittedDraft(original,original).text,'');
});
test('late attachments merge with the owning saved draft without losing later edits',()=>{
  const later={...original,text:'后来写的',textToken:'edit3'};
  const merged=appendDraftFiles(later,[{id:'file2',kind:'pdf'},original.files[0]]);
  assert.equal(merged.text,'后来写的');assert.deepEqual(merged.files.map(f=>f.id),['image1','file2']);
});
test('changed quote content and image quality are not cleared by a stale receipt',()=>{
  const later={...original,highDetail:true,quotes:[{id:'quote1',text:'改过引文'}]};
  assert.equal(subtractSubmittedDraft(later,original).files.length,1);
  assert.equal(subtractSubmittedDraft(later,original).quotes[0].text,'改过引文');
  assert.notEqual(draftFingerprint(later),draftFingerprint(original));
});
test('browser references participate in draft identity and only the submitted reference is consumed',()=>{
  const ref={version:1,kind:'owned-preview',sessionId:'s1',leaseId:'l1',pageId:'p1'};
  const sent={...original,browserReference:ref};
  assert.notEqual(draftFingerprint(sent),draftFingerprint(original));
  assert.equal(subtractSubmittedDraft(sent,sent).browserReference,undefined);
  const newer={...ref,leaseId:'l2',pageId:'p2'};
  assert.deepEqual(subtractSubmittedDraft({...sent,browserReference:newer},sent).browserReference,newer);
});
