// Shared CSV column contract used by the established student masterlist intake.
export const STUDENT_CSV_REQUIRED_COLUMNS = ['student_number','first_name','last_name','program','year_level'];
export function validateStudentCsv(result) {
  const fields=(result.meta?.fields||[]).map(value=>String(value).trim());
  const missing=STUDENT_CSV_REQUIRED_COLUMNS.filter(key=>!fields.includes(key));
  const errors=(result.errors||[]).map(error=>`CSV ${Number.isInteger(error.row)?`row ${error.row+2}`:'format'}: ${error.message}`);
  if(missing.length)errors.push(`Missing headers: ${missing.join(', ')}`);
  if(result.meta?.renamedHeaders && Object.keys(result.meta.renamedHeaders).length)errors.push('Duplicate CSV headers are not allowed.');
  if(!Array.isArray(result.data)||result.data.length===0)errors.push('The CSV contains no student rows.');
  if(result.data?.length>5000)return {validRows:[],invalidRows:[],errors:[...errors,'Use files containing at most 5,000 rows.']};
  const seen=new Map();
  for(const [index,row] of (result.data||[]).entries()){
    const id=String(row.student_number||'').trim();if(!id)continue;
    if(!seen.has(id))seen.set(id,[]);seen.get(id).push(index+2);
  }
  const valid=[],invalid=[];
  for(const [index,row] of (result.data||[]).entries()){
    const text=key=>String(row[key]??'').trim();const issues=[];
    for(const key of STUDENT_CSV_REQUIRED_COLUMNS)if(!text(key))issues.push(`${key} is required`);
    if(text('student_number')&&!/^\d{5}$/.test(text('student_number')))issues.push('Student number must contain 5 digits');
    if(text('email')&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text('email')))issues.push('Invalid email format');
    if(!/^[1-6]$/.test(text('year_level')))issues.push('Year level must be a whole number from 1 to 6');
    const duplicateRows=seen.get(text('student_number'))||[];
    if(duplicateRows.length>1)issues.push(`Duplicate Student ID in CSV rows ${duplicateRows.slice(0,10).join(', ')}${duplicateRows.length>10?' and additional rows':''}`);
    if(issues.length)invalid.push({row:index+2,reason:issues.join('; ')});
    else valid.push({row_number:index+2,student_number:text('student_number'),first_name:text('first_name'),last_name:text('last_name'),email:text('email').toLowerCase(),program:text('program').toUpperCase(),year_level:Number(text('year_level')),is_shs:false,status:'pending'});
  }
  return {validRows:errors.length?[]:valid,invalidRows:invalid,errors};
}
