# tftclarity — Riot Production Application Package

> Copy-ready English material for the Riot Developer Portal  
> Product: **tftclarity**  
> Public website: <https://tftclarity.cn/>  
> Privacy Policy: <https://tftclarity.cn/privacy>  
> Terms of Service: <https://tftclarity.cn/terms>  
> Last reviewed: August 13, 2026

## 1. Short product description

tftclarity is a public, non-commercial Teamfight Tactics analytics, match-review, and learning tool for Chinese-speaking players. It lets users ask natural-language questions using Chinese champion, item, trait, and composition names—including common nicknames—and turns those questions into deterministic structured queries. Users can also submit a PBE or NA Riot ID to inspect available recent matches and final boards, or organize selected players into small Player Pools for descriptive analysis and comparison.

The product displays aggregated composition and champion-item statistics, recent-match evidence, Player Pool sample statistics, multiple candidate choices, and explicit low-sample or stale-data warnings. Optional AI features explain validated evidence but cannot create, replace, or modify the underlying statistics.

tftclarity is intended for pre-game reference, post-game learning, and long-term patch understanding. It does not read the current game state, provide dynamic real-time instructions, scout opponents, identify hidden players, or create an unofficial MMR/ELO system.

## 2. Full product description

Chinese-speaking TFT players often need to translate an informal question into official names, filters, and several pages of statistical tables before they can reach a useful conclusion. tftclarity shortens that path.

A user can ask questions such as:

- “What is the most stable three-item build for Xayah?”
- “Compare Infinity Edge and Guardbreaker on this champion.”
- “Show the current popular compositions.”
- “Which composition is trending upward this patch?”
- “Keep the same composition and rank filter, but compare another item.”

tftclarity resolves the named entities and aliases, applies transparent filters, queries aggregated TFT data, calculates or validates metrics locally, and returns a concise result with alternatives. Results include the actual scope used, source freshness, sample count, average placement, Top 4 rate, win rate, and warnings where evidence is weak.

The core ranking and filtering path is deterministic. An LLM may be used for controlled natural-language parsing or to write a short explanation from a validated evidence package. LLM output is checked against the structured result and cannot change the numerical evidence.

The current working product uses third-party MetaTFT data, OP.GG-backed player lookup, and official/public static TFT sources. Production API access will be used to replace third-party player and match retrieval where Riot-supported routes are available, build first-party aggregates from Riot match and league data, and implement Riot Sign On where Riot requires account authorization.

## 3. Player value and differentiation

- Chinese natural-language support, including community nicknames and historical aliases.
- A direct path from a question to a scoped statistical answer.
- Multiple choices instead of a single prescribed action.
- Visible samples, filters, data source, freshness, and risk warnings.
- Deterministic statistics with optional evidence-grounded AI explanation.
- Follow-up questions that preserve short-lived anonymous context.
- Recent-match and final-board review from a Riot ID supplied by the visitor.
- User-selected Player Pools with visible coverage, sample gates, share-code copying, and descriptive comparison.
- A focused learning workflow rather than a live-game automation or scouting tool.

## 4. Intended users

The primary audience is Chinese-speaking Teamfight Tactics players who want to:

- prepare before a game;
- learn from previous games;
- understand patch-level metagame trends;
- compare champion item choices;
- explore popular compositions without learning API names or English terminology.
- review available recent matches and final boards;
- organize a small, explicitly selected player sample and compare observed composition preferences.

The product is public and can be used without a tftclarity account. It does not currently use Riot Sign On. A visitor may enter a Riot ID for themselves or another player; entering an ID does not prove account ownership. We are requesting Riot's review of this existing flow and RSO access for any flow Riot requires to be account-authorized.

## 5. Reviewer user flow

### Flow A — Champion item recommendation

1. Open <https://tftclarity.cn/>.
2. Enter a champion build question in Chinese, for example: `霞当前版本最稳的三件装备是什么？`
3. tftclarity identifies the champion and query intent.
4. The server applies the visible rank, patch, sample, item-scope, and time-window filters.
5. The result panel shows the leading complete build and alternatives.
6. Each result displays sample size, average placement, Top 4 rate, win rate, source freshness, and risk warnings.
7. The user can change a filter or ask a follow-up question.

