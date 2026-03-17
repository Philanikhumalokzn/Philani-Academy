# Handwritten Normalization Engine

## Goal

Build a handwritten math normalization engine that preserves user ink while improving structural consistency.

This engine is intentionally:

- non-recognition
- non-LaTeX
- rule-based
- graph-first

It should infer structural roles such as baseline, superscript, subscript, numerator, denominator, and fraction bar without deciding whether a stroke group means `x`, `2`, `+`, or any other symbol identity.

## Research framing

The implementation is grounded in established areas rather than ad hoc UI behavior:

- online handwriting processing
- stroke segmentation
- 2D mathematical layout analysis
- graph-based parsing
- structure-aware ink rendering

The important architectural decision is:

1. capture raw strokes
2. group strokes into candidate symbol-like units
3. build a scored spatial layout graph
4. infer structural roles from graph patterns
5. normalize the original ink using those roles

This follows the principle:

graph first -> structure second -> normalization last

## Current implementation

### UI surface

An admin-only footer action opens the normalization lab from the dashboard.

The lab currently provides:

- freehand stroke capture
- sample loading for superscript, nested exponent chains, fractions, fraction-with-exponent cases, horizontal-line subscript cases, parenthesized local structures, and mixed parenthesized operator-bound layouts including a parenthesized fraction with an outer exponent
- deterministic ambiguous adjacency fixture for `x2` vs `x²` style cases
- raw stroke view
- grouped stroke boxes
- scored relation overlays
- inferred role inspection
- ambiguity inspection
- structural warning inspection for unsupported same-context layouts
- local subexpression ownership inspection
- enclosure structure inspection
- expression context inspection
- parse-forest node and rooted context inspection
- normalized ink preview

### Engine modules

- `lib/handwritingNormalization/types.ts`
- `lib/handwritingNormalization/geometry.ts`
- `lib/handwritingNormalization/grouping.ts`
- `lib/handwritingNormalization/graph.ts`
- `lib/handwritingNormalization/roleTaxonomy.ts`
- `lib/handwritingNormalization/roles.ts`
- `lib/handwritingNormalization/normalize.ts`
- `lib/handwritingNormalization/parser.ts`
- `lib/handwritingNormalization/fixtures.ts`
- `lib/handwritingNormalization/index.ts`

### First-pass heuristics

#### Grouping

The first pass groups strokes using conservative geometric and temporal cues:

- centroid distance
- bounding box proximity
- coarse overlap
- temporal closeness

This is intentionally simple and should be treated as an inspection baseline, not a final segmentation strategy.

#### Layout graph

The graph stores scored pairwise relations, including:

- horizontal sequence
- superscript candidate
- subscript candidate
- stacked above
- stacked below
- inside
- overlap

The graph preserves ambiguity by scoring multiple candidate relations instead of collapsing immediately into a single tree.

The current lab now also surfaces close role decisions explicitly so ambiguous layouts can be inspected rather than silently forced.

#### Structural roles

The first pass currently infers:

- baseline
- unsupported symbol
- superscript
- subscript
- numerator
- denominator
- fraction bar
- enclosure open boundary
- enclosure close boundary

These roles are no longer treated as a flat label set only. Each assigned role now carries taxonomy metadata including:

- role family
- vertical zone
- anchor preference
- shape expectation
- operator kind
- operand reference mode
- operand requirements and allowed operand roles
- allowed child roles
- forbidden child roles
- peer roles on the same structural rank
- locality bias for local, adjacent, and distant associations
- structural barrier flags
- ancestry chain
- discriminating evidence strings collected during inference
- container ids when a role sits inside a local enclosure

This makes the roles array more useful for disambiguation, because related roles can share family-level behavior while still enforcing hard local distinctions.

Examples:

