# BrowserPilot assessment

Reviewed the [BrowserPilot README](https://github.com/RichardAragon/browserpilot/blob/main/README.md), blob `c67705e9684850cf3b5c97ba544fc6dddd842ef5`, on 2026-10-26. It describes a local Windows browser application for CRM workflows, with evidence checks, recovery journals and reusable platform memory. It explicitly grants no open-source license. SLIM therefore does not copy or package its source or assets.

The useful concepts are observed controls before actions, distinct preparation and submission steps, recording intent before potentially autosaving work, inspecting the original resource after uncertain outcomes, and human-inspectable learned notes. Its Windows-specific Python/Edge runtime is not an appropriate dependency for SLIM's lean Node core. Its reported tests and CRM coverage are upstream claims, not SLIM validation.

## SLIM decisions

The Bash implementation independently applies an operation journal, explicit execution permissions, bounded results and a prohibition on replaying uncertain effects. Command output remains untrusted data and cannot grant permissions. Existing sandbox reconciliation remains authoritative about resources. This is not a BrowserPilot integration or a browser automation capability.

A future browser adapter should remain optional or use an explicitly configured MCP connection. Before implementation, its contract must include:

- An owned browser profile per connection, separate from shell environments and the model vault; no automatic import of personal cookies.
- Observations tied to a tab, URL and generation. A stale element reference requires observation again before action.
- Exact action records and account/resource identity. Opening a form may autosave, so preparation itself can have effects.
- Explicit approval for externally visible submissions where the user has not already authorized the exact action. No approval-by-memory or tool-output instructions.
- Unknown-outcome recovery that inspects the original resource. Creating a second draft is not recovery for a lost first response.
- Project- and connection-scoped learned notes with source, timestamp and user edits. Learned notes advise actions; they never expand access.
- Synthetic fixture coverage for stale controls, navigation, cancellation, lost acknowledgments, duplicate prevention and account changes before any live CRM claims.

No browser runtime, Python package, browser binary or BrowserPilot code is added to the npm core by this change.
