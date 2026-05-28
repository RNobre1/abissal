---
tipo: pesquisa
titulo: "{{research title in one sentence}}"
status: {{in_progress | completed | archived}}
metodologia_tier: {{L1 | L2 | L3}}
source_diversity: {{number of unique domains consulted, integer >= 5}}
primary_source_ratio: {{0.00 to 1.00, target >= 0.50}}
citation_density: {{0.00 to 1.00, target >= 0.80}}
triangulation_coverage: {{0.00 to 1.00, target >= 0.70}}
latency_min: {{wall-clock time in minutes, integer}}
evidence_grades:
  primary_claim: {{A | B | C | D}}
  secondary_claim: {{A | B | C | D}}
autor: pilot+claude+researcher
criado: {{YYYY-MM-DD}}
relacionado:
  - {{CLAUDE.md, docs/tasks/..., ...}}
tags: [research, {{domain}}]
---

# {{Research title}}

> **How to use this template:** copy this file to `docs/pesquisas/{slug}.md` (slug in kebab-case), fill the frontmatter with real metrics, replace placeholders `{{...}}` with the research content. Don't remove sections — leaving a section empty with "not applicable" and one line explaining why is acceptable; **removing the section is not**.

---

## 1. Context

{{Why this research was done. What motivated it. Which decision depends on it. What's the cost of deciding wrong. Reference ADRs, tasks, incidents, or prior conversations that gave rise to the question. One to three paragraphs.}}

## 2. Central question

{{A single specific sentence. Avoid open questions like "what's the best way to X". Prefer "given context Y, what are the trade-offs between X1 and X2 regarding criteria Z1 and Z2?".}}

## 3. Sub-questions

Orthogonal decomposition of the central question. Each sub-question was assigned a clear search scope.

| # | Sub-question | Search scope |
|---|---|---|
| 3.1 | {{...}} | {{WebSearch "...", arXiv, official docs for X}} |
| 3.2 | {{...}} | {{...}} |
| 3.3 | {{...}} | {{...}} |

## 4. Applied methodology

- **Tier**: {{L1 / L2 / L3}} ({{reason: ...}})
- **Tools**: {{WebSearch, WebFetch, academic MCPs (if any), local code reading in `src/...`}}
- **Subagents**: {{number of parallel researchers run, or "none — single agent" for L1/L2}}
- **Wall-clock time**: {{start HH:MM -> end HH:MM = X min}}
- **Adversarial review**: {{ran by research-critic? yes/no. If yes, iterations: N}}

## 5. Sources consulted

Complete list. `type` classification: **primary** (peer-reviewed paper, official doc, primary dataset, source code) vs **secondary** (blog, listicle, video, third-party summary). `quality` classification: **high** / **medium** / **low**.

| # | URL | Type | Quality | Notes |
|---|---|---|---|---|
| 1 | {{url}} | primary | high | {{what this source contributes}} |
| 2 | {{url}} | secondary | medium | {{...}} |
| ... | ... | ... | ... | ... |

## 6. Synthesis

> **Absolute rule**: every factual assertion below carries inline citation `[N]` pointing to a reference in section 13. "According to studies" is forbidden. If you're writing an assertion without citation, it's opinion or context summary — mark explicitly as such.

### 6.1 Answer to sub-question 3.1

{{Answer with inline citations. Example: "Anthropic reported 90.2% improvement in internal evaluations using Opus lead + Sonnet subagents [1, 2]." Multiple paragraphs when necessary.}}

### 6.2 Answer to sub-question 3.2

{{...}}

### 6.3 Answer to sub-question 3.3

{{...}}

## 7. Triangulated claims

> **Absolute rule**: no critical claim (supporting the decision) can be `[single]`. If it is, mark it as hypothesis, not fact.

| Claim | Confirming sources | Status | Evidence grade |
|---|---|---|---|
| {{precise factual assertion}} | [1], [3], [7] | [triangulated] | A |
| {{...}} | [2], [4] | [partial] — both derive from [2] | C |
| {{...}} | [5] | [single] — marked as hypothesis | D |

**Legend**:
- `[triangulated]` — 2+ independent sources (different domains, ideally different biases) confirm.
- `[partial]` — multiple sources, but all derived from the same primary source.
- `[single]` — only one source. Claim treated as hypothesis in the report.
- **Evidence grade** (adapted from GRADE): **A** = high confidence, multiple convergent primary sources. **B** = moderate, some primary sources. **C** = low, secondary sources or limited sample. **D** = very low, single source or conjecture.

## 8. Alternatives considered

What was evaluated and why it didn't make the final answer or was rejected. Also includes alternatives the `research-critic` suggested.

| Alternative | Why not chosen |
|---|---|
| {{...}} | {{...}} |
| {{...}} | {{...}} |

## 9. Known limitations

{{What this research does NOT cover, where residual bias exists, which claims would be stronger with more time/resources, what depends on future empirical evidence that would only exist with a POC. Be honest. Acknowledged limitations are worth more than faking perfect rigor.}}

## 10. Suggested decision

{{Researcher's concrete recommendation. Not binding for the Pilot — it's a starting point. Short, direct format. Example: "Adopt X for case Y because [summary of triangulated evidence]. Avoid Z because [reason with citation]." Maximum 2 paragraphs.}}

## 11. Follow-ups

Tasks, ADRs, derivative research that should happen after this research.

- [ ] {{ADR to write: ...}}
- [ ] {{Task to open: ...}}
- [ ] {{Derivative research: ...}}
- [ ] {{CLAUDE.md update: ...}}

## 12. Adversarial review log

{{If research-critic ran (tier L2/L3), copy its output here. Structured list of weaknesses with classification (blocking/must-fix/suggestion) and action taken by the researcher on each. If it didn't run (L1), write: "Not applicable — tier L1".}}

### Weaknesses found

| # | Classification | Weakness | Action taken |
|---|---|---|---|
| 1 | blocking | {{...}} | {{fixed in section 6.2, source [8] added}} |
| 2 | must fix | {{...}} | {{...}} |
| 3 | suggestion | {{...}} | {{recorded as limitation in section 9}} |

## 13. References

Numbered list matching the inline `[N]` citations. Format: `[N] Source title — author or domain — URL`.

1. [{{Title}}]({{url}}) — {{author/domain}}. {{1 line summarizing what the source contributes}}
2. [{{Title}}]({{url}}) — {{author/domain}}. {{...}}
3. [{{Title}}]({{url}}) — {{author/domain}}. {{...}}

---

## Version log

| Date | Version | Change | Author |
|---|---|---|---|
| {{YYYY-MM-DD}} | 0.1 | Initial version. | {{author}} |
