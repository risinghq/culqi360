// The structure of one workspace: branches, teams, roles and members. The
// store is the workspace, so no table names a workspace.
export const WORKSPACE_CORE: readonly string[] = [
  // One row. `modules` holds WorkspaceModule names.
  `create table workspace_settings (
    id integer primary key not null check (id = 1),
    modules json not null default '[]'
  )`,

  `create table branches (
    id uuid primary key not null,
    name text not null,
    created_at timestamptz not null
  )`,

  `create table teams (
    id uuid primary key not null,
    branch_id uuid not null references branches(id),
    name text not null,
    created_at timestamptz not null
  )`,
  `create index idx_teams_branch on teams (branch_id)`,

  // `kind` is one of the structural roles in rbac.ts; `permissions` is what
  // the workspace's admin granted.
  `create table workspace_roles (
    id uuid primary key not null,
    key text not null unique,
    name text not null,
    kind text not null,
    permissions json not null default '[]',
    locked boolean not null default 0,
    created_at timestamptz not null,
    unique (id, kind)
  )`,

  // The roles a role's holders may assign. The admin and superuser kinds
  // assign every role but superuser without rows here.
  `create table workspace_role_assignables (
    role_id uuid not null references workspace_roles(id) on delete cascade,
    assignable_role_id uuid not null references workspace_roles(id) on delete cascade,
    primary key (role_id, assignable_role_id)
  ) without rowid`,

  // A platform account's place in this workspace. The name and avatar are a
  // copy of the account's, refreshed in every workspace the account belongs
  // to when it changes, so lists and joins read them without a trip to the
  // platform store. Removing someone deletes the platform membership and
  // keeps this row inactive, so the records they worked still name them.
  `create table members (
    user_id uuid primary key not null,
    branch_id uuid not null references branches(id),
    team_id uuid references teams(id),
    role_id uuid not null,
    role text not null,
    executive_category text,
    is_active boolean not null default 1,
    expires_at timestamptz,
    expiry_notified_at timestamptz,
    onboarding_completed_at timestamptz,
    username text not null,
    email text not null,
    names text not null,
    first_surname text not null,
    second_surname text not null,
    avatar_storage_key text,
    avatar_version integer not null default 0,
    created_at timestamptz not null,
    -- role copies the role's kind for code that reads structure from it; the
    -- key keeps the copy equal to the role's kind.
    foreign key (role_id, role) references workspace_roles(id, kind)
  )`,
  `create index idx_members_branch on members (branch_id)`,
  `create index idx_members_team on members (team_id)`,

  // A signed-in member's session. It lives with the member it acts as, so a
  // request resolves its session and its member in one store. The id is the
  // hash of the cookie token, which names this workspace in clear.
  `create table user_sessions (
    id text primary key not null,
    user_id uuid not null references members(user_id),
    session_class text not null
      check (session_class in ('pre_auth', 'recovery_setup', 'app')),
    primary_auth_method text not null
      check (primary_auth_method in ('password', 'google', 'passkey')),
    strong_auth_method text
      check (strong_auth_method in ('totp', 'passkey', 'federated', 'recovery')),
    strong_auth_at timestamptz,
    impersonator_user_id uuid,
    ip_address text not null,
    user_agent text,
    created_at timestamptz not null,
    last_activity timestamptz not null,
    expires_at timestamptz not null
  )`,
  `create index idx_user_sessions_user_activity on user_sessions (user_id, last_activity)`,
  `create index idx_user_sessions_expires_at on user_sessions (expires_at)`,

  `create table branch_supervisors (
    id uuid primary key not null,
    branch_id uuid not null references branches(id),
    user_id uuid not null references members(user_id),
    created_at timestamptz not null,
    unique (branch_id, user_id)
  )`,

  `create table back_office_teams (
    id uuid primary key not null,
    back_office_user_id uuid not null references members(user_id),
    team_id uuid not null references teams(id),
    assigned_at timestamptz not null,
    unique (back_office_user_id, team_id)
  )`,
];
