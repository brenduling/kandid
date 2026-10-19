import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  getProgressiveErrorContainer,
  getProgressiveFieldError,
  shouldShowProgressiveError,
} from "../utils/progressiveValidation";

let nextErrorId = 0;

function isFormField(element) {
  if (!(element instanceof HTMLElement) || !(element.form || element.closest("form"))) return false;
  if (element.dataset?.validationIgnore === "true") return false;
  if (!element.matches("input, select, textarea, [data-validation-field='true']")) return false;
  if (element.dataset?.validationField === "true") return true;
  if (element.hasAttribute("data-student-otp-index") || element.hasAttribute("data-student-login-otp-index")) return false;
  return !["hidden", "button", "submit", "reset", "image"].includes(element.type);
}

function formFor(field) {
  return field?.form || field?.closest?.("form") || null;
}

function isRenderedField(field) {
  if (field.closest("[hidden], [aria-hidden='true']")) return false;
  const style = window.getComputedStyle(field);
  return style.display !== "none" && style.visibility !== "hidden" && field.getClientRects().length > 0;
}

function fieldsIn(form) {
  const fields = [...form.querySelectorAll("input, select, textarea, [data-validation-field='true']")]
    .filter((field) => isFormField(field) && isRenderedField(field));
  const radioGroups = new Set();
  return fields.filter((field) => {
    if (field.type !== "radio" || !field.name) return true;
    if (radioGroups.has(field.name)) return false;
    radioGroups.add(field.name);
    return true;
  });
}

