export function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} is required.`);
  return id;
}

export function optionalPositiveId(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return positiveId(value, label);
}