**Player value:** converts an informal Chinese question into a transparent, evidence-backed static reference.

### Flow B — Item comparison

1. Start from a champion build result or enter a direct comparison question.
2. Ask to compare two items for the same champion and context.
3. The product preserves the champion, patch, rank, and composition context.
4. It separates mutually exclusive complete-build samples and reports overlap.
5. If the evidence is too close or the sample is too small, the product explicitly declines to name a winner.

**Player value:** explains the trade-off without hiding uncertainty or dictating a mandatory choice.

### Flow C — Composition rankings and trends

1. Ask for the current composition rankings or choose the composition-ranking entry.
2. The product shows aggregated composition performance and popularity for the selected scope.
3. The user can inspect a composition and move to a champion-item query.
4. A trend view, where available, compares patch snapshots and labels insufficient history instead of inventing a trend.

**Player value:** supports patch learning and preparation using aggregate, non-player-specific statistics.

### Flow D — Multi-turn refinement

1. Run any supported query.
2. Ask a follow-up such as “keep the same composition but only show Master and above” or “compare another item.”
3. The product reuses short-lived anonymous context and shows which conditions came from the current input, conversation, user preference, or system default.
4. The user can clear the conversation at any time.

**Player value:** makes complex filtering accessible while keeping the applied scope visible.

### Flow E — Legal and data transparency

1. The product footer remains visible and states that tftclarity is independent and not endorsed by Riot Games.
2. Privacy Policy and Terms of Service are linked from the footer and settings panel.
3. The settings panel contains the complete Riot disclaimer and links to Riot developer policy.
4. Results identify the current data source and display freshness or cache warnings.

### Flow F — Riot ID match review

1. Open **Match history, Pools & review → Match visualization and review**.
2. Enter a PBE or NA Riot game name and tag line.
3. The backend resolves the requested player through the configured provider and returns up to 10–20 available recent matches.
4. The user can expand a match to inspect placement, final units, items, traits, augments, and other provider-supported facts.
5. Optional AI review receives only the structured evidence already retrieved and must not invent round-by-round economy, shop, positioning, or decision history that the provider did not return.

**Player value:** supports post-game reflection using visible evidence rather than live-game prescriptions.

### Flow G — Player Pools and comparison

1. A visitor creates up to two Pools, each containing 1–15 Riot IDs, or copies a Pool member list with an eight-character share code.
2. Each Pool displays match coverage, patch distribution, composition usage, average placement, Top 4 rate, win rate, and representative final boards for the selected sample.
3. Two Pools can be compared only when the season, patch, player coverage, and match-count gates permit it.
4. When the gates are not met, the product displays observations side by side and prohibits a stronger/weaker conclusion.

**Player value:** lets a study group or analyst examine a bounded, user-selected sample without presenting it as server-wide strength, causation, or an unofficial rating.

## 6. Data sources: current and planned

### Current working product

- Third-party aggregated MetaTFT statistics for composition and champion-item result demonstrations.
- Third-party MetaTFT player-match retrieval for the current PBE recent-match flow.
- OP.GG-backed player resolution and match retrieval for the current NA recent-match flow.
- A server-side normalized fact store for Riot IDs, match summaries, final boards, Pool membership, coverage, and descriptive Pool statistics.
- Official or public TFT static catalogs and assets for names, item details, and icons.
- Local deterministic calculation, filtering, normalization, and validation.
- Optional OpenAI-compatible provider for controlled parsing or evidence-grounded explanation.

### Planned use of Riot data

- `tft-league-v1`: discover a permitted seed set of high-ranked players in supported regions.
- `tft-match-v1`: retrieve match IDs and match details for offline aggregation.
- `account-v1` and the applicable TFT account/profile endpoint: resolve submitted Riot IDs and support account-linked flows using the routes Riot approves for this product.
- Riot Sign On: authenticate a player and restrict personal-history features to the authorized account if required by Riot's review.
- Data Dragon/static TFT data: maintain versioned champion, item, trait, queue, and asset catalogs.

