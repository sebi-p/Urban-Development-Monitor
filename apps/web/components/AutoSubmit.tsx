"use client";

import { useEffect } from "react";
import { setBusy } from "@/lib/busy";

/** Submits the form with this id whenever one of its fields changes (checkboxes, radios,
 * selects), shows that results are loading (lib/busy.ts), and hides what is only needed without JavaScript (`data-no-js`, the Apply button). */
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
    // Any submit of the form, by a change or the search button, loads a new page.
    const onSubmit = (e: SubmitEvent) => {
      if ((e.target as HTMLFormElement | null)?.id === form) setBusy(true);
    };
    const onShow = () => setBusy(false); // back to this page from the browser's cache
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("change", onChange);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
      setBusy(false);
    };
  }, [form]);
  return null;
}
