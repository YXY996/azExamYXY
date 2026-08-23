import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { hydrateCandidateBundle } from "./review-store";
import type { CandidateBundle } from "./types";

export type { CandidateBundle, CandidateQuestion, Option } from "./types";

const fallback: CandidateBundle = {
  document: { filename: "等待导入 PDF", exam_code: "AZ-104", page_count: 0, status: "empty" },
  candidates: [],
  review_versions: {},
};

export async function loadSourceBundle(): Promise<CandidateBundle> {
  const privateRoot = path.join(process.cwd(), "data", "private");
  let dataPath = path.join(privateRoot, "question-candidates.json");
  try {
    try {
      const pointerText = await readFile(path.join(privateRoot, "active-import.json"), "utf8");
      const pointer = JSON.parse(pointerText.replace(/^\uFEFF/, "")) as { candidate_path?: string };
      if (pointer.candidate_path) {
        const resolved = path.resolve(pointer.candidate_path);
        if (!resolved.startsWith(`${path.resolve(privateRoot)}${path.sep}`)) throw new Error("Invalid active import pointer");
        dataPath = resolved;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ dataPath, "utf8")) as Omit<CandidateBundle, "review_versions">;
    if (!parsed.document || !Array.isArray(parsed.candidates)) throw new Error("Invalid candidate bundle");
    return { ...parsed, review_versions: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function loadCandidateBundle(): Promise<CandidateBundle> {
  return hydrateCandidateBundle(await loadSourceBundle());
}
