# v2.0-α Foundation — Milestone Brief

> **Read `SESSION_CONVENTIONS.md` before starting this milestone.**

## Scope

| Feature | Branch | Priority |
|---------|--------|----------|
| Plugin architecture skeleton | `feat/v2.0-alpha/plugin-architecture` | 🟢 |
| Deployment Pipeline component | `feat/v2.0-alpha/deployment-pipeline` | 🟢 |
| Add Member proposal | `feat/v2.0-alpha/member-proposals` | 🟢 |
| Remove Member proposal | (same branch) | 🟢 |
| Assign Role proposal | (same branch) | 🟢 |

## Acceptance Criteria

- [x] `frontend/src/plugins/` directory with manifest schema, lazy loader, types
- [x] DAOHome shows "Plugins" tab listing installed extensions from ABCI query
- [x] `<DeploymentPipeline>` renders animated steps for CreateDAO, CreateMultisig, CreateToken
- [x] Deploy completion modal shows TX hash, realm path, explorer link
- [x] ProposeAddMember form: address input + role selector → `DoContract` MsgCall
- [~] ProposeRemoveMember form: on-chain function exists, admin direct action available (UI form deferred)
- [~] ProposeAssignRole form: on-chain function exists, admin direct action available (UI form deferred)
- [x] `daoTemplate.ts` generates helper functions: `ProposeAddMember`, `ProposeRemoveMember`, `ProposeAssignRole`
- [x] All unit tests pass (261/261, 12 files)
- [x] E2E tests updated for v2 behavior (Add Member enabled)
- [x] All docs updated (CHANGELOG, ROADMAP)
- [x] 11-perspective cross-audit documented in AUDIT_CHECKLIST.md

## Key Technical Details

### Adena DoContract for MsgCall (proposals)
```typescript
window.adena.DoContract({
    messages: [{
        type: "/vm.m_call",
        value: {
            caller: adena.address,
            send: "",
            pkg_path: "gno.land/r/user/mydao",
            func: "ProposeAddMember",
            args: ["g1newmember...", "admin,member"],
        }
    }],
    gasFee: 1000000,
    gasWanted: 10000000,
})
```

### Generated helper functions (daoTemplate.ts)
```go
func ProposeAddMember(cur realm, addr address, roles string) {
    rs := strings.Split(roles, ",")
    localDAO.Propose(daokit.ProposalRequest{
        Title:  ufmt.Sprintf("Add member %s with roles %s", addr, roles),
        Action: basedao.NewAddMemberAction(&basedao.ActionAddMember{Address: addr, Roles: rs}),
    })
}
```

### Plugin manifest
```typescript
interface PluginManifest {
    id: string; name: string; icon: string;
    route: string; extensionPath: string;
    component: () => Promise<{ default: React.ComponentType }>;
}
```

## Estimated Effort
~14 development days

## Dependencies
- gnodaokit v1 (current) — `basedao.NewAddMemberAction`, `NewRemoveMemberAction`, `NewAssignRoleAction`
- Adena `DoContract` API (confirmed working on CreateDAO.tsx:214)
