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
- sample loading for superscript, nested exponent chains, fractions, and fraction-with-exponent cases
- deterministic ambiguous adjacency fixture for `x2` vs `x²` style cases
- raw stroke view
- grouped stroke boxes
- scored relation overlays
- inferred role inspection
- ambiguity inspection
- local subexpression ownership inspection
- normalized ink preview

### Engine modules

- `lib/handwritingNormalization/types.ts`
- `lib/handwritingNormalization/geometry.ts`
- `lib/handwritingNormalization/grouping.ts`
- `lib/handwritingNormalization/graph.ts`
- `lib/handwritingNormalization/roles.ts`
- `lib/handwritingNormalization/normalize.ts`

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
- superscript
- subscript
- numerator
- denominator
- fraction bar

Fraction bars are currently approximated using flat wide groups. This is useful for testing, but it is still heuristic and should be validated against a broader handwritten sample set.

Role inference now has an explicit local ownership layer before broader structure claiming:

- strong superscript and subscript attachments are collected first
- those attachments are assembled into local subexpression trees
- fraction claiming operates on subexpression roots instead of stealing individual nested children
- a root can become a numerator or denominator while its children remain local superscripts or subscripts

This matters for cases such as chained exponents and fractions with nested scripts:

- in `2^2^2`, the middle `2` can remain a superscript relative to the left root while still acting as the parent of the rightmost superscript locally
- in a fraction numerator with an exponent, the numerator root can be claimed by the fraction bar without flattening the exponent into a separate numerator group

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
- fraction detection is only a first approximation
- local ownership currently covers script nesting, but not full enclosure-style ownership or multi-root local operators yet
- no enclosure or radical handling yet
- no explicit baseline-line estimation across full expressions yet
- fixture coverage is still small even though it now includes chained superscripts and numerator-with-exponent cases
- no persistent save/load format yet for lab sessions

## Review gates

Before adding more complexity, review the engine in this order:

1. inspect whether grouping boundaries are reasonable
2. inspect whether graph scores reflect geometry rather than wishful interpretation
3. inspect whether role inference is stable on ambiguous expressions
4. inspect whether normalization improves layout without damaging stroke identity

## Next recommended work

1. Expand local ownership beyond script trees into enclosure-like and operator-bound subexpressions.
2. Improve full-expression baseline estimation so local roots can be placed relative to broader context more reliably.
3. Add deterministic fixtures for deeper nested expressions and mixed local structures.
4. Add enclosure and radical-like structure handling.
5. Add visual toggles for confidence thresholds to make failure cases easier to inspect.