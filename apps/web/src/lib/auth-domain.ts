export function validateRegistration(username: unknown, password: unknown) {
  const errors: string[] = [];
  if (typeof username !== "string" || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    errors.push("用户名须为 3–32 位字母、数字、下划线或连字符");
  }
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    errors.push("密码须为 10–128 个字符");
  }
  return errors;
}
