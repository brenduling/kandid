import{n as e,s as t,t as n}from"./jsx-runtime-2UHhqg_S.js";import{h as r}from"./index-Dm0rfV3K.js";import{t as i}from"./supabaseClient-BJR8ErGU.js";import{t as a}from"./results-BCqOMD-9.js";var o=t(e(),1),s=n();function c(){let[e,t]=(0,o.useState)([]),[n,c]=(0,o.useState)([]),[l,u]=(0,o.useState)(``),d=JSON.parse(localStorage.getItem(`user`))?.organization_id;(0,o.useEffect)(()=>{let e=!0;async function n(){if(!d)return;let{data:n}=await i.from(`elections`).select(`id, title, organization_id, organizations(name)`).eq(`organization_id`,d),r=n?.map(e=>e.id)||[];if(!e)return;if(c(n||[]),r.length===0){t([]);return}let{data:a,error:o}=await i.from(`votes`).select(`
          *,
          students (
            program,
            year_level
          ),
          candidates (
            id,
            students (
              first_name,
              last_name
            )
          ),
          positions (
            id,
            name
          ),
          elections (
            id,
            title
          )
        `).in(`election_id`,r);e&&(o||t(a||[]),o&&console.log(o))}return n(),()=>{e=!1}},[d]);async function f(){if(!d)return;let{data:e}=await i.from(`elections`).select(`id, title, organization_id, organizations(name)`).eq(`organization_id`,d),n=e?.map(e=>e.id)||[];if(c(e||[]),n.length===0){t([]);return}let{data:r,error:a}=await i.from(`votes`).select(`
        *,
        students (
          program,
          year_level
        ),
        candidates (
          id,
          students (
            first_name,
            last_name
          )
        ),
        positions (
          id,
          name
        ),
        elections (
          id,
          title
        )
      `).in(`election_id`,n);a||t(r||[]),a&&console.log(a)}let p=a(l?e.filter(e=>e.election_id===Number(l)):[],n.find(e=>e.id===Number(l)));return(0,s.jsxs)(`div`,{children:[(0,s.jsxs)(`div`,{className:`flex items-center justify-between`,children:[(0,s.jsxs)(`div`,{children:[(0,s.jsx)(`h1`,{className:`text-3xl font-black`,children:`Board Results`}),(0,s.jsx)(`p`,{className:`text-gray-500 mt-1`,children:`View vote tallies for your organization elections.`})]}),(0,s.jsxs)(`button`,{onClick:f,className:`flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]`,children:[(0,s.jsx)(r,{size:18}),`Refresh`]})]}),(0,s.jsx)(`div`,{className:`mt-6`,children:(0,s.jsxs)(`select`,{value:l,onChange:e=>u(e.target.value),className:`bg-white px-4 py-3 rounded-xl shadow-sm outline-none`,children:[(0,s.jsx)(`option`,{value:``,children:`Select Election`}),n.map(e=>(0,s.jsx)(`option`,{value:e.id,children:e.title},e.id))]})}),(0,s.jsx)(`div`,{className:`mt-8 space-y-6`,children:l?Object.keys(p.groupedResults).length===0?(0,s.jsx)(`div`,{className:`bg-white p-8 rounded-2xl shadow-sm text-gray-500`,children:`No results yet.`}):(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(`div`,{className:`grid grid-cols-1 gap-6 md:grid-cols-3`,children:[[`Vote Entries`,p.totalVoteEntries],[`Unique Voters`,p.totalUniqueVoters],[`Abstain Count`,p.totalAbstains]].map(([e,t])=>(0,s.jsxs)(`div`,{className:`metric-card lift-card`,children:[(0,s.jsx)(`p`,{className:`text-sm font-semibold text-gray-500`,children:e}),(0,s.jsx)(`h2`,{className:`mt-4 text-5xl font-black tracking-tight`,children:t})]},e))}),(0,s.jsxs)(`div`,{className:`grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]`,children:[(0,s.jsxs)(`div`,{className:`soft-card`,children:[(0,s.jsxs)(`div`,{className:`flex items-center justify-between`,children:[(0,s.jsxs)(`div`,{children:[(0,s.jsx)(`p`,{className:`text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]`,children:p.allocationLabel}),(0,s.jsx)(`h3`,{className:`mt-2 text-2xl font-black`,children:`Voter distribution`})]}),(0,s.jsx)(`span`,{className:`status-pill`,children:p.organizationName})]}),(0,s.jsx)(`div`,{className:`mt-6 space-y-4`,children:p.allocationItems.map(e=>(0,s.jsxs)(`div`,{className:`info-row`,children:[(0,s.jsxs)(`div`,{children:[(0,s.jsx)(`p`,{className:`text-sm font-bold text-[#1d262f]`,children:e.label}),(0,s.jsxs)(`p`,{className:`mt-1 text-xs text-gray-500`,children:[e.percentage,`% of voters`]})]}),(0,s.jsx)(`span`,{className:`text-lg font-black text-[#d35a25]`,children:e.count})]},e.label))})]}),(0,s.jsxs)(`div`,{className:`glass-panel-dark rounded-[30px] p-7 text-white`,children:[(0,s.jsx)(`p`,{className:`text-xs font-bold uppercase tracking-[0.18em] text-white/45`,children:`Historical Tracking`}),(0,s.jsx)(`h3`,{className:`mt-3 text-3xl font-black`,children:`Previous and current elections`}),(0,s.jsx)(`p`,{className:`mt-4 text-sm leading-7 text-white/65`,children:`Choose any election from your organization to review exact counts, turnout, and program or year-level allocation, including older cycles.`})]})]}),Object.values(p.groupedResults).map((e,t)=>{let n=Object.values(e.candidates).sort((e,t)=>t.votes-e.votes);return(0,s.jsxs)(`div`,{className:`bg-white p-6 rounded-2xl shadow-sm`,children:[(0,s.jsx)(`h2`,{className:`text-xl font-black mb-4`,children:e.position}),(0,s.jsxs)(`table`,{className:`w-full text-left`,children:[(0,s.jsx)(`thead`,{className:`border-b`,children:(0,s.jsxs)(`tr`,{children:[(0,s.jsx)(`th`,{className:`py-3 text-sm`,children:`Candidate`}),(0,s.jsx)(`th`,{className:`py-3 text-sm`,children:`Votes`}),(0,s.jsx)(`th`,{className:`py-3 text-sm`,children:`Status`})]})}),(0,s.jsxs)(`tbody`,{children:[n.map((e,t)=>(0,s.jsxs)(`tr`,{className:`border-b last:border-b-0`,children:[(0,s.jsx)(`td`,{className:`py-3 font-semibold`,children:e.name}),(0,s.jsx)(`td`,{className:`py-3`,children:e.votes}),(0,s.jsx)(`td`,{className:`py-3`,children:t===0?(0,s.jsx)(`span`,{className:`text-green-600 font-bold`,children:`Leading`}):`-`})]},t)),(0,s.jsxs)(`tr`,{children:[(0,s.jsx)(`td`,{className:`py-3 font-semibold text-gray-500`,children:`Abstain`}),(0,s.jsx)(`td`,{className:`py-3`,children:e.abstain}),(0,s.jsx)(`td`,{className:`py-3`,children:`-`})]})]})]})]},t)})]}):(0,s.jsx)(`div`,{className:`bg-white p-8 rounded-2xl shadow-sm text-gray-500`,children:`Select an election to view results.`})})]})}export{c as default};