"use server";

import {
  decideCandidate,
  mergeProjects,
  requestRerun,
  setManualLocation,
  splitProject,
  type RerunStage,
} from "@mdu/db";
import { revalidatePath } from "next/cache";
import { adminLogin, signIn, signOut } from "@/auth";
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
}

export async function mergeAction(form: FormData) {
  const actor = await requireAdmin();
  const projectId = text(form, "projectId");
  await mergeProjects(getDb(), { projectId, intoId: text(form, "intoId"), actor });
  revalidatePath(`/admin/projects/${projectId}`);
}

export async function splitAction(form: FormData) {
  const actor = await requireAdmin();
  const projectId = text(form, "projectId");
  await splitProject(getDb(), { projectId, actor });
  revalidatePath(`/admin/projects/${projectId}`);
}

export async function locateAction(projectId: string, lon: number, lat: number) {
  const actor = await requireAdmin();
  await setManualLocation(getDb(), { projectId, lon, lat, actor });
  revalidatePath(`/admin/projects/${projectId}`);
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
