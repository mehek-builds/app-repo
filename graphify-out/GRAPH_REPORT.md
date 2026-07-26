# Graph Report - .  (2026-07-26)

## Corpus Check
- 98 files · ~143,393 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 510 nodes · 908 edges · 28 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `fillGenericApplication()` - 25 edges
2. `request()` - 13 edges
3. `fillGreenhouseApplication()` - 13 edges
4. `fillAshbyApplication()` - 11 edges
5. `resolveSalary()` - 10 edges
6. `fillLinkedInApplication()` - 9 edges
7. `languageAnswerPlan()` - 9 edges
8. `driveAsyncLocationCombobox()` - 9 edges
9. `findStatedRanges()` - 8 edges
10. `waitForStableDom()` - 8 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (5): normalizeContact(), statusFromTier(), handleUrlChange(), parseJobUrl(), slugToName()

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (37): candidateInputs(), classifyField(), clean(), controlIdentity(), dateSkipReason(), declaredLanguages(), desiredAnswer(), eeoAnswer() (+29 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (28): abandonTypedQuery(), closeOpenCombobox(), comboControl(), declaresPhoneAutocomplete(), documentSlotReason(), driveAsyncLocationCombobox(), fileInputLabelText(), fillField() (+20 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (11): ap(), runFill(), baseForm(), baseFormFields(), classicItiPhone(), coreFields(), geminiField(), markReactManaged() (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (8): classifySubmissionOutcome(), pageShowsSubmissionConfirmation(), pageSubmissionFailureMessage(), resumeGenerationProgress(), resumeGenerationStatus(), hasVisibleUnresolvedCaptcha(), responseTokens(), waitForVisibleCaptchaResolution()

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (20): answerChoiceBlock(), blockAlreadyAnsweredForGrade(), buttonOptionsIn(), checkRadio(), comboControlIn(), extractDescriptionHtmlFromSource(), fetchAshbyJdFromApi(), fetchAshbyJdFromPage() (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (21): answerChoiceBlock(), blockAlreadyAnsweredForGrade(), comboControlIn(), fillCombobox(), fillGreenhouseApplication(), fillResumeFile(), findPhoneCountryControl(), firstMatch() (+13 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (19): collectCurrencies(), currencyPrefixAt(), dedupeRanges(), detectCurrency(), findStatedRanges(), groupDigits(), isProseSalary(), mapCurrencyToken() (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (10): fetchAshbyPostingCompensation(), generateResumeAndProfile(), harvestFields(), pollSecureApplicationSubmit(), requestSecureApplicationSubmit(), resolveAndDraft(), responseError(), secureSubmissionResult() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (14): gradeQuestion(), isFourPointScale(), ap(), at(), ukBand(), answerChoiceBlock(), blockAlreadyAnsweredForGrade(), comboControlIn() (+6 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (13): answerChoiceBlock(), blockAlreadyAnsweredForGrade(), checkRadio(), comboControlIn(), fillCombobox(), fillLinkedInApplication(), fillResumeFile(), getModal() (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.17
Nodes (14): createSession(), generateDraft(), generateResume(), getApplicationProfile(), getEvents(), getProductMeta(), getProfile(), putApplicationProfile() (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.19
Nodes (17): answerChoiceBlock(), blockAlreadyAnsweredForGrade(), comboControlIn(), fillCombobox(), fillResumeFile(), fillWorkdayApplication(), findApplyManuallyButton(), hasAccountCreationMarkers() (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.2
Nodes (12): chromeStorageGetCompat(), chromeStorageRemove(), chromeStorageSet(), clearAll(), clearToken(), getPortalAccounts(), getProfile(), getToken() (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.18
Nodes (11): collect(), escapeId(), handleInput(), isOurNode(), keyFor(), readControlValue(), readIdentity(), readQuestion() (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.23
Nodes (10): dateOrderCandidates(), detectDateOrder(), formatDate(), isDateControl(), isRealDate(), pad(), parseStoredDate(), input() (+2 more)

### Community 16 - "Community 16"
Cohesion: 0.36
Nodes (4): cssEscape(), extractValidationErrors(), label(), nearestFieldEntryLabel()

### Community 17 - "Community 17"
Cohesion: 0.53
Nodes (3): honeypotInput(), stubRect(), textInput()

### Community 18 - "Community 18"
Cohesion: 0.6
Nodes (3): isoOnlyPicker(), monthFirstPicker(), pickerThatAccepts()

### Community 19 - "Community 19"
Cohesion: 0.5
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 20`** (2 nodes): `storage.test.ts`, `lastError()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `persistent-badge.ts`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `tailwind.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `globals.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `AutofillSetupScreen.captcha.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `auto-submit-runtime.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `captcha-background-runtime.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Community 6` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._