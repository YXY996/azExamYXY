import { connection } from "next/server";

import { loadCandidateBundle } from "@/lib/questions";
import Workspace from "./workspace";

export default async function Home() {
  await connection();
  return <Workspace bundle={await loadCandidateBundle()} />;
}
