// One request only: an uncertain write response must never trigger a retry.
export async function invokeStudentManagement(client, endpoint, body) {
  let result=null,error,response,status=0,bodyInterrupted=false;
  try { ({data:result,error}=await client.functions.invoke(endpoint,{body})); }
  catch(cause){error=cause;}
  response=result;
  if(error?.context?.json){status=Number(error.context.status)||0;try{response=await error.context.clone().json();}catch{bodyInterrupted=true;}}
  if(!error&&response?.data!=null&&!response?.error)return {response,error:null};
  const resolved=new Error(response?.error||error?.message||'Student service request failed.');
  resolved.status=status;resolved.code=response?.code||error?.code||null;
  resolved.unconfirmed=!status||status>=500||(bodyInterrupted&&status>=200&&status<300);
  return {response,error:resolved};
}
export function studentManagementErrorMessage(error,{write=false}={}) {
  if(error?.status===401)return 'Your session could not be verified. Sign in again.';
  if(error?.status===403)return 'Active Super Admin authorization is required for this operation.';
  if(error?.status===404)return 'The student management service is not deployed or is unavailable. Contact the system administrator.';
  if(write&&error?.unconfirmed)return 'The result could not be confirmed. Refresh the student record or import review before retrying; some changes may already be recorded.';
  if(error?.status>=400&&error.status<500)return error.message||'The request was rejected. Review the supplied details.';
  return 'The student service could not be reached. Check the connection and refresh.';
}
