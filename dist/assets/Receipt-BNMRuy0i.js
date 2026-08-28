import{n as e,s as t,t as n}from"./jsx-runtime-2UHhqg_S.js";import{t as r}from"./external-link-DXxRgAIL.js";import{t as i}from"./shield-check-B7ZEQ3OK.js";import{d as a}from"./index-C3VR5hZT.js";import{t as o}from"./supabaseClient-DYsTm63z.js";import{i as s}from"./blockchain-ASY6yaNA.js";var c=t(e(),1),l=n();function u(){let[e,t]=(0,c.useState)([]),n=JSON.parse(localStorage.getItem(`user`));(0,c.useEffect)(()=>{let e=!0;async function r(){let{data:r,error:i}=await o.from(`votes`).select(`
          *,
          elections (
            title,
            organizations (
              name
            )
          ),
          positions (
            name
          )
        `).eq(`student_id`,n.id).order(`vote_timestamp`,{ascending:!1});e&&(i||t(r||[]),i&&console.log(i))}return r(),()=>{e=!1}},[n.id]);async function u(){let{data:e,error:r}=await o.from(`votes`).select(`
        *,
        elections (
          title,
          organizations (
            name
          )
        ),
        positions (
          name
        )
      `).eq(`student_id`,n.id).order(`vote_timestamp`,{ascending:!1});r||t(e||[]),r&&console.log(r)}return(0,l.jsxs)(`div`,{children:[(0,l.jsxs)(`div`,{className:`page-head`,children:[(0,l.jsxs)(`div`,{children:[(0,l.jsx)(`div`,{className:`page-kicker`,children:`Vote Receipt`}),(0,l.jsxs)(`h1`,{className:`page-title`,children:[`Your submitted`,(0,l.jsx)(`span`,{className:`page-title-accent`,children:` ballot records`})]}),(0,l.jsx)(`p`,{className:`page-subtitle`,children:`View your submitted vote records and verification hashes.`})]}),(0,l.jsxs)(`button`,{onClick:u,className:`primary-btn self-start lg:self-auto`,children:[(0,l.jsx)(a,{size:18}),`Refresh`]})]}),(0,l.jsx)(`div`,{className:`mt-8 space-y-4`,children:e.length===0?(0,l.jsx)(`div`,{className:`glass-panel rounded-[28px] p-8 text-gray-500`,children:`No vote records found.`}):e.map((e,t)=>(0,l.jsxs)(`div`,{className:`glass-panel-strong fade-up rounded-[28px] border p-6`,style:{animationDelay:`${t*35}ms`},children:[(0,l.jsxs)(`div`,{className:`flex items-start justify-between`,children:[(0,l.jsxs)(`div`,{children:[(0,l.jsx)(`p`,{className:`text-xs font-bold uppercase tracking-[0.18em] text-[#d35a25]`,children:e.elections?.organizations?.name||`Organization`}),(0,l.jsx)(`h2`,{className:`mt-2 text-2xl font-black`,children:e.elections?.title}),(0,l.jsxs)(`div`,{className:`mt-4 grid gap-3 md:grid-cols-2`,children:[(0,l.jsxs)(`div`,{className:`rounded-2xl bg-white/40 p-4`,children:[(0,l.jsx)(`p`,{className:`field-label !mb-1`,children:`Position`}),(0,l.jsx)(`p`,{className:`text-sm font-semibold text-[#1d262f]`,children:e.positions?.name||`-`})]}),(0,l.jsxs)(`div`,{className:`rounded-2xl bg-white/40 p-4`,children:[(0,l.jsx)(`p`,{className:`field-label !mb-1`,children:`Submitted On`}),(0,l.jsx)(`p`,{className:`text-sm font-semibold text-[#1d262f]`,children:e.vote_timestamp?new Date(e.vote_timestamp).toLocaleString():`-`})]})]})]}),(0,l.jsx)(`span`,{className:`status-pill ${e.is_abstain?`!bg-[rgba(29,38,47,0.08)] !text-gray-700`:`!bg-[rgba(54,147,111,0.12)] !text-green-700`}`,children:e.is_abstain?`Abstained`:`Submitted`})]}),(0,l.jsxs)(`div`,{className:`mt-5 rounded-2xl bg-white/50 p-4`,children:[(0,l.jsxs)(`div`,{className:`flex items-center gap-2 text-sm font-bold text-gray-700`,children:[(0,l.jsx)(i,{size:16,className:`text-green-600`}),`Verification Hash`]}),(0,l.jsx)(`p`,{className:`mt-2 text-xs font-mono text-gray-600 break-all`,children:e.vote_hash||`Pending hash`})]}),(0,l.jsxs)(`div`,{className:`mt-3 text-xs text-gray-500`,children:[`Blockchain Status:`,` `,e.blockchain_tx_id?(0,l.jsx)(`span`,{className:`font-bold text-green-600`,children:`Recorded on Sepolia`}):(0,l.jsx)(`span`,{className:`font-bold text-orange-600`,children:`Pending on-chain record`})]}),e.blockchain_tx_id?(0,l.jsxs)(`a`,{href:s(e.blockchain_tx_id),target:`_blank`,rel:`noreferrer`,className:`mt-3 inline-flex items-center gap-2 text-sm font-bold text-[#11806a] hover:underline`,children:[(0,l.jsx)(r,{size:15}),`View Sepolia transaction`]}):null]},e.id))})]})}export{u as default};