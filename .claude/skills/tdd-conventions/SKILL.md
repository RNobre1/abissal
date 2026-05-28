---
name: tdd-conventions
description: Testing conventions, test pyramid, and TDD workflow rules. Covers unit, integration, E2E, contract, regression, performance, and security tests. Read the project's CLAUDE.md for stack-specific test configuration.
---

> **Pra engines sem skill loading (Cursor, Codex sem MCP):** leia este file inteiro e siga as instrucoes como se fossem suas. Voce nao precisa "invocar" — apenas obedeca. Cursor e Codex que tem `xp-stack` instalado via npm leem este SKILL.md em `.cursor/rules/` ou `.codex/skills/`.

# TDD Conventions

## Test Pyramid (Bottom to Top)

1. **Unit Tests** — Test functions, methods, and classes in isolation. Must be fast, deterministic, and free of external dependencies (use mocks/stubs). High coverage expected for all business logic.

2. **Integration Tests** — Validate interaction between modules, services, real databases (or containers), queues, and internal APIs. Must run against real or containerized dependencies (not just mocks).

3. **End-to-End (E2E) Tests** — Simulate complete user flows from input to final response. Cover critical paths (happy path and main error scenarios).

4. **Contract Tests** — When services communicate (microservices, external APIs), validate that contracts (schemas, request/response formats) are respected by both parties. Use recorded fixtures (VCR pattern) to catch API format changes before they hit production.

5. **Regression Tests** — Every fixed bug must generate a test that reproduces the failure scenario BEFORE the fix, ensuring the defect doesn't return.

6. **Performance/Load Tests** (when applicable) — For critical endpoints or high-volume operations, include basic benchmarks or load tests.

7. **Security Tests (SAST/DAST)** — Static analysis of code vulnerabilities (SAST) and dynamic tests against the running application (DAST).

## Mandatory TDD Flow

1. **RED** — Write the test first. It must fail for the right reason (missing implementation, not syntax error).
2. **GREEN** — Write the minimum production code to make the test pass.
3. **REFACTOR** — With tests passing, clean up. Tests must still pass after refactoring.

## CI/CD Integration

All test types above must be integrated into the CI/CD pipeline:
- Execute linters and formatters as a mandatory gate
- Run unit and integration tests on every push/PR
- Run E2E tests on merges to protected branches (main/develop)
- Execute security analysis (SAST) automatically
- Block merge if any test fails or coverage drops below the defined threshold

## Universal Patterns

- **Input validation before config check:** Validate user input (return 400) before checking if external services are configured (return 500). This prevents masking user errors with infrastructure errors.
- **Centralized mocks:** Keep shared mocks in a dedicated directory. Use factories instead of copying mocks.
- **External APIs always mocked** in unit/integration tests. Use VCR/contract tests to validate real formats.
- **Zero tech debt tolerance:** Resolve alerts, warnings, and small problems immediately. Don't let them accumulate.
- **Centralized configs:** Constants scattered across components must be centralized. Adding a new option should require editing only ONE file.
