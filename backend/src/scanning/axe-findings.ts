import type { AxeBuilder } from "@axe-core/playwright";
import type { FindingDraft } from "../scanner.js";

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

/** One draft per actual axe violation node. Incomplete checks are not violations.
 * Native axe categories/impact are retained; frontend taxonomy mapping is deferred.
 * HTML is untrusted evidence, never executable markup.
 */
export function mapAxeFindings(results: AxeResults, pageUrl: string): FindingDraft[] {
  return results.violations.flatMap(rule => rule.nodes.map(node => ({
    pageUrl, issue: rule.help, issueType: rule.tags.find(tag => tag.startsWith("cat.")) ?? "uncategorized",
    severity: node.impact ?? rule.impact ?? null, fixReference: rule.helpUrl,
    screenshotId: null, ruleId: rule.id, target: structuredClone(node.target),
    html: node.html, failureSummary: node.failureSummary ?? null, tags: [...rule.tags],
  })));
}
