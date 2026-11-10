# Construction IFC/BCF interoperability — verification and live-acceptance readiness

**Date:** 10 November 2026
**Code under test:** `main` @ `80ea4db` (post forecast-calibration merge)
**Tracker item:** `bcf-interop` — *IFC/BCF interoperability with real consultant files and authoring-tool round trip*
**Gate requirement** (`docs/construction-live-validation-2026-11-02.md`): a consultant-issued IFC/BCF revision pair with recorded provenance; element-level clash review; and Propbrew's BCF export opened in the consultant's authoring tool with comments, snapshots and viewpoints retained.

---

## 1. Scope and evidence boundary

This record verifies the exchange implementation against independent public IFC/BCF material and the official buildingSMART XML schemas. It does **not** claim consultant acceptance: no consultant-issued project files or named authoring tool were supplied. The live tracker item should move to **in progress**, not done.

No production code changed. The additions are independent fixtures, deterministic tests, an explicitly enabled evidence generator and this protocol.

## 2. Verified results

| Check | Result |
|---|---|
| Native IFC geometry | The public ThatOpen `web-ifc-example.ifc` parses into metre-space component envelopes and triangle meshes; IFC GlobalIds remain attached. More than 50 geometric elements are read, and every retained mesh has exactly 9 position values per triangle. Fixture SHA-256: `6e06b4ab819e6b60d8077f06e6ccf2dc89b049bdc5b072664d3866875757d6ec`. |
| Independent BCF inputs | All **19** official buildingSMART BCF-XML 3.0 archives are retained unmodified. **18** import through Propbrew's supported topic/comment/viewpoint path. The remaining case is an explicit negative test, explained in §3. |
| Propbrew export → Propbrew import | A generated BCF 3.0 archive retains the topic GUID, status, dated comment and author, viewpoint GUID and XML, IFC component ID, perspective camera/aspect ratio, and exact PNG bytes. Existing tests also verify two successive exports with multiple viewpoints and dated discussion. |
| Official XSD validation | Propbrew's generated `bcf.version`, `project.bcfp`, `markup.bcf` and `.bcfv` viewpoint each pass `xmllint` against the official buildingSMART 3.0 schemas at commit `bc48611d0d7a1587f028a2b69677a1aafd5cd0a8`. |
| Evidence archive | `docs/construction-bcf-interoperability-2026-11-10/propbrew-coordination.bcf`, **1,854 bytes**, SHA-256 `ac486d87e06a1f5fda70db7a16777a56d13cac1ad07bb492f99e35f2d9eb0213`. Extracted files and `manifest.json` are included for review. |
| Regression run | **41 passed, 1 intentionally skipped** in ordinary CI mode across official BCF imports, existing IFC/BCF tests, triangle clash/revision tests and BCF issue rendering. The evidence generator ran separately with its explicit flag: **33 passed** in that run. ESLint passed for both new test files. |

Official fixture provenance and the CC BY-ND 4.0 license are in `tests/fixtures/construction/bcf-v3-official/SOURCE.md` and `LICENSE.txt`. These public fixtures are not customer or consultant project evidence.

## 3. Official negative case — preserved, not hidden

`Visualization/Single invisible wall/single invisible wall.bcf` uses topic folder `e1fff3a6-db0f-48e8-a240-0e2f38b2fc21`, but its markup declares topic GUID `d5121f1c-11e0-4f25-9d23-7ace76853a8f`.

The official BCF-XML documentation, **Topic folder structure inside a BCFzip archive**, says the folder name is the topic GUID. Propbrew rejects the mismatch rather than silently exchanging one identity for another. The test suite retains the unmodified archive and asserts this rejection. Therefore this record says **18 accepted + 1 correctly rejected**, not “19/19 compatible”.

## 4. What the current tests do not certify

- **Consultant-tool acceptance:** XSD validation and parser round trips do not prove that Revit, Navisworks, Solibri, BIMcollab, Bonsai or another named consultant tool restores the view correctly.
- **Full BCF feature coverage:** the supported exchange path focuses on core topics, comments, viewpoints, component selection, cameras and snapshots. It does not claim lossless round trips for every BCF field (for example labels, due dates, document references or related-topic graphs).
- **Engineering clash sign-off:** triangle-surface checks identify intersections and near contacts. A fully enclosed solid can lack touching surfaces and still require volume/engineering review; candidates are not automatic engineering verdicts.
- **Real model provenance and scale:** public fixtures cannot establish a consultant project's units, shared coordinates, revision lineage or authoring-tool export settings.

## 5. Required live acceptance run

1. **Obtain a matched revision set** from the consultant: two IFC revisions and a consultant-issued BCF 3.0 archive tied to the same baseline. Record project, model code, disciplines, revisions, authoring tool and version, export date, units/coordinate convention, original filenames and SHA-256 hashes. Keep originals unchanged.
2. **Import into an authorised non-demo company.** Confirm stored hashes, component counts, model codes/revisions and project/package scope. Compare the IFC revisions and review added, removed and geometry-changed element IDs.
3. **Run and review clashes element by element.** Record each candidate's two IFC GlobalIds, location, intersection/clearance result, reviewer disposition and rationale. Include any enclosed-volume cases the surface method cannot settle.
4. **Export Propbrew's BCF and open it in the consultant's named tool.** Verify topic GUID/status, description, comment text/authors/timestamps, snapshot visibility and bytes, camera position/direction/up/aspect ratio, clipping/visibility data, and selected IFC GlobalIds against the originating model.
5. **Return an updated consultant BCF.** The consultant should add a response and a **new** viewpoint rather than mutating an existing viewpoint. Re-import it into Propbrew and verify the external status/modification dates, new comment and viewpoint, prior-viewpoint immutability, comment revision history and audit events.
6. **Record the decision.** Save both directions' file hashes, tool/version, named reviewer, date, screenshots or tool export, issue dispositions and a signed supported/unsupported conclusion. Only that evidence can close `bcf-interop`.

## 6. Reproduction

Ordinary deterministic regression run (the evidence generator is skipped):

```bash
npx vitest run \
  tests/domain/construction-bcf-official-interop.test.ts \
  tests/workflows/construction-bcf-interoperability-evidence.test.ts \
  tests/domain/construction-bim-intelligence.test.ts \
  tests/workflows/construction-model-mesh.test.ts \
  tests/workflows/construction-model-clashes.test.ts \
  tests/components/construction-bcf-evidence.test.ts
```

Regenerate the synthetic evidence archive explicitly:

```bash
RUN_BCF_INTEROP_EVIDENCE=1 npx vitest run \
  tests/workflows/construction-bcf-interoperability-evidence.test.ts
```

With the official BCF-XML `release_3_0` checkout at `../BCF-XML`, validate the four XML parts using the commands recorded in `docs/construction-bcf-interoperability-2026-11-10/schema-validation.txt`.

**Deployment impact:** none; tests, fixtures and documentation only.