The current third-party recent-match flows are limited to **PBE and NA**. The planned Riot-backed first phase is **NA1** plus supported Asian platforms such as **TW2, SG2, JP1, and KR**, subject to the endpoints, routing values, RSO scope, and launch regions Riot approves. The product will not claim coverage of mainland China servers because the public Riot Developer API does not provide a mainland China platform route.

## 7. Planned Riot aggregation architecture

```text
Riot API
→ submitted or RSO-authorized Riot account identity
→ permitted personal match-history retrieval
→ permitted high-ranked player seeds
→ match ID collection
→ match detail collection
→ rate limiting, retry, and deduplication
→ raw match storage
→ versioned champion/item/trait normalization
→ composition classification
→ aggregate statistics
→ validation and shadow comparison
→ tftclarity query service
```

The Riot API key will be stored only in server-side environment variables or secret management. It will never be embedded in browser code, committed to the repository, or distributed in a client binary. The collector will respect application, method, and service limits and will honor `Retry-After` responses.

## 8. Game-integrity and policy boundaries

tftclarity:

- provides static aggregate information and post-game match facts that are independent of the current live game state;
- is designed for pre-game preparation, post-game learning, and patch analysis;
- presents multiple choices and preserves player decision-making;
- does not inspect the League/TFT client or a live board;
- does not change recommendations based on current in-game actions;
- does not provide “do this now” instructions;
- does not scout opponents or predict their next actions;
- does not identify or analyze deliberately hidden players;
- does not create an unofficial MMR or ELO;
- does not support gambling or betting;
- currently supports visitor-submitted Riot ID lookup and user-selected Player Pools through third-party providers;
- does not treat a Riot ID submission as proof of account ownership;
- requests Riot's review and RSO access so personal-history features can be restricted to the authenticated account wherever required;
- will change, restrict, or remove non-owner player-history and Pool flows if Riot determines they are outside the approved use case.

The product does not use player history for opponent scouting during a game, hidden-player identification, unofficial MMR/ELO, employment, credit, gambling, or other consequential profiling. Player Pools are bounded descriptive samples and are not server-wide rankings.

## 9. AI use and safeguards

AI is optional and limited to:

1. mapping informal Chinese text to a controlled query schema; and
2. summarizing an evidence package that already contains the validated result.

The ranking, filtering, metrics, and eligibility rules are deterministic. AI output cannot modify sample counts or performance metrics. Generated explanations are validated against the evidence; if validation or the provider fails, the product uses a deterministic template fallback and labels the result accordingly.

## 10. Privacy and security summary

- No product account is required.
- Match-review and Player Pool features accept a Riot game name, tag line, and region. They process available player and recent-match facts.
- PUUIDs returned by the current NA provider are stored only in encrypted form when a server-side encryption key is configured; otherwise they are not persisted.
- Pool names, member Riot IDs, selected environment, ownership scope, optional share codes, and normalized match facts are stored server-side. A share code allows its recipient to copy the current member list into an independent Pool.
- A signed anonymous `tft_visitor` cookie separates visitor scope and enforces public quotas.
- Query snapshots are retained for up to 30 days for feedback integrity, quality investigation, and security.
- Structured records used for follow-up conversation context are retained for no longer than 7 days.
- Optional feedback stores only the relevant query and normalized result context.
- HTTPS, HTTP-only cookies, scoped identifiers, rate limits, server-side secrets, and access controls protect the service.
- Privacy requests are handled at `tftclarity@outlook.com`.

