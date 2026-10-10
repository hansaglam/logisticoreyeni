# Map V2 — Reference QA checklist

Use for every future Map V2 screenshot, mock, or implementation review.

Screen under review: `MAP-__`

- [ ] Correct reference screen ID (`MAP-01`…`MAP-09`)?
- [ ] Geographic hierarchy correct (world / region / country / city / mode)?
- [ ] Map occupies expected visual priority (not a tiny inset unless spec says so)?
- [ ] No mixed Turkish/English labels in one locale?
- [ ] Layer visual differentiation matches the layer contract?
- [ ] Road / rail / sea / air visually distinct (after glow/shadow stripped)?
- [ ] Locked / unlocked / selected states clear (not color-only)?
- [ ] Selected location obvious?
- [ ] UI panels do not cover critical map content or Back?
- [ ] Safe area respected (status bar, home indicator, tab bar)?
- [ ] AI-generated geography **not** treated as data?
- [ ] No unsupported real-world infrastructure shown as official?
- [ ] Labels readable at the shown zoom?
- [ ] Visual language (navy + cyan/blue chrome) maintained?
- [ ] Performance simplifications still preserve hierarchy?
- [ ] Gameplay city IDs not renamed (`istanbul` etc.)?
- [ ] `referenceFile` is an approved design still, not `assets/maps/*`?
- [ ] Attribution not required on this mock, but production UI plan still exists (Step 1)?

Fail the review if any geographic shape is justified only by a concept PNG.
