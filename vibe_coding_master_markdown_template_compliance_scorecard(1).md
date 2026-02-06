# VIBE CODING – MASTER MARKDOWN TEMPLATE (PRODUCTION-GRADE)

> **Purpose**: This document is a **single, reusable, AI-safe template** designed to achieve **100% VIBE Coding compliance**, enabling **single-pass, production-ready output** with **low token usage**, **no hallucination**, and **auto-generation of code, tests, Swagger, DB migrations, and technical documentation**.

---

## 0. Document Control & Metadata ⭐
**Level of detail required:** High (mandatory, filled every time)

- Document Name
- Module / Plugin Name
- Version
- Compatible Platform / System Version
- Author (Human / AI / Hybrid)
- Creation Date
- Last Updated Date
- Change Log (version → change summary)
- VIBE Compliance Target (e.g., 100%)

---

## 1. Executive Summary
**Level of detail required:** Medium

- Problem statement
- What this module/plugin solves
- Business value
- In-scope items
- Explicit out-of-scope items

---

## 2. Introduction & Goals
**Level of detail required:** Medium

- Background / context
- Goals & objectives
- Success criteria
- Known constraints (tech, legal, time)
- Assumptions (explicitly listed)

---

## 3. AI Coding Rules & Constraints ⭐⭐⭐ (MANDATORY)
**Level of detail required:** Very High

### Code Quality Rules
- No TODO / stub / placeholder code
- No commented or dead code
- No unused imports or variables

### Performance Rules
- Low memory footprint
- CPU-efficient logic
- No nested loops unless unavoidable

### Structure Rules
- Follow defined folder structure only
- No new folders/files unless explicitly allowed

### Dependency Rules
- Use only approved libraries
- Prefer native utilities
- Respect Known Conflicts / Anti-Patterns (Section 5)

### Security Rules
- No hardcoded secrets
- Validate all external inputs

### Testing Rules
- Unit tests required
- Positive and negative flows covered

### Hallucination Guardrail (MANDATORY)
- If any required utility, environment variable, configuration, or dependency is missing from this document, the AI MUST ask for clarification
- The AI MUST NOT invent placeholder values, mocks, or fake infrastructure

### Output Rule
- Code must be production-ready in a single passcurity Rules
- No hardcoded secrets
- Validate all external inputs

### Testing Rules
- Unit tests required
- Positive and negative flows covered

### Output Rule
- Code must be production-ready in a single pass

---

## 4. Developer Mental Model & Code Style ⭐
**Level of detail required:** High

- Architecture pattern (e.g., Clean Architecture, Modular Monolith)
- Programming style (Functional / OOP / Mixed)
- Max file size (e.g., 300 lines per file)
- Naming conventions:
  - Files
  - Classes
  - Variables
- Error handling approach (centralized only)
- Logging strategy (structured / JSON / levels)

---

## 5. Implementation Context (Token-Saving Guardrails) ⭐⭐⭐
**Level of detail required:** Very High (mandatory for every VIBE run)

**Purpose:** Prevent token waste, duplication, and re-inventing existing code.

### 5.1 Shared Utils / Hooks (DO NOT REIMPLEMENT)
Explicitly list existing helpers, hooks, middleware, and base services already available in the codebase.
- Example: useAuth, useTenant, formatCurrency, logger, apiClient

### 5.2 Reference Files (Source of Truth)
Point to specific files that define the expected design, structure, or coding style.
- Example: `src/components/Button.tsx` (follow same patterns)
- Example: `shared/error-handler.js` (reuse error handling approach)

### 5.3 Library Lockdown
Explicitly lock frameworks and versions to avoid deprecated or incompatible code.
- Framework & Version (e.g., Next.js 15 App Router ONLY)
- Backend runtime (Node.js version)
- ORM / DB library versions

### 5.4 Known Conflicts / Anti-Patterns
Explicitly list libraries, patterns, or approaches that MUST NOT be used.
- Example: "Do not use Library X as it conflicts with our Auth wrapper"

### 5.5 Explicit Out-of-Scope
Clearly list what the AI must NOT touch or implement in this task.
Clearly list what the AI must NOT touch or implement in this task.

---

## 6. Modules & Functional Scope
**Level of detail required:** Medium

- Module name
- Responsibilities
- Included features
- Excluded features
- Internal/external dependencies

---

## 7. Actors & Roles
**Level of detail required:** Medium

- Actor name
- Role type (System / Human / External)
- Permissions
- Restrictions
- Access scope (Tenant / Org / Global)

---

## 8. Business Rules ⭐
**Level of detail required:** High

For each rule:
- Rule ID
- Description
- Applies to which module
- Validation condition
- Failure behavior
- Allowed exceptions

---

## 9. Database Schema Definitions ⭐⭐
**Level of detail required:** Very High

- Database engine & version
- Schema name
- Naming convention
- Mandatory columns (id, created_at, updated_at, version, deleted_at)

### Table Definitions
For each table:
- Column name
- Data type
- Constraints
- Indexes
- Relationships (FK)
- Tenant isolation rule

---

## 10. Application Data Models / Entities
**Level of detail required:** High

- Entity name
- Maps to DB table
- Field mapping
- Validation rules
- Serialization rules

---

## 11. State Machine / Lifecycle ⭐⭐
**Level of detail required:** Medium (High for complex flows)

- Initial state
- Allowed transitions
- Forbidden transitions
- Trigger events
- Rollback behavior

