---
name: log-idea
description: Log a hackathon idea into docs/ — backlog (to implement), rejected (dropped, with reason), or decisions (good but fragile, needs explanation). Use when the user says "log this idea", "add to backlog", "that was a bad idea", "remember why we did X", or invokes /log-idea.
---

# Log an idea

1. Classify the idea (ask the user if unclear):
   - **backlog** — something to build later → `docs/backlog.md`
   - **rejected** — tried/considered and dropped → `docs/rejected.md`
   - **decision** — implemented, non-obvious, would break if "cleaned up" → `docs/decisions.md`
2. Use today's date as `YYYY-MM-DD`.
3. Append in the file's format:

   **backlog.md** — add under the best-fitting `##` section:
   ```
   - [ ] **Title** — one-line what/why (added YYYY-MM-DD)
   ```
   When an item ships, change `[ ]` to `[x]` and move it under `## Done`.

   **rejected.md**
   ```
   ## Title (YYYY-MM-DD)
   **Why rejected:** ...
   **Revisit if:** ...   (optional)
   ```

   **decisions.md**
   ```
   ## Title (YYYY-MM-DD)
   **What:** what we do, with file/function names
   **Why:** the reason
   **Breaks if:** the concrete failure if someone changes it (and how to check)
   ```
4. If a rejected idea was in the backlog, remove it from backlog.md.
5. Keep each entry under ~6 lines. Reply with the file and title you added.
