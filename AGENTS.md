# Global AI Agent Rules for The Clubs Repository

## Strict Live SonarQube Compliance (MANDATORY)

You must act as a strict enforcer of SonarQube code quality rules for ALL code you generate or modify.

1. **Unnecessary Assertions:** NEVER write code that contains unnecessary assertions (e.g., "This assertion is unnecessary since it does not change the type of the expression.").
2. **Cognitive Complexity:** NEVER write code that exceeds a Cognitive Complexity of 15. If a function is too complex, break it down before proposing it.
3. **Zero Violations:** NEVER write code that violates ANY rule that SonarQube looks for. 
4. **Live Review & Rewrite:** You must CONSTANTLY REVIEW any line of code you write LIVE. Double-check all newly written code as it is being written. If a Sonar warning or problem is generated from the code you are writing (either through IDE feedback, linter output, or your own awareness of Sonar rules), you **MUST** immediately resolve it before finishing writing the code and handing it back off to the user.
5. **No Technical Debt:** Do not leave SonarQube warnings to be fixed later. They must be prevented at the time of writing.

Before you finish any response containing code, verify internally that the code you are providing adheres to these constraints. If you realize it does not, rewrite it before sending the response.

## Strict Drizzle ORM Usage (MANDATORY)

All database queries in the API (`services/api/`) **MUST** use Drizzle ORM typed queries. Raw SQL via `db.execute(sql\`...\`)` is **PROHIBITED** for new code.

1. **No Raw SQL:** NEVER write new `db.execute()` calls. Use Drizzle's query builder (`db.select()`, `db.insert()`, `db.update()`, `db.delete()`) with the typed schema from `db/schema/schema.ts`.
2. **Type Safety:** NEVER use `as unknown as` to cast raw SQL result rows. Drizzle queries return properly typed results — use them.
3. **Date Handling:** Raw SQL returns timestamps as **strings**, not `Date` objects. Drizzle returns proper `Date` objects from `timestamp` columns. If you encounter existing raw SQL that uses `.getTime()` or date arithmetic on query results, flag it as a migration candidate.
4. **Schema Reference:** Always import table definitions from `db/schema/schema.ts`. The schema defines 68+ tables — use them.
5. **Migration of Existing Code:** When modifying a function that contains raw SQL, migrate the raw SQL to Drizzle ORM as part of the change. Do not propagate raw SQL patterns.

## Enterprise Coding Standards (MANDATORY)

1. **No Unsafe Type Casts:** NEVER use `as any` or `as unknown as T` to bypass TypeScript's type system. If a type is unknown, define a proper interface or use Drizzle's typed queries.
2. **Explicit Date Conversion:** When receiving data from external sources (API responses, raw SQL, JSON parsing), always explicitly convert timestamp strings to `Date` objects using `new Date()` before performing date arithmetic.
3. **Error Boundaries:** All API endpoints must have proper error handling. Never let unhandled `TypeError` or `ReferenceError` propagate as HTTP 500 responses.
4. **Idempotent Operations:** Use `INSERT ... ON CONFLICT` (via Drizzle's `onConflictDoUpdate`) for upsert operations. Never use plain INSERT followed by UPDATE.
5. **Environment Safety:** Never hardcode database names, credentials, or deployment targets. Use environment variables with explicit fallbacks documented in the codebase.

## Skill Invocation (MANDATORY)

1. **Always use superpowers:** You MUST reference and invoke the `using-superpowers` skill (`.agents/skills/using-superpowers/SKILL.md`) at the start of EVERY conversation and before proceeding with ANY task.
2. **Skill Check Before Action:** Even if there is only a 1% chance a skill applies, you MUST invoke the `using-superpowers` skill before taking an action, exploring the codebase, or asking clarifying questions. This is non-negotiable.
3. **Consult Domain Skills:** Before writing any code, check ALL skills in `.agents/skills/` for relevant domain guidance. Skills like `fastify-drizzle-backend-reviewer`, `ai-codefix`, and `better-auth-best-practices` contain project-specific patterns that MUST be followed.

