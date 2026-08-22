export interface PasswordChecklist {
  lengthOk: boolean;
  strong: boolean;
}

export const PASSWORD_RULE_LABELS: ReadonlyArray<{
  key: keyof Omit<PasswordChecklist, "strong">;
  label: string;
}> = [
  { key: "lengthOk", label: "长度至少 8 位字符" },
];

export function checkMasterPassword(password: string): PasswordChecklist {
  const p = password ?? "";
  const lengthOk = Array.from(p).length >= 8;
  const strong = lengthOk;
  return { lengthOk, strong };
}

export function validateMasterPassword(password: string): string | null {
  const c = checkMasterPassword(password);
  if (!c.lengthOk) return "主密码至少 8 位字符。";
  return null;
}

export function validateMasterPasswordWithMessage(
  password: string,
  tooShortMessage: string,
): string | null {
  const c = checkMasterPassword(password);
  if (!c.lengthOk) return tooShortMessage;
  return null;
}
