import{o as e,s as t,v as n}from"./index-DKJ6PJOF.js";import{t as r}from"./supabaseClient-dWtquuww.js";var i=n(`loader-circle`,[[`path`,{d:`M21 12a9 9 0 1 1-6.219-8.56`,key:`13zald`}]]);function a(e){return e===`student`?`
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
  `}function o(e){return e===`super_admin`?`/super-admin/profile`:e===`electoral_board`?`/board/profile`:`/student/profile`}async function s(){let n=e();if(!n?.role||!n?.id)return{data:null,error:Error(`No active user session.`)};let i=n.role===`student`?`students`:`admin_users`,{data:o,error:s}=await r.from(i).select(a(n.role)).eq(`id`,n.id).single();if(!s&&o){let e={...n,...o,role:n.role};return t(e),{data:e,error:null}}return{data:null,error:s}}async function c(t){let n=e();if(!n?.role||!n?.id)return{data:null,error:Error(`No active user session.`)};let i=n.role===`student`?`students`:`admin_users`,{error:a}=await r.from(i).update(t).eq(`id`,n.id);return a?{data:null,error:a}:s()}export{i,o as n,c as r,s as t};