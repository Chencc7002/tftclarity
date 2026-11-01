# Cross-patch summary fallback — 2026-10-29

## Problem

ReAct could retrieve two explicit historical versions with two registered `patch_facts` calls, but a numerically invalid model comparison entered the single-patch deterministic summary fallback. That fallback selected the first cited patch and omitted the second even though both validated Evidence entries were present.

## Change

The existing `system_patch_summary_fallback` now preserves every distinct, current-turn `patch_facts` Evidence entry cited by the rejected finish. Multiple patches are ordered by their first explicit appearance in the user request. The fallback deterministically reports each patch's numeric totals, revision count, update date, reviewed groups, revision summaries and official source. For exactly two patches it also computes the numeric-record delta plus shared and version-only group labels with set operations.

The existing single-patch output remains unchanged. Historical Conversation Bridge Evidence remains ineligible. The fallback still activates only for the existing patch-summary request and recoverable numeric-grounding errors.

## Boundary

This is an Evidence-backed ReAct fallback projection, not a new Tool, planner, runtime, Skill, data source, permission, budget or causal analysis path. It compares official numeric patch facts only and explicitly avoids claims about composition performance or causality.
