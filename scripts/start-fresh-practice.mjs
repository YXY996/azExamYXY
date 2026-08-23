const baseUrl = process.env.AZ_EXAM_COACH_URL ?? "http://127.0.0.1:3000";
const response = await fetch(`${baseUrl}/api/practice/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ exam_code: "AZ-104", fresh: true }),
});
const payload = await response.json();
if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
console.log(JSON.stringify({
  session_id: payload.session_id,
  status: payload.status,
  answered: payload.summary.answered,
  total: payload.summary.total,
  image_interactions: payload.items.filter((item) => item.question.type === "image_interaction").length,
  answer_assets: payload.items.filter((item) => item.question.explanation?.answer_image_url).length,
}, null, 2));
