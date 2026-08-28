import{n as e,s as t,t as n}from"./jsx-runtime-2UHhqg_S.js";import{t as r}from"./pencil-DPROMnV5.js";import{t as i}from"./plus-siKXoUKi.js";import{t as a}from"./trash-2-C2-9KGnw.js";import{t as o,u as s}from"./index-myr2Douh.js";import{t as c}from"./supabaseClient-CKHYq6kB.js";import{t as l}from"./PopupOverlay-YRxHh_PL.js";import{n as u,r as d,t as f}from"./candidates-BQr-nhJK.js";var p=t(e(),1),m=n();function h(){let e=o(),[t,n]=(0,p.useState)([]),[h,g]=(0,p.useState)([]),[_,v]=(0,p.useState)([]),[y,b]=(0,p.useState)([]),[x,S]=(0,p.useState)(!1),[C,w]=(0,p.useState)(null),[T,E]=(0,p.useState)({position_id:``,student_id:``,partylist_id:``,photo:``,bio:``,platform:``,credentials:``,campaign_materials:f()}),D=JSON.parse(localStorage.getItem(`user`))?.organization_id;(0,p.useEffect)(()=>{let e=!0;async function t(){if(!D)return;let{data:t}=await c.from(`elections`).select(`id`).eq(`organization_id`,D),r=t?.map(e=>e.id)||[];if(r.length===0){e&&(n([]),g([]),b([]));return}let{data:i}=await c.from(`positions`).select(`
          id,
          name,
          election_id,
          elections (
            title
          )
        `).in(`election_id`,r),a=i?.map(e=>e.id)||[],o=[];if(a.length>0){let{data:e}=await c.from(`candidates`).select(`
            *,
            students (
              first_name,
              last_name,
              student_number
            ),
            positions (
              name,
              elections (
                title
              )
            ),
            partylists (
              name
            )
          `).in(`position_id`,a).order(`id`,{ascending:!0});o=e||[]}let{data:s}=await c.from(`partylists`).select(`id, name, election_id`).in(`election_id`,r),{data:l}=await c.from(`student_organizations`).select(`
          students (
            id,
            student_number,
            first_name,
            last_name
          )
        `).eq(`organization_id`,D);e&&(g(i||[]),n(o),b(s||[]),v((l||[]).map(e=>e.students).filter(Boolean)))}return t(),()=>{e=!1}},[D]);async function O(){if(!D)return;let{data:e}=await c.from(`elections`).select(`id`).eq(`organization_id`,D),t=e?.map(e=>e.id)||[];if(t.length===0){n([]),g([]),b([]);return}let{data:r}=await c.from(`positions`).select(`
        id,
        name,
        election_id,
        elections (
          title
        )
      `).in(`election_id`,t),i=r?.map(e=>e.id)||[],a=[];if(i.length>0){let{data:e}=await c.from(`candidates`).select(`
          *,
          students (
            first_name,
            last_name,
            student_number
          ),
          positions (
            name,
            elections (
              title
            )
          ),
          partylists (
            name
          )
        `).in(`position_id`,i).order(`id`,{ascending:!0});a=e||[]}let{data:o}=await c.from(`partylists`).select(`id, name, election_id`).in(`election_id`,t);g(r||[]),n(a),b(o||[])}function k(){w(null),E({position_id:``,student_id:``,partylist_id:``,photo:``,bio:``,platform:``,credentials:``,campaign_materials:f()}),S(!0)}function A(e){w(e),E({position_id:e.position_id||``,student_id:e.student_id||``,partylist_id:e.partylist_id||``,photo:e.photo||``,bio:e.bio||``,platform:e.platform||``,credentials:e.credentials||``,campaign_materials:f(e.campaign_materials,e.campaign_media_urls)}),S(!0)}function j(e,t,n){let r=[...T.campaign_materials];r[e]={...r[e],[t]:n},E({...T,campaign_materials:r})}async function M(t){t.preventDefault();let n=u(T.campaign_materials);if(n.length>3){await e.alert({title:`Campaign Limit`,message:`Only 1 to 3 campaign materials are allowed per candidate.`,type:`warning`});return}let r={position_id:Number(T.position_id),student_id:Number(T.student_id),partylist_id:T.partylist_id?Number(T.partylist_id):null,photo:T.photo||null,bio:T.bio||null,platform:T.platform||null,credentials:T.credentials||null,campaign_materials:n,campaign_media_urls:n.map(e=>e.url)},{error:i}=await(C?c.from(`candidates`).update(r).eq(`id`,C.id):c.from(`candidates`).insert([r]));if(i){e.error(i.message);return}e.success(C?`Candidate updated.`:`Candidate created.`),S(!1),O()}async function N(t){if(!await e.confirm({title:`Delete Candidate?`,message:`Are you sure you want to remove this candidate?`,type:`danger`,confirmText:`Delete`}))return;let{error:n}=await c.from(`candidates`).delete().eq(`id`,t);if(n){e.error(n.message||`Failed to delete candidate.`);return}e.success(`Candidate deleted.`),O()}return(0,m.jsxs)(`div`,{children:[(0,m.jsxs)(`div`,{className:`page-head`,children:[(0,m.jsxs)(`div`,{children:[(0,m.jsx)(`div`,{className:`page-kicker`,children:`Candidate Lineup`}),(0,m.jsx)(`h1`,{className:`page-title`,children:`Board candidates`}),(0,m.jsx)(`p`,{className:`page-subtitle`,children:`Manage candidates and campaign content for your organization.`})]}),(0,m.jsxs)(`button`,{onClick:k,className:`primary-btn self-start lg:self-auto`,children:[(0,m.jsx)(i,{size:18}),`Add Candidate`]})]}),(0,m.jsx)(`div`,{className:`table-shell mt-8`,children:(0,m.jsxs)(`table`,{className:`app-table`,children:[(0,m.jsx)(`thead`,{children:(0,m.jsxs)(`tr`,{children:[(0,m.jsx)(`th`,{children:`Candidate`}),(0,m.jsx)(`th`,{children:`Student ID`}),(0,m.jsx)(`th`,{children:`Position`}),(0,m.jsx)(`th`,{children:`Election`}),(0,m.jsx)(`th`,{children:`Partylist`}),(0,m.jsx)(`th`,{children:`Media`}),(0,m.jsx)(`th`,{className:`text-right`,children:`Actions`})]})}),(0,m.jsx)(`tbody`,{children:t.length===0?(0,m.jsx)(`tr`,{children:(0,m.jsx)(`td`,{colSpan:`7`,className:`px-6 py-10 text-center empty-copy`,children:`No candidates found for your organization.`})}):t.map(e=>(0,m.jsxs)(`tr`,{children:[(0,m.jsxs)(`td`,{className:`font-bold`,children:[e.students?.first_name,` `,e.students?.last_name]}),(0,m.jsx)(`td`,{className:`text-[#5a5548]`,children:e.students?.student_number}),(0,m.jsx)(`td`,{children:e.positions?.name||`Unknown`}),(0,m.jsx)(`td`,{className:`text-[#5a5548]`,children:e.positions?.elections?.title||`-`}),(0,m.jsx)(`td`,{children:e.partylists?.name||`Independent`}),(0,m.jsx)(`td`,{className:`text-[#5a5548]`,children:d(e.campaign_materials,e.campaign_media_urls).length}),(0,m.jsx)(`td`,{children:(0,m.jsxs)(`div`,{className:`flex justify-end gap-2`,children:[(0,m.jsx)(`button`,{onClick:()=>A(e),className:`icon-action`,children:(0,m.jsx)(r,{size:16})}),(0,m.jsx)(`button`,{onClick:()=>N(e.id),className:`icon-action icon-action-danger`,children:(0,m.jsx)(a,{size:16})})]})})]},e.id))})]})}),x&&(0,m.jsx)(l,{children:(0,m.jsxs)(`div`,{className:`modal-card max-w-3xl`,children:[(0,m.jsxs)(`div`,{className:`mb-6 flex items-center justify-between`,children:[(0,m.jsx)(`h2`,{className:`text-2xl font-black`,children:C?`Edit Candidate`:`Add Candidate`}),(0,m.jsx)(`button`,{onClick:()=>S(!1),className:`icon-action`,children:(0,m.jsx)(s,{size:20})})]}),(0,m.jsxs)(`form`,{onSubmit:M,className:`modal-form-stack`,children:[(0,m.jsxs)(`div`,{children:[(0,m.jsx)(`label`,{className:`field-label`,children:`Position`}),(0,m.jsxs)(`select`,{required:!0,value:T.position_id,onChange:e=>E({...T,position_id:e.target.value}),className:`field-shell w-full`,children:[(0,m.jsx)(`option`,{value:``,children:`Select Position`}),h.map(e=>(0,m.jsxs)(`option`,{value:e.id,children:[e.name,` - `,e.elections?.title]},e.id))]})]}),(0,m.jsxs)(`div`,{children:[(0,m.jsx)(`label`,{className:`field-label`,children:`Student`}),(0,m.jsxs)(`select`,{required:!0,value:T.student_id,onChange:e=>E({...T,student_id:e.target.value}),className:`field-shell w-full`,children:[(0,m.jsx)(`option`,{value:``,children:`Select Student`}),_.map(e=>(0,m.jsxs)(`option`,{value:e.id,children:[e.last_name,`, `,e.first_name,` - `,e.student_number]},e.id))]})]}),(0,m.jsxs)(`div`,{children:[(0,m.jsx)(`label`,{className:`field-label`,children:`Partylist`}),(0,m.jsxs)(`select`,{value:T.partylist_id,onChange:e=>E({...T,partylist_id:e.target.value}),className:`field-shell w-full`,children:[(0,m.jsx)(`option`,{value:``,children:`Independent / No Partylist`}),y.map(e=>(0,m.jsx)(`option`,{value:e.id,children:e.name},e.id))]})]}),(0,m.jsxs)(`div`,{children:[(0,m.jsx)(`label`,{className:`field-label`,children:`Photo URL`}),(0,m.jsx)(`input`,{value:T.photo,onChange:e=>E({...T,photo:e.target.value}),placeholder:`Photo URL optional`,className:`field-shell w-full`})]}),(0,m.jsxs)(`div`,{children:[(0,m.jsx)(`label`,{className:`field-label`,children:`Platform`}),(0,m.jsx)(`textarea`,{value:T.platform,onChange:e=>E({...T,platform:e.target.value}),placeholder:`Candidate platform`,className:`field-shell min-h-[120px] w-full`,rows:`3`})]}),(0,m.jsxs)(`div`,{children:[(0,m.jsx)(`label`,{className:`field-label`,children:`Credentials`}),(0,m.jsx)(`textarea`,{value:T.credentials,onChange:e=>E({...T,credentials:e.target.value}),placeholder:`Credentials and achievements`,className:`field-shell min-h-[120px] w-full`,rows:`3`})]}),(0,m.jsxs)(`div`,{children:[(0,m.jsx)(`label`,{className:`field-label`,children:`Bio`}),(0,m.jsx)(`textarea`,{value:T.bio,onChange:e=>E({...T,bio:e.target.value}),placeholder:`Candidate bio`,className:`field-shell min-h-[120px] w-full`,rows:`3`})]}),(0,m.jsxs)(`div`,{className:`upload-shell`,children:[(0,m.jsx)(`p`,{className:`text-sm font-bold text-[#1d262f]`,children:`Campaign Materials`}),(0,m.jsx)(`p`,{className:`mt-1 text-xs text-[#5a5548]`,children:`Add up to 3 downloadable or viewable materials per candidate.`}),(0,m.jsx)(`div`,{className:`mt-3 space-y-3`,children:T.campaign_materials.map((e,t)=>(0,m.jsxs)(`div`,{className:`modal-form-grid rounded-xl border border-[rgba(255,115,22,0.12)] bg-white/45 p-4`,children:[(0,m.jsx)(`input`,{value:e.label,onChange:e=>j(t,`label`,e.target.value),placeholder:`Material title ${t+1}`,className:`field-shell`}),(0,m.jsxs)(`select`,{value:e.type,onChange:e=>j(t,`type`,e.target.value),className:`field-shell`,children:[(0,m.jsx)(`option`,{value:`link`,children:`Link`}),(0,m.jsx)(`option`,{value:`document`,children:`Document`}),(0,m.jsx)(`option`,{value:`media`,children:`Media`})]}),(0,m.jsx)(`input`,{value:e.url,onChange:e=>j(t,`url`,e.target.value),placeholder:`https://...`,className:`field-shell md:col-span-2`}),(0,m.jsxs)(`label`,{className:`md:col-span-2 flex items-center gap-3 rounded-xl bg-white/60 px-4 py-3 text-sm font-semibold text-[#1d262f]`,children:[(0,m.jsx)(`input`,{type:`checkbox`,checked:e.downloadable,onChange:e=>j(t,`downloadable`,e.target.checked)}),`Allow student download`]})]},t))})]}),(0,m.jsx)(`button`,{className:`primary-btn w-full`,children:C?`Save Changes`:`Add Candidate`})]})]})})]})}export{h as default};