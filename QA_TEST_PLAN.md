# SingAlong — QA Test Plan

> **Status:** Proposed manual test plan. These are test scenarios to execute, not claims that testing has been completed.

## Objective

Check that the SingAlong demo and full local application behave reliably across core user journeys, browsers, permissions, and error conditions.

## Environments

Record the browser/version, operating system, viewport size, microphone permissions, app mode (hosted demo vs. local full app), and test date for each run.

## Manual test scenarios

| ID | Area | Steps | Expected result | Priority |
| --- | --- | --- | --- | --- |
| QA-01 | Hosted demo | Open the GitHub Pages demo and start playback | Available demo content starts without an unhandled error | High |
| QA-02 | Playback | Pause, resume, and seek to multiple positions | Playback position and timeline remain consistent | High |
| QA-03 | Lyrics | Play through sections with synced lyrics | Current lyric corresponds to playback position, subject to source timing | Medium |
| QA-04 | Recording | Grant microphone access and record a short clip | Recording can start, stop, and be played back | High |
| QA-05 | Permissions | Deny microphone access and attempt recording | Clear error or guidance; no crash | High |
| QA-06 | Audio controls | Adjust original vocal level in a track with separated stems | Audible vocal level changes while instrumental remains available | Medium |
| QA-07 | Unsupported video | Use a YouTube link that cannot be embedded (full app) | User receives meaningful feedback | Medium |
| QA-08 | Invalid input | Enter an invalid or blank video URL (full app) | Input is rejected gracefully | Medium |
| QA-09 | Network failure | Disconnect during a network-dependent operation | Recoverable error; UI does not freeze permanently | High |
| QA-10 | Repeat processing | Process the same supported song twice (full app) | Existing cached data is reused where supported | Low |
| QA-11 | Responsiveness | Check desktop and mobile-sized viewports | Key controls remain readable and usable | Medium |
| QA-12 | Browser compatibility | Repeat playback and recording in Chrome and Firefox | Features behave consistently or differences are documented | Medium |

Some scenarios apply only to the full local app; the hosted GitHub Pages demo uses prepared content and does not include every backend-dependent feature.

## Bug report template

- **ID / Title:**
- **Environment:** Browser, version, OS, app mode
- **Preconditions:**
- **Steps to reproduce:**
  1. 
  2. 
  3. 
- **Expected result:**
- **Actual result:**
- **Frequency:** Always / intermittent
- **Severity:** Critical / major / minor
- **Evidence:** Screenshot, recording, console output (remove secrets)
- **Status:** New / in progress / fixed / retest

## Execution log

When tests are run, track actual results separately (Pass / Fail / Blocked / Not run), dates, and linked GitHub issues. Do not mark these proposed scenarios as passed without executing them.
