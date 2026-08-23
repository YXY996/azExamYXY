import { connection } from "next/server";
import { cookies } from "next/headers";

import { getUserById } from "@/lib/auth-store";
import { sessionSecret } from "@/lib/auth-response";
import { loadCandidateBundle } from "@/lib/questions";
import { readSessionToken } from "@/lib/session-token";
import type { CandidateBundle } from "@/lib/types";
import Workspace from "./workspace";

export default async function Home() {
  await connection();
  const session = await readSessionToken((await cookies()).get("az_exam_session")?.value, sessionSecret());
  const currentUser = session ? getUserById(session.sub) : null;
  if (!currentUser) return null;

  // Never serialize the private review bundle to a preview user's browser.
  const bundle: CandidateBundle = currentUser.role === "admin"
    ? await loadCandidateBundle()
    : { document: { filename: "AZ Exam Coach", exam_code: "AZ-104", page_count: 0, status: "ready" }, candidates: [], review_versions: {} };
  return <Workspace bundle={bundle} currentUser={currentUser} />;
}
