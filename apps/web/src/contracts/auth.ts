import type { Permission, Role } from "~/domain/auth/access/rbac";
import type { WorkspaceModule } from "~/domain/auth/access/workspace-modules";
import type {
  PrimaryAuthMethod,
  SessionClass,
  StrongAuthMethod,
} from "~/domain/auth/core/session-contract";
import type { PasskeyLoginFlowState } from "~/domain/auth/passkey/types";

export interface CurrentUserView {
  id: string;
  email: string;
  names: string;
  firstSurname: string;
  secondSurname: string;
  phone: string | null;
  avatarUrl: string | null;
  avatarVersion: number;
  role: Role;
  roleName: string;
  permissions: readonly Permission[];
  modules: readonly WorkspaceModule[];
  sessionClass: SessionClass;
  primaryAuthMethod: PrimaryAuthMethod;
  strongAuthMethod: StrongAuthMethod | null;
  branchId: string;
  impersonating: boolean;
}

export interface AccountSecurityStatus {
  totpEnabled: boolean;
  hasPasskey: boolean;
  recoveryCodes: {
    hasActiveSet: boolean;
    total: number;
    unused: number;
    acknowledged: boolean;
  };
}

export interface OnboardingSnapshot {
  user: {
    email: string;
    names: string;
    firstSurname: string;
    secondSurname: string;
    role: Role;
    phone: string | null;
  };
  passwordChangeRequired: boolean;
  strongAuthRequired: boolean;
  hasPasskey: boolean;
  totpEnabled: boolean;
}

export type PasswordLoginSubmissionResult = {
  nextStep: "passkey";
  flow: PasskeyLoginFlowState;
};

export type PasskeyStartSubmissionResult = {
  flow: PasskeyLoginFlowState;
};

export interface InviteActivationView {
  fullName: string;
  username: string;
  email: string;
  // An account already holds this email: the page asks for its password
  // instead of a new one.
  hasAccount: boolean;
}
