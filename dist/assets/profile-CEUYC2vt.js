import{o as e,s as t}from"./index-BC1XMvn7.js";import{t as n}from"./supabaseClient-P-032-pS.js";import{f as r}from"./organizationAccess-Bez5-qfm.js";function i(e){return e===`student`?`
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
  `}function a(e){return e===`super_admin`?`/super-admin/profile`:e===`electoral_board`?`/board/profile`:`/student/profile`}async function o(){let a=e();if(!a?.role||!a?.id)return{data:null,error:Error(`No active user session.`)};let o=a.role===`student`?`students`:`admin_users`,{data:s,error:c}=await n.from(o).select(i(a.role)).eq(`id`,a.id).single();if(!c&&s){let e=a.role===`student`?await r(s.id):s.student_organizations,n={...a,...s,role:a.role,...a.role===`student`?{student_organizations:e}:{}};return t(n),{data:n,error:null}}return{data:null,error:c}}async function s(t){let r=e();if(!r?.role||!r?.id)return{data:null,error:Error(`No active user session.`)};let i=r.role===`student`?`students`:`admin_users`,{error:a}=await n.from(i).update(t).eq(`id`,r.id);return a?{data:null,error:a}:o()}export{a as n,s as r,o as t};