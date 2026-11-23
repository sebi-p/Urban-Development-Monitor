"use client";

import { useEffect } from "react";

/** Submits the form with this id whenever one of its fields changes (checkboxes, radios,
 * selects), and hides what is only needed without JavaScript (`data-no-js`, the Apply button). */
export function AutoSubmit({ form }: { form: string }) {
  useEffect(() => {
    for (const n of document.querySelectorAll<HTMLElement>("[data-no-js]")) n.hidden = true;
    // Fields outside the form (joined with the `form` attribute) don't bubble to it: listen on the
    // document, and find the form when the change happens (React may replace the element).
    const onChange = (e: Event) => {
      const target = e.target as HTMLInputElement | null;
      // The form has no page field, so a new filter starts again on the first page.
      if (target?.form?.id === form && target.type !== "search" && target.type !== "text") {
        target.form.requestSubmit();
      }
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [form]);
  return null;
}
