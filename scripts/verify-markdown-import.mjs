import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const db = new DatabaseSync(path.join(root, "apps", "web", "data", "private", "az-exam-coach.sqlite"), { readOnly: true });
const scalar = (sql) => Number(db.prepare(sql).get().count);
const result = {
  total_questions: scalar("SELECT COUNT(*) AS count FROM questions WHERE current_revision_id IS NOT NULL"),
  markdown_questions: scalar("SELECT COUNT(*) AS count FROM question_taxonomy"),
  az104_markdown: scalar("SELECT COUNT(*) AS count FROM question_taxonomy WHERE exam_code = 'AZ-104'"),
  az305_markdown: scalar("SELECT COUNT(*) AS count FROM question_taxonomy WHERE exam_code = 'AZ-305'"),
  knowledge_links: scalar("SELECT COUNT(*) AS count FROM question_knowledge_points"),
  missing_answers: scalar(`SELECT COUNT(*) AS count FROM question_taxonomy qt
    JOIN questions q ON q.id = qt.question_id
    LEFT JOIN answer_keys ak ON ak.question_revision_id = q.current_revision_id
    WHERE ak.id IS NULL`),
  missing_explanations: scalar(`SELECT COUNT(*) AS count FROM question_taxonomy qt
    JOIN questions q ON q.id = qt.question_id
    JOIN question_revisions qr ON qr.id = q.current_revision_id
    WHERE json_extract(qr.content_json, '$.explanation.display') IS NULL
      OR trim(json_extract(qr.content_json, '$.explanation.display')) = ''`),
};
db.close();
if (result.markdown_questions !== 600 || result.az104_markdown !== 330 || result.az305_markdown !== 270 || result.missing_answers || result.missing_explanations) {
  console.error(JSON.stringify(result));
  process.exit(1);
}
console.log(JSON.stringify(result));
