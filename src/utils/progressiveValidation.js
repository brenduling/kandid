import { getPasswordChecks } from "./password.js";
import { parseScheduleWallClock } from "./time.js";

function fieldLabel(field) {
  const nearbyLabel = field.closest?.("[data-validation-field], .student-settings-field, .sa-registration-field, .board-position-sheet-field, .form-group, .field-group, .form-field")?.querySelector("label")
    || field.parentElement?.querySelector?.("label");
  // Errors are portaled into labels. Never use those messages as part of the
  // next field label, or repeated validation recursively grows the error text.
  const label = field.labels?.[0] || nearbyLabel;
  const cleanLabel = label?.cloneNode?.(true);
  cleanLabel?.querySelectorAll(".kandid-progressive-field-error").forEach((error) => error.remove());
  const text = field.dataset?.validationLabel || cleanLabel?.textContent || label?.textContent || field.getAttribute?.("aria-label") || field.name || "This field";
  return text.replace(/\s+/g, " ").replace(/[＊*]\s*$/, "").trim();
}

function findRelatedField(field, selector) {
  if (!selector || !field.form) return null;
  try {
    return field.form.querySelector(selector);
  } catch {
    return null;
  }
}

export function getProgressiveFieldError(field) {
  if (!field || field.disabled || field.readOnly) return "";

  const label = fieldLabel(field);
  const validity = field.validity;
  const value = String(field.value ?? "");

  if (field.required && (field.type === "text" || field.type === "search" || field.tagName === "TEXTAREA") && !value.trim()) {
    return `${label} is required.`;
  }
  if (validity?.valueMissing) return `${label} is required.`;
  if (validity?.typeMismatch) {
    if (field.type === "email") return "Enter a valid email address.";
    if (field.type === "url") return "Enter a valid URL.";
    return `Enter a valid ${label.toLowerCase()}.`;
  }
  if (validity?.patternMismatch) return field.dataset?.validationMessage || `Enter a valid ${label.toLowerCase()}.`;
  if (validity?.tooShort) return `${label} must be at least ${field.minLength} characters.`;
  if (validity?.tooLong) return `${label} must be no more than ${field.maxLength} characters.`;

  if (field.dataset?.passwordPolicy && value) {
    const unmet = getPasswordChecks(value).filter((check) => !check.met);
    const requirements = {
      length: "at least 6 characters",
      letter: "a letter",
      number: "a number",
      special: "a symbol",
    };
    if (unmet.length) return `Password must include ${unmet.map((check) => requirements[check.id] || check.label.toLowerCase()).join(", ")}.`;
  }

  const matchField = findRelatedField(field, field.dataset?.matchField);
  if (matchField && value && value !== String(matchField.value ?? "")) {
    return field.dataset?.matchMessage || `${label} must match ${field.dataset?.matchLabel || fieldLabel(matchField).toLowerCase()}.`;
  }

  const afterField = findRelatedField(field, field.dataset?.afterField);
  if (afterField?.value && value) {
    const currentTime = parseScheduleWallClock(value)?.getTime();
    const relatedTime = parseScheduleWallClock(afterField.value)?.getTime();
    const inclusive = field.dataset?.afterInclusive === "true";
    if (Number.isFinite(currentTime) && Number.isFinite(relatedTime) && (inclusive ? currentTime < relatedTime : currentTime <= relatedTime)) {
      return field.dataset?.afterMessage || `${label} must be after ${field.dataset?.afterLabel || fieldLabel(afterField).toLowerCase()}.`;
    }
  }

  const beforeField = findRelatedField(field, field.dataset?.beforeField);
  if (beforeField?.value && value) {
    const currentTime = parseScheduleWallClock(value)?.getTime();
    const relatedTime = parseScheduleWallClock(beforeField.value)?.getTime();
    const inclusive = field.dataset?.beforeInclusive === "true";
    if (Number.isFinite(currentTime) && Number.isFinite(relatedTime) && (inclusive ? currentTime > relatedTime : currentTime >= relatedTime)) {
      return field.dataset?.beforeMessage || `${label} must be before ${field.dataset?.beforeLabel || fieldLabel(beforeField).toLowerCase()}.`;
    }
  }

  if (field.dataset?.validationField === "true" && field.dataset.validationRequired === "true" && !String(field.dataset.validationValue || "").trim()) {
    return `${label} is required.`;
  }
  if (field.dataset?.validationGroup === "otp" && !/^\d{6}$/.test(String(field.dataset.validationValue || ""))) {
    return "Enter all six digits of the verification code.";
  }

  if (validity?.rangeUnderflow) {
    if (field.dataset?.rangeUnderflowMessage) return field.dataset.rangeUnderflowMessage;
    if (field.type === "time" || field.type === "date" || field.type === "datetime-local") return `Choose a ${label.toLowerCase()} within the allowed range.`;
    return field.min ? `${label} must be at least ${field.min}.` : `Choose a valid ${label.toLowerCase()}.`;
  }
  if (validity?.rangeOverflow) {
    if (field.dataset?.rangeOverflowMessage) return field.dataset.rangeOverflowMessage;
    if (field.type === "time" || field.type === "date" || field.type === "datetime-local") return `Choose a ${label.toLowerCase()} within the allowed range.`;
    return field.max ? `${label} must be no more than ${field.max}.` : `Choose a valid ${label.toLowerCase()}.`;
  }
  if (validity?.stepMismatch) return `Enter an allowed value for ${label.toLowerCase()}.`;
  if (validity?.badInput) return `Enter a valid ${label.toLowerCase()}.`;
  if (validity?.customError) return field.validationMessage || `Check ${label.toLowerCase()}.`;

  if (field.type === "file" && field.files?.length && field.accept) {
    const accepted = field.accept.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
    const file = field.files[0];
    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();
    const matches = accepted.some((rule) =>
      rule.startsWith(".")
        ? fileName.endsWith(rule)
        : rule.endsWith("/*")
          ? fileType.startsWith(rule.slice(0, -1))
          : fileType === rule,
    );
    if (!matches) return `Choose a supported file for ${label.toLowerCase()}.`;
  }

  return "";
}

export function shouldShowProgressiveError(error, { touched = false, submitted = false } = {}) {
  return Boolean(error) && (touched || submitted);
}

export function getProgressiveErrorContainer(field) {
  if (field.dataset?.validationField === "true") return field.parentElement || field.form;
  return field.closest?.(
    "[data-validation-field], .student-settings-field, .sa-registration-field, .board-position-sheet-field, .form-group, .field-group, .form-field, .student-setup-label",
  ) || field.parentElement || field.form;
}
