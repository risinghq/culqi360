import type { ContactAssignmentCallOutcome } from "~/contracts/contact-assignments/vocabulary";
import type {
  BranchId,
  ContactAssignmentId,
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

export type CompleteContactAssignmentCallCommand = {
  actorUserId: UserId;
  branchId: BranchId;
  assignmentId: ContactAssignmentId;
  contactId: ContactId;
  outcome: ContactAssignmentCallOutcome;
  notes: string | null;
};
