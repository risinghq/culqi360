import type { ContactHoldCallOutcome } from "~/contracts/contacts/vocabulary";
import type { BranchId, ContactHoldId, ContactId, UserId } from "~/domain/ids";

export interface AssignContactsCommand {
  actorUserId: UserId;
  branchId: BranchId;
}

export interface AssignContactsResult {
  requested: number;
  assigned: number;
}

export type CompleteContactHoldCallCommand = {
  actorUserId: UserId;
  branchId: BranchId;
  holdId: ContactHoldId;
  contactId: ContactId;
  outcome: ContactHoldCallOutcome;
  notes: string | null;
};
