const baseUrl = process.env.AUTH_TEST_URL ?? "http://127.0.0.1:3101";
const jsonPost = async (path, body, cookie) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json().catch(() => ({})) };
};

const anonymous = await fetch(`${baseUrl}/`, { redirect: "manual" });
if (anonymous.status !== 307 || !anonymous.headers.get("location")?.endsWith("/login")) throw new Error("Anonymous page was not redirected");
const registration = await jsonPost("/api/auth/register", { username: "ci_tester", password: "temporary-test-password-123" });
if (registration.response.status !== 200) throw new Error(`Registration failed: ${JSON.stringify(registration.payload)}`);
const cookie = registration.response.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie?.startsWith("az_exam_session=")) throw new Error("Session cookie missing");
const duplicate = await jsonPost("/api/auth/register", { username: "second_user", password: "temporary-test-password-456" });
if (duplicate.response.status !== 409) throw new Error("Second registration was not blocked");
const wrong = await jsonPost("/api/auth/login", { username: "ci_tester", password: "wrong-password" });
if (wrong.response.status !== 401) throw new Error("Wrong password was accepted");
const login = await jsonPost("/api/auth/login", { username: "ci_tester", password: "temporary-test-password-123" });
if (login.response.status !== 200) throw new Error("Valid login failed");
const protectedApi = await fetch(`${baseUrl}/api/study-summary`, { headers: { Cookie: cookie } });
if (protectedApi.status !== 200) throw new Error(`Authenticated API returned ${protectedApi.status}`);
const health = await fetch(`${baseUrl}/api/health`);
if (health.status !== 200) throw new Error("Anonymous health check failed");
console.log(JSON.stringify({ anonymous_redirect: true, registration: true, duplicate_registration_blocked: true, wrong_password_blocked: true, login: true, protected_api: true, public_health: true }, null, 2));
