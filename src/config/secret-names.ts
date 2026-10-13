// Variable names that usually hold something private. Only a hint: the user's own marks always win.
const secretName = /SECRET|TOKEN|PASS|KEY|CREDENTIAL|PRIVATE|AUTH|COOKIE|SESSION/i;

export function looksSecret(variableName: string): boolean {
  return secretName.test(variableName);
}
