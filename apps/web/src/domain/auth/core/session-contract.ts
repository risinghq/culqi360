const SESSION_CLASSES = ["pre_auth", "recovery_setup", "app"] as const;
const PRIMARY_AUTH_METHODS = ["password", "google", "passkey"] as const;
const STRONG_AUTH_METHODS = [
  "totp",
  "passkey",
  "federated",
  "recovery",
] as const;

export type SessionClass = (typeof SESSION_CLASSES)[number];
export type PrimaryAuthMethod = (typeof PRIMARY_AUTH_METHODS)[number];
export type StrongAuthMethod = (typeof STRONG_AUTH_METHODS)[number];

export function resolveSessionClass(input: {
  onboardingCompleted: boolean;
  recoveryCodesAcknowledgementRequired: boolean;
}): SessionClass {
  if (!input.onboardingCompleted) {
    return "pre_auth";
  }
  return input.recoveryCodesAcknowledgementRequired ? "recovery_setup" : "app";
}
