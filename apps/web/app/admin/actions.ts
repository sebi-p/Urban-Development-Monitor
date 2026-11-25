"use server";

import {
  decideCandidate,
  mergeProjects,
  publishAudit,
  recordCheck,
  startAudit,
  requestRerun,
  setManualLocation,
  splitProject,
  type RerunStage,
} from "@mdu/db";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { adminLogin, signIn, signOut } from "@/auth";
import { AUDIT_TAG } from "@/lib/audit";
import { INDEX_TAG } from "@/lib/city-index";
import { getDb } from "@/lib/db";

/** Every action checks the session again: a server action is a public POST endpoint. */
async function requireAdmin(): Promise<string> {
  const login = await adminLogin();
  if (!login) throw new Error("not allowed");
  return login;
}

function text(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string" || !v) throw new Error(`missing ${key}`);
  return v;
}

export async function signInAction() {
  await signIn("github", { redirectTo: "/admin" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export async function decideAction(form: FormData) {
  const actor = await requireAdmin();
  const decision = text(form, "decision");
  if (decision !== "approve" && decision !== "reject") throw new Error("bad decision");
  await decideCandidate(getDb(), { id: text(form, "id"), decision, actor });
  revalidatePath("/admin");
  updateTag(INDEX_TAG); // the map page shows the change at once
}

export async function mergeAction(form: FormData) {
  const actor = await requireAdmin();
  const projectId = text(form, "projectId");
  await mergeProjects(getDb(), { projectId, intoId: text(form, "intoId"), actor });
  revalidatePath(`/admin/projects/${projectId}`);
  updateTag(INDEX_TAG); // the map page shows the change at once
}

export async function splitAction(form: FormData) {
  const actor = await requireAdmin();
  const projectId = text(form, "projectId");
  await splitProject(getDb(), { projectId, actor });
  revalidatePath(`/admin/projects/${projectId}`);
  updateTag(INDEX_TAG); // the map page shows the change at once
}

export async function locateAction(projectId: string, lon: number, lat: number) {
  const actor = await requireAdmin();
  await setManualLocation(getDb(), { projectId, lon, lat, actor });
  revalidatePath(`/admin/projects/${projectId}`);
  updateTag(INDEX_TAG); // the map page shows the change at once
}

export async function rerunAction(form: FormData) {
  const actor = await requireAdmin();
  const stage = text(form, "stage");
  if (!["extract", "classify", "fields"].includes(stage)) throw new Error("bad stage");
  await requestRerun(getDb(), {
    rawDocumentId: text(form, "documentId"),
    stage: stage as RerunStage,
    actor,
  });
  revalidatePath(`/admin/projects/${text(form, "projectId")}`);
}

export async function startAuditAction(form: FormData) {
  const actor = await requireAdmin();
  const id = await startAudit(getDb(), {
    city: text(form, "city"),
    size: Number(text(form, "size")),
    actor,
  });
  redirect(`/admin/audit/${id}/1`);
}

export async function checkAction(form: FormData) {
  const actor = await requireAdmin();
  const note = form.get("note");
  await recordCheck(getDb(), {
    itemId: text(form, "itemId"),
    field: text(form, "field"),
    key: typeof form.get("key") === "string" ? (form.get("key") as string) : "",
    verdict: text(form, "verdict"),
    note: typeof note === "string" ? note : null,
    actor,
  });
  revalidatePath(`/admin/audit/${text(form, "auditId")}/${text(form, "position")}`);
}

export async function publishAuditAction(form: FormData) {
  const actor = await requireAdmin();
  await publishAudit(getDb(), { auditId: text(form, "auditId"), actor });
  revalidatePath("/admin/audit");
  updateTag(AUDIT_TAG); // the published accuracy on /metodologie, at once
}
