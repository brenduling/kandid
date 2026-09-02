import{n as e,s as t,t as n}from"./jsx-runtime-2UHhqg_S.js";import{t as r}from"./calendar-days-7_tmBhV2.js";import{t as i}from"./chart-column-DdI1pZJF.js";import{t as a}from"./circle-check-big-oVe6ZB49.js";import{t as o}from"./map-pin-VA5Jity7.js";import{t as s}from"./vote-CR2SaZek.js";import{A as c,O as l,S as u,g as d,l as f}from"./index-DR7ZTyiF.js";import{t as p}from"./supabaseClient-OF4_NjqC.js";import{d as m}from"./organizationAccess-D9Vhb5Sy.js";import{c as h,h as g,l as _,n as v,o as y,s as b,t as x}from"./elections-C59LPJom.js";import{t as S}from"./ElectionManagementCard-CR-aIUhK.js";var C=u(`clock-3`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`M12 6v6h4`,key:`135r8i`}]]),w=t(e(),1),T=n();function E(e){return e===`campaign_upcoming`?`Campaign Upcoming`:e===`campaign`?`Campaign Period`:e===`waiting`?`Waiting for Election`:e===`voting`?`Voting Open`:e===`closed`?`Closed`:e===`draft`?`Draft`:`Upcoming`}var D=`
  id,
  title,
  cover_url,
  organization_id,
  campaign_start,
  campaign_end,
  start_date,
  end_date,
  status,
  voting_access_mode,
  location_label,
  student_result_visibility,
  results_released_at,
  organizations(name, logo_url)
`,O=`
  id,
  title,
  cover_url,
  organization_id,
  campaign_start,
  campaign_end,
  start_date,
  end_date,
  status,
  voting_access_mode,
  location_label,
  student_result_visibility,
  organizations(name, logo_url)
`;function k(e,t=!0){let n=e?D:O;return t?n:n.replace(/\n\s*cover_url,\n/,`
`)}async function A(e,t=!0,n=!0){let{data:r,error:i}=await p.from(`votes`).select(`
      election_id,
      elections (
        ${k(t,n)}
      )
    `).eq(`student_id`,e);return{data:(r||[]).map(e=>({...e,elections:e.elections?{...e.elections,results_released_at:e.elections.results_released_at||null}:null})),error:i}}function j(){let[e,t]=(0,w.useState)([]),[n,u]=(0,w.useState)([]),[D,O]=(0,w.useState)(!0),[j,M]=(0,w.useState)(``),[N,P]=(0,w.useState)(0),F=JSON.parse(localStorage.getItem(`user`)),I=l(),[L]=c(),R=(L.get(`q`)||``).trim().toLowerCase();(0,w.useEffect)(()=>{let e=!0;async function n(){O(!0),M(``);let n=await m(F),r=!0,i=!0,a=await A(F.id,r,i);if(g(a.error)&&(r=!1,a=await A(F.id,r,i)),_(a.error)&&(i=!1,a=await A(F.id,r,i)),a.error){console.error(`Failed to load student voting status:`,a.error),e&&(M(a.error.message||`Unable to load your voting status.`),t([]),u([]),O(!1));return}let o=a.data||[],s=[...new Set((o||[]).map(e=>e.election_id).filter(Boolean))];if(n.length===0&&s.length===0){e&&(t([]),u([]),O(!1));return}let c=(e=r,t=i)=>{let a=[];return n.length>0&&a.push(p.from(`elections`).select(k(e,t)).in(`organization_id`,n).neq(`status`,`draft`).neq(`status`,`archived`).order(`start_date`,{ascending:!1})),s.length>0&&a.push(p.from(`elections`).select(k(e,t)).in(`id`,s).neq(`status`,`draft`).neq(`status`,`archived`).order(`start_date`,{ascending:!1})),a},l=await Promise.all(c());if(l.some(e=>g(e.error))&&(r=!1,l=await Promise.all(c(r,i))),l.some(e=>_(e.error))&&(i=!1,l=await Promise.all(c(r,i))),!e)return;let d=new Map,f=[];if(l.forEach(({data:e,error:t})=>{t&&(console.error(`Failed to load student election overview:`,t),f.push(t)),(e||[]).forEach(e=>{d.set(e.id,{...e,results_released_at:e.results_released_at||null})})}),f.length>0){M(f[0].message||`Unable to load elections for your account.`),t([]),u(o||[]),O(!1);return}(o||[]).forEach(e=>{let t=e.elections;t&&t.status!==`draft`&&t.status!==`archived`&&d.set(t.id,t)}),t([...d.values()].sort((e,t)=>v(t.start_date,e.start_date))),u(o||[]),O(!1)}return n(),()=>{e=!1}},[F.id,N]);function z(e){return n.some(t=>t.election_id===e)}function B(e){let t=h(e);return t===`campaign`?(0,T.jsx)(`button`,{onClick:()=>I(`/student/elections/${e.id}/campaign`),className:`student-election-action`,children:`Overview`}):t===`voting`&&!z(e.id)?(0,T.jsx)(`button`,{onClick:()=>I(`/student/vote/${e.id}`),className:`student-election-action`,children:`Vote Now`}):t===`voting`?(0,T.jsxs)(`div`,{className:`student-election-note student-election-note-green`,children:[(0,T.jsx)(a,{size:16}),`Already voted.`]}):x(e)?(0,T.jsxs)(`div`,{className:`flex flex-wrap gap-3`,children:[(0,T.jsx)(`button`,{type:`button`,onClick:()=>I(`/student/elections/${e.id}/campaign`),className:`student-election-action`,children:`Overview`}),(0,T.jsx)(`button`,{type:`button`,onClick:()=>I(`/student/results?election=${e.id}`),className:`student-election-action`,children:`View Results`})]}):(0,T.jsxs)(`div`,{className:`student-election-note`,children:[(0,T.jsx)(d,{size:16}),t===`campaign_upcoming`?`Campaign begins ${y(e.campaign_start)}.`:t===`waiting`?`Voting opens ${y(e.start_date)}.`:`Voting is not currently available.`]})}let V=(0,w.useMemo)(()=>R?e.filter(e=>[e.title,e.organizations?.name,e.status,E(h(e))].filter(Boolean).join(` `).toLowerCase().includes(R)):e,[e,R]);return(0,T.jsxs)(`div`,{children:[(0,T.jsxs)(`div`,{className:`student-module-banner`,children:[(0,T.jsx)(`div`,{className:`student-module-icon`,children:(0,T.jsx)(i,{size:22})}),(0,T.jsxs)(`div`,{children:[(0,T.jsx)(`h1`,{children:`Election Overview`}),(0,T.jsx)(`p`,{children:`View and manage ongoing and upcoming elections.`})]})]}),D?(0,T.jsx)(`div`,{className:`student-empty-card`,children:(0,T.jsx)(f,{message:`Loading elections...`})}):j?(0,T.jsx)(`div`,{className:`student-empty-card`,children:(0,T.jsxs)(`div`,{className:`space-y-3`,children:[(0,T.jsx)(`p`,{className:`font-bold text-rose-600`,children:`Unable to load elections.`}),(0,T.jsx)(`p`,{className:`text-sm text-gray-500`,children:j}),(0,T.jsx)(`button`,{type:`button`,onClick:()=>P(e=>e+1),className:`student-outline-btn`,children:`Retry`})]})}):V.length===0?(0,T.jsx)(`div`,{className:`student-empty-card`,children:R?`No elections match your search.`:`No elections available for your account.`}):(0,T.jsx)(`div`,{className:`student-election-grid`,children:V.map(e=>(0,T.jsxs)(`article`,{className:`student-election-card`,children:[(0,T.jsx)(S,{election:e,eyebrow:`Student Election`,statusLabel:E(h(e))}),(0,T.jsxs)(`div`,{className:`student-election-meta`,children:[(0,T.jsxs)(`p`,{children:[(0,T.jsx)(r,{size:16}),`Campaign Date: `,y(e.campaign_start)]}),(0,T.jsxs)(`p`,{children:[(0,T.jsx)(r,{size:16}),`Election Date: `,y(e.start_date)]}),(0,T.jsxs)(`p`,{children:[(0,T.jsx)(C,{size:16}),`Time: `,y(e.start_date),` -`,` `,y(e.end_date)]}),(0,T.jsxs)(`p`,{children:[(0,T.jsx)(o,{size:16}),`Venue: `,b(e)]})]}),(0,T.jsxs)(`div`,{className:`student-election-note`,children:[(0,T.jsx)(s,{size:16}),`Eligible students can review candidates and vote during active election windows.`]}),B(e)]},e.id))})]})}export{j as default};