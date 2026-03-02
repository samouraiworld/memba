# Contributing to Memba

Thank you for your interest in contributing to Memba! This guide will help you get started.

## 🔧 Development Setup

### Prerequisites

- **Go** ≥ 1.25
- **Node.js** ≥ 20
- **Buf CLI** (for protobuf generation)
- **Adena** browser extension (for wallet interaction)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/samouraiworld/memba.git
cd memba

# Backend
cp backend/.env.example backend/.env
cd backend && go run ./cmd/memba

# Frontend (new terminal)
cd frontend && npm install && npm run dev

# Proto generation (if modifying .proto files)
make proto-gen
```

### Environment Variables

See [`.env.example`](.env.example) for all required environment variables. Never commit real secrets.

## 📐 Coding Standards

### Go (Backend)

- Follow the [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments)
- Use `slog` for structured logging
- All SQL queries must be parameterized (no string concatenation)
- Sanitize all user inputs server-side
- Use `connect.NewError()` for gRPC errors — never expose internal details

### TypeScript / React (Frontend)

- TypeScript strict mode — no `any` types
- Kodera design system classes (`k-card`, `k-btn-primary`, etc.) for all UI
- All env vars via `lib/config.ts` — never access `import.meta.env` directly in components
- Lazy-load pages for code splitting
- Use `ErrorToast` component for user-facing errors

### Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(frontend): add DAO treasury view
fix(backend): prevent duplicate signatures
docs: update API reference
chore: bump Go dependencies
```

## 🔀 Pull Request Workflow

1. **Fork** the repository
2. **Create a feature branch** from `main`: `git checkout -b feat/my-feature`
3. **Make your changes** — keep commits focused and atomic
4. **Run the local CI checklist** before pushing:
   ```bash
   # Backend
   cd backend && go build ./... && go test -race -count=1 ./...
   
   # Frontend
   cd frontend && npm run build && npm run lint
   
   # Proto
   make proto-lint
   ```
5. **Push** and open a Pull Request against `main`
6. **Fill in the PR template** — describe your changes and check the checklist
7. **Wait for CI** — all status checks must pass before merge
8. PRs are merged via **squash merge**

## 🐛 Reporting Bugs

Use the [Bug Report](https://github.com/samouraiworld/memba/issues/new?template=bug_report.md) issue template.

## 💡 Requesting Features

Use the [Feature Request](https://github.com/samouraiworld/memba/issues/new?template=feature_request.md) issue template.

## 🔒 Security Vulnerabilities

**Do not open a public issue.** See [SECURITY.md](SECURITY.md) for responsible disclosure.

## 📜 License

By contributing, you agree that your contributions will be licensed under the same license as the project.
