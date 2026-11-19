// Accounts, members and invites store emails in this form, so equality
// checks across the stores compare like with like.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
