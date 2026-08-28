import{c as e,g as t,s as n}from"./index-C3VR5hZT.js";import{t as r}from"./supabaseClient-DYsTm63z.js";var i=t(`loader-circle`,[[`path`,{d:`M21 12a9 9 0 1 1-6.219-8.56`,key:`13zald`}]]);function a(e){return e===`student`?`
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
  `}function o(e){return e===`super_admin`?`/super-admin/profile`:e===`electoral_board`?`/board/profile`:`/student/profile`}async function s(){let t=n();if(!t?.role||!t?.id)return{data:null,error:Error(`No active user session.`)};let i=t.role===`student`?`students`:`admin_users`,{data:o,error:s}=await r.from(i).select(a(t.role)).eq(`id`,t.id).single();if(!s&&o){let n={...t,...o,role:t.role};return e(n),{data:n,error:null}}return{data:null,error:s}}async function c(e){let t=n();if(!t?.role||!t?.id)return{data:null,error:Error(`No active user session.`)};let i=t.role===`student`?`students`:`admin_users`,{error:a}=await r.from(i).update(e).eq(`id`,t.id);return a?{data:null,error:a}:s()}export{i,o as n,c as r,s as t};