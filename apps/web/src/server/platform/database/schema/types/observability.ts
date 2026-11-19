import type { NullableIdColumn, UserId } from "~/domain/ids";

export interface ActionRateLimitCountersTable {
  id: string;
  key_hash: string;
  window_started_at: Date;
  request_count: number;
  updated_at: Date;
}

export interface AuthThrottleCountersTable {
  id: string;
  scope: "ip" | "account" | "ip_account";
  key_hash: string;
  window_started_at: Date;
  failure_count: number;
  blocked_until: Date | null;
  updated_at: Date;
}

export interface AuthEventsTable {
  id: string;
  account_id: NullableIdColumn<UserId>;
  method: "password" | "passkey" | "totp" | "recovery";
  stage: "login" | "challenge" | "verify" | "recovery";
  outcome: "success" | "failure" | "throttled";
  reason: string | null;
  identifier_hash: string;
  ip_hash: string;
  created_at: Date;
}
