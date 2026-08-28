import{_ as e,o as t,s as n}from"./index-By_vBu7t.js";import{t as r}from"./supabaseClient-CKHYq6kB.js";var i=e(`loader-circle`,[[`path`,{d:`M21 12a9 9 0 1 1-6.219-8.56`,key:`13zald`}]]);function a(e){return e===`student`?`
      *,
      student_organizations (
        organization_id,
        organizations (
          id,
          name,
          logo_url
        )
      )
    `:`
    *,
    organizations (
      id,
      name,
      logo_url
    )
  `}function o(e){return e===`super_admin`?`/super-admin/profile`:e===`electoral_board`?`/board/profile`:`/student/profile`}async function s(){let e=t();if(!e?.role||!e?.id)return{data:null,error:Error(`No active user session.`)};let i=e.role===`student`?`students`:`admin_users`,{data:o,error:s}=await r.from(i).select(a(e.role)).eq(`id`,e.id).single();if(!s&&o){let t={...e,...o,role:e.role};return n(t),{data:t,error:null}}return{data:null,error:s}}async function c(e){let n=t();if(!n?.role||!n?.id)return{data:null,error:Error(`No active user session.`)};let i=n.role===`student`?`students`:`admin_users`,{error:a}=await r.from(i).update(e).eq(`id`,n.id);return a?{data:null,error:a}:s()}export{i,o as n,c as r,s as t};