# Integration plan for the existing BPP site

The modern build is intentionally isolated under `predicts/modern/` during testing.

Recommended rollout sequence:

1. Run and validate `predicts/modern` locally.
2. Compare Burst and Float outputs against the current `predicts/BalloonPredictionMap` for identical inputs.
3. Validate launch-location and airspace Git LFS files are present.
4. Obtain/configure an APRS.fi API key and verify all three callsigns.
5. Test desktop, tablet, and phone widths.
6. Put the Python API behind the BPP Apache development site only.
7. Change `predicts/index.html` to embed/redirect to the modern build only after team sign-off.
8. Keep the legacy map accessible at a temporary `/predicts/legacy/` route during transition.

This protects the currently working program and provides an easy rollback path.