### Mandatory for High-Complexity Logic
For complex workflows (e.g., payments, onboarding, approvals), the AI MUST:
- First generate a **State Transition Matrix** (State → Action → Result)
- And/or generate a **Mermaid.js state diagram**

The implementation MUST strictly follow the generated diagram/table.

---

## 12. Functional Requirements
**Level of detail required:** High

For each FR:
- FR ID
- Description
- Actor
- Preconditions
- Postconditions
- Dependencies

---

## 13. Use Cases (Actor → Flow → Outcome)
**Level of detail required:** High

For each use case:
- Use Case ID
- Actor
- Main flow (step-by-step)
- Alternate flow
- Failure flow
- Final outcome

---

## 14. API Definitions ⭐⭐
**Level of detail required:** Very High

- API name
- Endpoint
- HTTP method
- Authentication type
- Rate limiting
- Pagination
- Versioning strategy

---

## 15. API Contracts (Request / Response)
**Level of detail required:** Very High

- Headers
- Request schema (JSON)
- Response schema
- Error responses
- Idempotency rules

---

## 16. Swagger / OpenAPI Generation ⭐⭐
**Level of detail required:** High

- OpenAPI version
- Grouping strategy
- Security schemes
- Reusable schemas
- Example payloads
- Auto-generation instructions

---

## 17. Integrations & 3rd-Party Dependencies ⭐
**Level of detail required:** High

For each integration:
- System name
- Provider
- Direction (Inbound/Outbound)
- Authentication method
- Retry & timeout policy
- Fallback behavior

---

## 18. Infrastructure Definition ⭐⭐⭐
**Level of detail required:** Very High

- Required services (Keycloak, Kong, Redis, PostgreSQL, MQ)
- Resource requirements
- Environment variables
- Secrets management
- Health checks
- Startup order dependencies

---

## 19. Configuration Parameters
**Level of detail required:** Medium

- Parameter name
- Description
- Default value
- Environment-specific override
- Reload behavior

---

## 20. Auto-Upgrade & Versioning Strategy ⭐
**Level of detail required:** High

- Current version
- Backward compatibility rules
- Feature flags
- Deprecation strategy
- Rollback behavior

---

## 21. Database Migration Strategy ⭐⭐
**Level of detail required:** Very High

- Migration tool
- Versioning strategy
- Up & down scripts
- Auto-run on upgrade (Yes/No)
- Failure rollback logic

---

## 22. Email / Notification Templates
**Level of detail required:** Medium

For each template:
- Template name
- Trigger event
- Recipients
- Variables
- Localization support
- Fallback behavior if template fails

---

## 23. Error Codes & Exception Library
**Level of detail required:** High

- Error code
- Message
- HTTP status
- User-friendly message
- Retry allowed (Yes/No)

---

## 24. Edge Cases
**Level of detail required:** Medium

- Scenario
- Expected behavior
- System response
- Logging requirement

---

## 25. Test Cases (Positive / Negative)
**Level of detail required:** High

- Test case ID
- Type
- Input
- Expected output
- Validation rule

---

## 26. Non-Functional Requirements
**Level of detail required:** Medium

- Security
- Availability
- Reliability
- Maintainability
- Observability (logs, metrics, traces)
- Compliance

---

## 27. Performance & Scalability
**Level of detail required:** Medium

- Response time SLA
- Max concurrent users
- Rate limits
- Caching rules
- DB optimization rules
- Load / stress assumptions

---

## 28. Deployment & Environment Notes
**Level of detail required:** Medium

- Environments (Dev/UAT/Prod)
- Deployment steps
- Rollback strategy
- Post-deployment validation

---

## 29. Technical Documentation Auto-Generation ⭐
**Level of detail required:** Medium

- Documents to generate (API, DB, Architecture)
- Output formats (MD/PDF)
- Versioning rules
- Regeneration triggers

---

## 30. Definition of Done (DoD) ⭐⭐⭐
**Level of detail required:** Very High

A task is complete ONLY IF:
- Code is production-ready
- Swagger is generated
- DB migrations exist
- Tests pass (positive & negative)
- No AI rules are violated

---

## 31. AI Self-Verification Checklist ⭐⭐⭐
**Level of detail required:** Mandatory checklist (must be evaluated before final output)

Before completing the task, the AI must confirm:
- [ ] No rule in Section 3 (AI Coding Rules & Constraints) is violated
- [ ] Implementation respects the shared utils and reference files in Section 5
- [ ] DB schema matches Section 9
- [ ] Migration scripts are included as per Section 21
- [ ] Swagger/OpenAPI is generated as per Section 16
- [ ] All error codes are handled as defined in Section 23
- [ ] No console.log, TODO, stub, or placeholder code exists
- [ ] No out-of-scope functionality was implemented

---

## 32. Design Tokens & UI Vibe (Frontend Only) ⭐⭐
**Level of detail required:** High (only for frontend/UI work)

### Style Framework
- Framework (Tailwind / Shadcn / MUI / Custom)

### Design Tokens
- Primary colors
- Secondary colors
- Border radius
- Spacing scale
- Typography scale

### UI State Requirements
- Loading states
- Empty states
- Error states
- Skeleton loaders

---

## 33. Token Optimization & Parsing Hints (Optional)
**Level of detail required:** Optional but recommended

- Use Markdown folding (`<details>` blocks) for large sections
- Use XML-style tags for structured data when possible:
  - `<DatabaseSchema>...</DatabaseSchema>`
  - `<ApiContract>...</ApiContract>`
- Use placeholders (e.g., `{{DB_SCHEMA}}`) for reusable templates

---
