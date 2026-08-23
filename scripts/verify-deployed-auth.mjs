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
if (registration.payload.user?.role !== "admin" || registration.payload.user?.access_tier !== "full") throw new Error("First user is not administrator");
const cookie = registration.response.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie?.startsWith("az_exam_session=")) throw new Error("Session cookie missing");
const second = await jsonPost("/api/auth/register", { username: "second_user", password: "temporary-test-password-456" });
if (second.response.status !== 200 || second.payload.user?.access_tier !== "preview") throw new Error("Preview registration failed");
const secondCookie = second.response.headers.get("set-cookie")?.split(";", 1)[0];
const forbiddenAdmin = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: secondCookie } });
if (forbiddenAdmin.status !== 403) throw new Error("Preview user reached admin API");
const issued = await jsonPost("/api/admin/access-keys", { user_id: second.payload.user.id }, cookie);
if (issued.response.status !== 201 || !issued.payload.access_key?.key) throw new Error("Bound access key was not issued");
const wrongOwner = await jsonPost("/api/access/redeem", { key: issued.payload.access_key.key }, cookie);
if (wrongOwner.response.status !== 400) throw new Error("Key was accepted by the wrong user");
const redeemed = await jsonPost("/api/access/redeem", { key: issued.payload.access_key.key }, secondCookie);
if (redeemed.response.status !== 200 || redeemed.payload.user?.access_tier !== "full") throw new Error("Preview user could not redeem assigned key");
const wrong = await jsonPost("/api/auth/login", { username: "ci_tester", password: "wrong-password" });
if (wrong.response.status !== 401) throw new Error("Wrong password was accepted");
const login = await jsonPost("/api/auth/login", { username: "ci_tester", password: "temporary-test-password-123" });
if (login.response.status !== 200) throw new Error("Valid login failed");
const protectedApi = await fetch(`${baseUrl}/api/study-summary`, { headers: { Cookie: cookie } });
if (protectedApi.status !== 200) throw new Error(`Authenticated API returned ${protectedApi.status}`);
const health = await fetch(`${baseUrl}/api/health`);
if (health.status !== 200) throw new Error("Anonymous health check failed");
console.log(JSON.stringify({ anonymous_redirect: true, admin_registration: true, preview_registration: true, admin_api_isolated: true, user_bound_key: true, wrong_password_blocked: true, login: true, protected_api: true, public_health: true }, null, 2));
