const baseUrl = process.env.AZ_EXAM_COACH_URL ?? "http://127.0.0.1:3000";
const started = await fetch(`${baseUrl}/api/practice/sessions`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ exam_code: "AZ-104", mode: "random" }),
}).then((response) => response.json());
if (started.items.length !== 20 || started.summary.total !== 20) throw new Error("Random batch is not 20 questions");
const first = started.items[0];
const mark = async (marked) => fetch(`${baseUrl}/api/practice/sessions/${started.session_id}/mark`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ item_id: first.item_id, marked }),
}).then((response) => response.json());
const marked = await mark(true);
if (!marked.items[0].is_marked) throw new Error("Wrong-book mark was not persisted");
const summary = await fetch(`${baseUrl}/api/study-summary`, { cache: "no-store" }).then((response) => response.json());
await mark(false);
console.log(JSON.stringify({
  session_id: started.session_id,
  total: started.summary.total,
  mode: started.mode,
  accuracy: started.summary.accuracy,
  duration_ms: started.summary.duration_ms,
  mark_round_trip: true,
  wrong_book_count_during_test: summary.wrong_question_count,
}, null, 2));