See the public [Privacy Policy](https://tftclarity.cn/privacy) and [Terms of Service](https://tftclarity.cn/terms).

## 11. Riot relationship and intellectual property notice

tftclarity is an independent, non-commercial fan project and is not affiliated with, sponsored by, or endorsed by Riot Games.

> tftclarity isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## 12. Copy-ready short answers for portal fields

### What does your product do?

tftclarity is a public TFT analytics, match-review, and learning tool for Chinese-speaking players. It converts Chinese natural-language questions and community nicknames into deterministic queries for composition and champion-item statistics. Visitors can also submit a PBE or NA Riot ID to inspect available recent matches and final boards, and organize selected players into small Player Pools with coverage and low-sample gates. Optional AI explains validated evidence but cannot create or modify the facts or statistics.

### How will you use the Riot API?

We will use `tft-league-v1` for permitted ranked seeds, `tft-match-v1` for match IDs and match details, `account-v1` and the applicable TFT account/profile route for Riot ID resolution, and Data Dragon/static TFT data for versioned catalogs and assets. We also request RSO review for personal match-history access. The server-side pipeline will rate-limit, retry, deduplicate, normalize, classify, and aggregate match data. We will restrict personal-history flows to the authenticated account if Riot requires that boundary.

### What is your current data source?

The current working product uses third-party MetaTFT aggregate and PBE player-match data, OP.GG-backed NA player lookup and matches, and official/public static TFT sources. It stores normalized match facts for recent-match review and user-selected Player Pools. Production API access will be used to migrate supported account, match, league, and aggregate flows to Riot services. Riot approval will not be treated as authorization to use an unrelated third-party dataset.

### Does the product use real-time game data?

No. tftclarity does not read the current game state, inspect a live board, track opponents, or change recommendations based on in-game actions. It provides static aggregate references for pre-game preparation, post-game learning, and patch understanding.

### Does the product require RSO?

We request RSO review and access. The current product accepts a visitor-supplied Riot ID and displays available recent matches; it does not yet authenticate account ownership. We understand Riot's TFT policy identifies self-player statistics and personal match-history training tools as RSO use cases. We are prepared to restrict personal-history features to the authenticated account and to change or remove non-owner history and Pool flows if Riot requires that boundary. Please advise which current flows may remain public and which must be RSO-authorized.

### How is the API key protected?

The Production API key will be stored only in server-side environment variables or secret management and accessed by the backend collector over HTTPS. It will not appear in browser code, source control, logs, or distributed binaries. The collector will enforce Riot rate limits, honor `Retry-After`, and redact secrets from errors and operational endpoints.

## 13. Review asset captions

Use these captions below the screenshots uploaded to the application:

1. **Public product and legal visibility** — “The public tftclarity interface. The persistent footer identifies the project as independent and links to the Privacy Policy and Terms of Service.”
2. **Champion item recommendation** — “A Chinese natural-language champion query converted into a scoped result with complete builds, alternatives, samples, performance metrics, data source, and risk warnings.”
3. **Evidence-aware item comparison** — “A two-item comparison using mutually exclusive complete-build samples. The product declines to name a winner when the difference or evidence is insufficient.”
4. **Aggregate composition rankings** — “Non-player-specific composition aggregates for the selected patch, rank, and time window.”
5. **Patch trend view** — “Patch-level aggregate trend information. Missing or insufficient history is labeled rather than inferred.”
6. **Multi-turn refinement** — “A follow-up query that preserves short-lived context and shows the source of each applied condition.”
7. **Legal and data transparency** — “The settings panel shows the full Riot disclaimer, policy links, runtime/data status, and public legal pages.”
8. **Riot ID recent-match review** — “A visitor-supplied PBE or NA Riot ID resolved into available recent matches, expandable final-board evidence, and a post-game review boundary that does not invent unavailable round history.”
9. **Player Pool dashboard and comparison** — “A bounded user-selected player sample with coverage, patch, match-count, composition usage, performance metrics, share-code behavior, and explicit descriptive-only gates.”

## 14. Reviewer test script

1. Visit <https://tftclarity.cn/>.
2. Confirm the independent-project notice and the Privacy/Terms links are visible.
3. Submit `霞当前版本最稳的三件装备是什么？`.
4. Inspect the leading build, alternatives, samples, performance metrics, source, and warnings.
5. Submit a follow-up item comparison while keeping the same champion context.
6. Submit `当前版本热门阵容排行`.
7. Open Settings and inspect the Riot disclaimer and legal links.
8. Open **Match history, Pools & review**, enter a test PBE or NA Riot ID supplied in the review notes, and inspect an expandable recent match.
9. Open the prepared review Pool, inspect its coverage and sample warnings, and—if two compatible Pools are prepared—open the comparison.
10. Visit <https://tftclarity.cn/privacy> and <https://tftclarity.cn/terms>.

The user interface is primarily Chinese because the target audience is Chinese-speaking TFT players. This document and the attached captions explain each reviewer step in English.
