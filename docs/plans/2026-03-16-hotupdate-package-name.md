# Hotupdate Package Name Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the backend hot-update package name to `com.Kaukei.Game` everywhere the repository defines, tests, scripts, or documents it.

**Architecture:** The package name is sourced from `app/src/lib/paths.js` and then propagated through API responses and publish paths. The implementation updates tests first, then makes the minimal code and script changes needed to satisfy them, and finally aligns README examples.

**Tech Stack:** Node.js 20, built-in `node:test`, Fastify, shell scripts, Markdown docs

---

### Task 1: Update Backend Tests To The New Package Name

**Files:**
- Modify: `app/test/server.test.js`

**Step 1: Write the failing test**

- Add assertions that API responses return `PackageName === "com.Kaukei.Game"`.
- Replace old publish-path expectations with `com.Kaukei.Game`.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL where the backend still returns or writes the legacy package name.

**Step 3: Write minimal implementation**

- Update the package-name source in `app/src/lib/paths.js`.

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add app/test/server.test.js app/src/lib/paths.js
git commit -m "fix: align backend hotupdate package name"
```

### Task 2: Align Scripts And Docs

**Files:**
- Modify: `scripts/publish-sync.sh`
- Modify: `README.md`

**Step 1: Write the failing check**

- Search for remaining legacy-package-name references.

**Step 2: Run check to verify it fails**

Run: `rg -n "com\\.smartdog\\.bbqgame" README.md scripts app/src app/test`
Expected: FAIL with remaining hits.

**Step 3: Write minimal implementation**

- Replace the remaining hardcoded script and README paths with `com.Kaukei.Game`.

**Step 4: Run check to verify it passes**

Run: `rg -n "com\\.smartdog\\.bbqgame" README.md scripts app/src app/test`
Expected: no output

**Step 5: Commit**

```bash
git add scripts/publish-sync.sh README.md
git commit -m "docs: update hotupdate package name references"
```
