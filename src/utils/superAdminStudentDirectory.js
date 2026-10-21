// Orchestrates existing trusted reads; no new browser table access or writes.
export async function loadSuperAdminStudentDirectory({listStudents,organizationMembers,memberships},filters) {
  let studentIds=null;
  if(filters.organization!=='all'){
    const result=await organizationMembers(Number(filters.organization));if(result.error)throw result.error;
    studentIds=[...new Set((result.data||[]).map(row=>Number(row.student_id)).filter(id=>Number.isSafeInteger(id)&&id>0))];
    if(!studentIds.length)return {students:[],total:0};
  }
  const result=await listStudents({search:filters.search,status:filters.status,studentIds,sort:filters.sort,page:filters.page,pageSize:filters.pageSize});
  if(result.error)throw result.error;
  const directory=result.data;
  if(!Array.isArray(directory?.data)||!Number.isSafeInteger(directory.total_count)||directory.total_count<0)throw Error('The student directory response could not be verified.');
  const enriched=await memberships(directory.data);if(enriched.error)throw enriched.error;
  return {students:enriched.data,total:directory.total_count};
}
