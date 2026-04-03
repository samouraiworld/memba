.PHONY: help proto-gen backend-run backend-build backend-test frontend-dev frontend-build frontend-lint lint test docker-build clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Proto
proto-gen: ## Generate protobuf code (Go + TypeScript)
	npx -y @bufbuild/buf generate

proto-lint: ## Lint protobuf definitions
	npx -y @bufbuild/buf lint

# Backend
backend-run: ## Run backend dev server
	cd backend && go run ./cmd/memba

backend-build: ## Build backend binary
	cd backend && go build -o memba ./cmd/memba

backend-test: ## Run backend tests
	cd backend && go test ./...

backend-lint: ## Lint backend code
	cd backend && golangci-lint run ./...

# Frontend
frontend-dev: ## Run frontend dev server
	cd frontend && npm run dev

frontend-build: ## Build frontend for production
	cd frontend && npm run build

frontend-test: ## Run frontend unit tests
	cd frontend && npm test

frontend-lint: ## Lint frontend code
	cd frontend && npm run lint

# Combined
lint: proto-lint backend-lint frontend-lint ## Run all linters

test: backend-test frontend-test ## Run all tests

# Docker
docker-build: ## Build backend Docker image
	docker build -t memba-backend ./backend

clean: ## Clean build artifacts
	rm -rf backend/memba backend/gen frontend/dist frontend/src/gen
