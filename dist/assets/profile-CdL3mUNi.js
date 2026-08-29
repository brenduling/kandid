import{o as e,s as t}from"./index-ByHIFeCD.js";import{t as n}from"./supabaseClient-BJR8ErGU.js";function r(e){return e===`student`?`
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
  `}function i(e){return e===`super_admin`?`/super-admin/profile`:e===`electoral_board`?`/board/profile`:`/student/profile`}async function a(){let i=e();if(!i?.role||!i?.id)return{data:null,error:Error(`No active user session.`)};let a=i.role===`student`?`students`:`admin_users`,{data:o,error:s}=await n.from(a).select(r(i.role)).eq(`id`,i.id).single();if(!s&&o){let e={...i,...o,role:i.role};return t(e),{data:e,error:null}}return{data:null,error:s}}async function o(t){let r=e();if(!r?.role||!r?.id)return{data:null,error:Error(`No active user session.`)};let i=r.role===`student`?`students`:`admin_users`,{error:o}=await n.from(i).update(t).eq(`id`,r.id);return o?{data:null,error:o}:a()}export{i as n,o as r,a as t};