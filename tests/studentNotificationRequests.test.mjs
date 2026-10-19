import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync('src/utils/notifications.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function client(options = {}) {
 const calls = [], store = new Map();
 const supabase = {
  functions: { async invoke(name, { body }) {
   calls.push({ name, body });
   await Promise.resolve();
   return { data: options.malformed ? {} : { data: body.action === 'list' ? { notifications: options.notifications || [] } : { notification_id: body.notification_id } }, error: options.error || null };
  } },
  from() { const q = { select() { return q; }, in() { return q; }, neq() { return q; }, order() { return q; }, then(a,b) { return Promise.resolve({data:[],error:options.electionError}).then(a,b); } }; return q; },
 };
 const context = { supabase, localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)}, Map,Set,Promise,Date,Number,String,JSON,
  getStudentDashboardMemberships: async () => ({ memberships: options.memberships || [] }),
  callVoteAccess: async () => ({ data:{election_ids:[]},error:options.voteError }),
  isMissingResultReleaseColumn:()=>false, getElectionPhase:()=>'',canStudentViewResults:()=>false,
 };
 runInNewContext(source+'\nglobalThis.api={fetchNotificationsForUser,markStoredNotificationRead};',context);
 return {...context.api,calls,store};
}
const student = {id:42,role:'student'};
test('concurrent notification consumers share one request and refresh does not cache failures',async()=>{
 const h=client(); const [a,b]=await Promise.all([h.fetchNotificationsForUser(student),h.fetchNotificationsForUser(student)]);
 assert.equal(a.length,0);assert.equal(b.length,0);assert.equal(h.calls.length,1);
 assert.equal(JSON.stringify(h.calls[0]),JSON.stringify({name:'student-notifications',body:{action:'list',limit:20}}));
 await h.fetchNotificationsForUser(student);assert.equal(h.calls.length,2);
 const failed=client({error:{message:'network failure'}});
 await assert.rejects(()=>failed.fetchNotificationsForUser(student),/unavailable/);
 await assert.rejects(()=>failed.fetchNotificationsForUser(student),/unavailable/);assert.equal(failed.calls.length,2);
});
test('notification failures and malformed data are distinct from a verified empty inbox',async()=>{
 for(const options of [{error:{}},{malformed:true},{notifications:[{id:1}]},{electionError:{},memberships:[{organization_id:1}]},{voteError:{}}])await assert.rejects(()=>client(options).fetchNotificationsForUser(student));
 assert.equal((await client().fetchNotificationsForUser(student)).length,0);
});
test('stored notification read state and safe internal navigation are preserved',async()=>{
 const h=client({notifications:[{id:1,title:'Synthetic notice',message:'Synthetic body',metadata:{href:'https://foreign.invalid'},created_at:'2026-10-17',is_read:true}]});
 const items=await h.fetchNotificationsForUser(student);
 assert.equal(items[0].isRead,true);assert.equal(items[0].href,'/student/notifications');
 assert.equal((await h.markStoredNotificationRead(student,'stored:1')).error,null);
 assert.ok((await client({error:{message:'write guard denied'}}).markStoredNotificationRead(student,1)).error);
 assert.ok((await h.markStoredNotificationRead(student,'invalid')).error);
});
test('polling uses failed-attempt cooldown and acknowledgements are never fabricated on write failure',()=>{
 const bell=readFileSync('src/components/NotificationCenter.jsx','utf8');
 assert.match(bell,/shouldRefreshNotifications\(lastAttemptAt\)/);
 assert.match(bell,/lastAttemptAt = Date\.now\(\)/);
 assert.match(bell,/Date\.now\(\) - lastAttemptAt < 10000/);
 const page=readFileSync('src/pages/shared/NotificationsPage.jsx','utf8');
 assert.ok(page.indexOf('results.some(result => result?.error)') < page.indexOf('markAllNotificationsRead(activeUser, notifications)'));
 assert.match(page,/Notification read state could not be saved/);
});
