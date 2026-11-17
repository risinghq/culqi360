import type {
  ActivityOutcomeId,
  BranchId,
  ContactHoldId,
  ContactId,
  UserId,
} from "~/domain/ids";

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
  outcomeId: ActivityOutcomeId;
  notes: string | null;
};