function appendDescription(field, errorId, originalAttributes) {
  const targets = field.dataset?.validationGroup === "otp" ? [field, ...field.querySelectorAll("input")] : [field];
  for (const target of targets) {
    if (!originalAttributes.has(target)) {
      originalAttributes.set(target, {
        describedBy: target.getAttribute("aria-describedby"),
        invalid: target.getAttribute("aria-invalid"),
      });
    }
    const tokens = new Set((target.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    tokens.add(errorId);
    target.setAttribute("aria-describedby", [...tokens].join(" "));
    target.setAttribute("aria-invalid", "true");
  }
}

function restoreDescription(field, originalAttributes) {
  const targets = field?.dataset?.validationGroup === "otp" ? [field, ...field.querySelectorAll("input")] : [field];
  for (const target of targets) {
    const original = originalAttributes.get(target);
    if (!original) continue;
    if (original.describedBy) target.setAttribute("aria-describedby", original.describedBy);
    else target.removeAttribute("aria-describedby");
    if (original.invalid === null) target.removeAttribute("aria-invalid");
    else target.setAttribute("aria-invalid", original.invalid);
    originalAttributes.delete(target);
  }
}

export default function ProgressiveValidationLayer() {
  const [visibleErrors, setVisibleErrors] = useState([]);

  useEffect(() => {
    const touched = new WeakSet();
    const submitted = new WeakSet();
    const errorIds = new WeakMap();
    const originalAttributes = new WeakMap();
    let currentErrors = new Map();

    const ensureNoValidate = (root) => {
      if (root instanceof HTMLFormElement) root.noValidate = true;
      root.querySelectorAll?.("form").forEach((form) => { form.noValidate = true; });
    };
    ensureNoValidate(document.body);

    const showErrors = (form, revealAll = false) => {
      if (!(form instanceof HTMLFormElement)) return [];
      const next = new Map(currentErrors);
      const invalidFields = [];

      for (const field of fieldsIn(form)) {
        const fieldForm = formFor(field);
        const shouldCheck = revealAll || submitted.has(form) || touched.has(field) || next.has(field);
        if (!shouldCheck) continue;

        const message = getProgressiveFieldError(field);
        if (!shouldShowProgressiveError(message, { touched: touched.has(field), submitted: revealAll || submitted.has(form) })) {
          restoreDescription(field, originalAttributes);
          next.delete(field);
          continue;
        }

        let errorId = errorIds.get(field);
        if (!errorId) {
          errorId = `kandid-field-error-${++nextErrorId}`;
          errorIds.set(field, errorId);
        }
        appendDescription(field, errorId, originalAttributes);
        const container = getProgressiveErrorContainer(field);
        const error = { field, form: fieldForm, id: errorId, message, container };
        next.set(field, error);
        invalidFields.push(error);
      }

      currentErrors = next;
      setVisibleErrors([...next.values()].filter((item) => item.field.isConnected && item.container?.isConnected));
      return invalidFields;
    };

    const onBlur = (event) => {
      const field = event.target.closest?.("[data-validation-group='otp']") || event.target;
      if (!isFormField(field)) return;
      touched.add(field);
      showErrors(formFor(field));
    };

    const onEdit = (event) => {
      const field = event.target.closest?.("[data-validation-group='otp']") || event.target;
      if (!isFormField(field)) return;
      touched.add(field);
      const form = formFor(field);
      if (form) {
        for (const dependent of fieldsIn(form)) {
          const selectors = [dependent.dataset?.matchField, dependent.dataset?.afterField, dependent.dataset?.beforeField];
          if (selectors.some((selector) => {
            if (!selector) return false;
            try {
              return form.querySelector(selector) === field;
            } catch {
              return false;
            }
          })) {
            touched.add(dependent);
          }
        }
        showErrors(form);
        queueMicrotask(() => {
          if (!field.isConnected) return;
          for (const selector of (field.dataset?.validationDependents || "").split(",").map((item) => item.trim()).filter(Boolean)) {
            try {
              const dependent = form.querySelector(selector);
              if (dependent && (dependent.required || dependent.dataset?.validationRequired === "true")) touched.add(dependent);
            } catch {
              // Ignore malformed optional dependency metadata.
            }
          }
          showErrors(form);
        });
      }
      if (field.type === "file" && getProgressiveFieldError(field)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const onStepNext = (event) => {
      const trigger = event.target instanceof Element ? event.target.closest("[data-progressive-next='true']") : null;
      const form = trigger?.form;
      if (!form) return;
      const errors = showErrors(form, true);
      if (!errors.length) return;
      event.preventDefault();
      event.stopPropagation();
      const first = errors[0].field.dataset?.validationGroup === "otp"
        ? errors[0].field.querySelector("input")
        : errors[0].field;
      requestAnimationFrame(() => {
        first.focus({ preventScroll: true });
        first.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };

    const onSubmit = (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      submitted.add(form);
      const errors = showErrors(form, true);
      if (!errors.length) return;

      event.preventDefault();
      event.stopPropagation();
      const first = errors[0].field.dataset?.validationGroup === "otp"
        ? errors[0].field.querySelector("input")
        : errors[0].field;
      requestAnimationFrame(() => {
        first.focus({ preventScroll: true });
        first.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };

    const pruneRemovedFields = () => {
      let changed = false;
      const next = new Map(currentErrors);
      for (const [field] of next) {
        if (!field.isConnected) {
          next.delete(field);
          changed = true;
        }
      }
      if (changed) {
        currentErrors = next;
        setVisibleErrors([...next.values()]);
      }
    };

    document.addEventListener("focusout", onBlur, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    document.addEventListener("click", onStepNext, true);
    document.addEventListener("submit", onSubmit, true);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) ensureNoValidate(node);
        });
      }
      pruneRemovedFields();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.removeEventListener("focusout", onBlur, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
      document.removeEventListener("click", onStepNext, true);
      document.removeEventListener("submit", onSubmit, true);
      for (const entry of currentErrors.values()) restoreDescription(entry.field, originalAttributes);
    };
  }, []);

  return visibleErrors.map(({ id, message, container }) =>
    createPortal(
      <span className="kandid-progressive-field-error" id={id} role="status" aria-live="polite">
        {message}
      </span>,
      container,
      id,
    ),
  );
}