- `superscript` and `subscript` are both script-family roles, but `superscript` prefers above-right while `subscript` prefers below-right
- `superscript` and `subscript` are also operator-like roles: they require a parent-style operand reference and only attach to allowed base-like roles
- `numerator` and `denominator` are both fraction-member roles, but one must sit above and the other below a fraction bar
- `fractionBar` is in the fraction-structure family, behaves like a binary layout operator, requires a horizontal line-like shape, and expects numerator and denominator operands rather than a parent-style operand
- `enclosureOpen` and `enclosureClose` are boundary roles in the enclosure-structure family, act as structural barriers, and do not host scripts or fraction members directly

The taxonomy now also encodes negative information explicitly:

- if a role does not list a child role as allowed, that absence becomes a fast discriminator during inference
- if a role explicitly forbids a child role, that incompatibility is used immediately instead of waiting for later ambiguity cleanup
- if a role is operator-like and the available operand role is not allowed, that mismatch becomes a quick discriminator before normalization
- sibling and peer-role metadata makes it easier to reason about same-rank structures such as numerator vs denominator or open vs close enclosure boundaries

Fraction bars are currently approximated using flat wide groups. This is useful for testing, but it is still heuristic and should be validated against a broader handwritten sample set.

Role inference now has an explicit local ownership layer before broader structure claiming:

- strong superscript and subscript attachments are collected first
- those attachments are assembled into local subexpression trees
- fraction claiming operates on subexpression roots instead of stealing individual nested children
- a root can become a numerator or denominator while its children remain local superscripts or subscripts

This matters for cases such as chained exponents and fractions with nested scripts:

- in `2^2^2`, the middle `2` can remain a superscript relative to the left root while still acting as the parent of the rightmost superscript locally
- in a fraction numerator with an exponent, the numerator root can be claimed by the fraction bar without flattening the exponent into a separate numerator group

The current fraction-family disambiguation is now explicitly size-aware and span-aware:

- a bar candidate must be line-like
- it must have a reasonably centered local span above it to be recognized as a fraction bar at all
- it only claims numerator and denominator members when there is compatible centered support on both sides
- a lower-right horizontal line can still become a `subscript` when it behaves like a script attachment instead of a centered fraction structure

The same taxonomy idea now extends into enclosure-style local structures:

- tall narrow boundary groups can form a local enclosure pair around one or more owned subexpressions
- the enclosed content keeps its own internal local ownership, such as superscripts and subscripts
- enclosure boundaries are treated as structural barriers rather than expression roots
- enclosed roles keep container ids so the engine can preserve both local role identity and enclosing context at the same time

Mixed operator-bound layouts are now handled one step further:

- an outer script next to an enclosure boundary can be redirected to the enclosed semantic root instead of attaching to the boundary itself
- an enclosed local expression can serve as a fraction numerator while preserving its own internal script ownership
- this allows locality to survive across barriers instead of losing the inner structure when a larger construct is added

This pushes the engine closer to locality-first parsing:

- local attachments inside a structure should be stronger than distant associations across that structure
- a fraction bar creates a strong divide, so local associations above it are evaluated as a coherent span before broader associations
- enclosure boundaries similarly create a local region that should be resolved internally before external interpretation is allowed to dominate
- when a structural barrier is encountered, ownership can be redirected to the local semantic root behind that barrier instead of treating the barrier glyph as the parent

The engine now also treats baseline more carefully at the local-context level:

- `baseline` is intended to mean membership in the primary horizontal row of a local expression context
- two plain baseline-like groups stacked vertically in the same local context are not silently treated as a legal row
- when that unsupported situation appears, the conflicting group is preserved as ink but demoted to an `unsupported symbol` role and surfaced as a structural warning instead of being deleted or force-merged
- this keeps the raw ink intact while making the violation visible for later context-tree work

Line-like groups that look structurally like fraction bars but do not satisfy the supported fraction constraints are also preserved instead of defaulting to baseline automatically.

The same admissibility idea now applies to local scripts as well:

- two superscript siblings stacked in the same local context around the same parent are not both allowed to remain `superscript`
- two subscript siblings stacked in the same local context around the same parent are not both allowed to remain `subscript`
- true nesting is still allowed when the upper or lower script becomes the parent of another script locally
- when sibling script rows conflict, spatial closeness to the shared parent is treated as the strongest locality signal and size comparability is used only as a secondary tie-breaker
- a demoted conflicting script is preserved as ink and surfaced as an `unsupported symbol` warning rather than deleted

The engine now also exposes first-class expression contexts instead of leaving broader-scope bases implicit:

- a root context represents the current top-level algebraic row
- an enclosure context represents a local expression span such as `(x^2)` with its own semantic root and anchor groups
- fraction-member contexts represent numerator and denominator spans as local expression regions
- roles can now carry an association context id and explicit normalization anchor group ids
- this means a script outside an enclosure can attach to the enclosed expression span as a broader-scope base instead of collapsing onto the inner glyph alone
- the normalization layer now consumes those explicit anchors rather than reconstructing broader scope heuristically

The engine now also emits a lightweight parse forest on top of those contexts instead of exposing each context as only an unordered bag of groups:

- every stroke group can appear as a `group` parse node
- trusted local operator families can create higher-order parse nodes such as `scriptApplication`, `enclosureExpression`, and `fractionExpression`
- each expression context now gets an ordered `sequenceExpression` root that collects the top-level parse nodes in left-to-right order
- each parse root explicitly points at that rooted sequence node, which makes the default algebraic flow of a context visible in the lab and available to later parser work

This is still intentionally modest:

- the parse forest is currently built from already-inferred roles and contexts rather than replacing them
- it now composes trusted local operators across layers, so an enclosure context can root a fraction expression that then serves as the local base for an outer script
- it provides an explicit structural bridge from graph roles into expression parsing without pretending that the engine already has a full GLR or chart parser

#### Normalization

The first pass normalizes by applying role-aware transforms to original strokes:

- baseline alignment for baseline groups
- reduced scale for superscripts and subscripts
- centered placement above and below fraction bars
- parent-relative placement for nested roles

The output is still raw ink. No symbol replacement occurs.

## Known limitations

The current version is a lab scaffold, not a production parser.

Known limitations:

- grouping is still the highest-risk stage
- ambiguity is reported, but final role assignment is still heuristic
- fraction detection is now more explicit than before, but still only covers a narrow family of handwritten fraction layouts
- local ownership now covers script nesting, enclosure boundaries, and first-pass mixed barrier redirection, but not full multi-operator local parsing yet
- same-context stacked baseline and same-parent stacked script admissibility exist, and the engine now exposes first-pass expression contexts, rooted sequence parse nodes, and explicit normalization anchors, but a full recursive context-tree with general operator precedence and ambiguity-preserving parsing is not implemented yet
- no radical handling yet
- no explicit baseline-line estimation across full expressions yet
- fixture coverage is still small even though it now includes chained superscripts, numerator-with-exponent cases, horizontal-line subscript disambiguation, parenthesized local structures, and mixed parenthesized layouts
- no persistent save/load format yet for lab sessions

## Review gates

Before adding more complexity, review the engine in this order:

1. inspect whether grouping boundaries are reasonable
2. inspect whether graph scores reflect geometry rather than wishful interpretation
3. inspect whether role inference is stable on ambiguous expressions
4. inspect whether normalization improves layout without damaging stroke identity

## Next recommended work

1. Extend operator-bound local parsing beyond parentheses into radicals and other enclosure families.
2. Improve full-expression baseline estimation so local roots can be placed relative to broader context more reliably.
3. Add deterministic fixtures for deeper mixed nested structures such as `(a/b)^2`, nested parenthesized fractions, and radical-like layouts.
4. Let the parse forest start driving more structure resolution so rooted context sequences are not only a debug reflection of role inference.
5. Generalize structural barriers so BODMAS-style local precedence can be expressed across more operator families.
6. Add visual toggles for confidence thresholds to make failure cases easier to inspect.