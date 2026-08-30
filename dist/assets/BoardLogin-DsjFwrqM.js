import{n as e,s as t,t as n}from"./jsx-runtime-2UHhqg_S.js";import{O as r,a as i,c as a,o}from"./index-QTclzhXJ.js";import{t as s}from"./supabaseClient-Cwy9cl8m.js";import{t as c}from"./AuthLayout-qkC7vYN_.js";var l=t(e(),1),u=n();function d(){let[e,t]=(0,l.useState)(``),[n,d]=(0,l.useState)(``),[f,p]=(0,l.useState)(!1),m=r();(0,l.useEffect)(()=>{let e=o();e?.role===`electoral_board`&&m(i(e),{replace:!0})},[m]);async function h(t){t.preventDefault(),p(!0);let{data:r,error:i}=await s.from(`admin_users`).select(`
        id,
        email,
        password,
        full_name,
        role,
        status,
        organization_id,
        created_at,
        organizations (
          id,
          name
        )
      `).eq(`email`,e).single();if(i||!r){alert(`Invalid email`),p(!1);return}if(r.password!==n){alert(`Incorrect password`),p(!1);return}if(r.role!==`electoral_board`){alert(`Unauthorized access`),p(!1);return}if(r.status!==`active`){alert(`Account is disabled`),p(!1);return}localStorage.setItem(`user`,JSON.stringify(r)),m(`/board/dashboard`,{replace:!0}),p(!1)}return(0,u.jsx)(c,{roleLabel:`Electoral Board`,title:`Board Login`,copy:`Sign in to prepare elections, manage students, and monitor voting.`,backTo:`/board-portal`,children:(0,u.jsx)(`form`,{onSubmit:h,className:`student-auth-card kandid-auth-form-card`,children:(0,u.jsxs)(`div`,{className:`mt-8 space-y-5`,children:[(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`label`,{className:`field-label`,children:`Board Email`}),(0,u.jsx)(`input`,{type:`email`,placeholder:`Enter electoral board email`,required:!0,autoComplete:`username`,className:`field-shell w-full`,value:e,onChange:e=>t(e.target.value)})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`label`,{className:`field-label`,children:`Password`}),(0,u.jsx)(`input`,{type:`password`,placeholder:`Enter password`,required:!0,autoComplete:`current-password`,className:`field-shell w-full`,value:n,onChange:e=>d(e.target.value)})]}),(0,u.jsx)(`button`,{type:`submit`,disabled:f,className:`primary-btn w-full`,children:f?(0,u.jsx)(a,{label:`Verifying access...`}):`Enter Board Workspace`})]})})})}export{d as default};