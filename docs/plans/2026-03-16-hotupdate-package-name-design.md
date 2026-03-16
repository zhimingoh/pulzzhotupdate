# Hotupdate Package Name Design

**Goal:** Replace the legacy hot-update package name with `com.Kaukei.Game` across the backend code, scripts, tests, and documentation so the backend matches the Unity client and COS upload tooling.

**Architecture:** Keep `app/src/lib/paths.js` as the backend's single source of truth for the default hot-update package name. Update downstream consumers that either read `CONSTANTS.packageName` or hardcode the old package name in paths, tests, and operator docs.

**Scope**
- Update the backend default package name constant.
- Update publish helper scripts that still hardcode the old package path.
- Update tests to assert the new package name and new publish paths.
- Update README examples so operator instructions match runtime behavior.

**Non-Goals**
- No compatibility layer for the legacy package name.
- No new environment-variable abstraction for package name.
- No changes to Unity project package identifiers.

**Validation**
- Run the backend test suite with `npm test` in `app/`.
- Confirm no repository files still reference the legacy package name.
