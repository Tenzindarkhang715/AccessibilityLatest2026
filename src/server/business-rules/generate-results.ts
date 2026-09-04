import { gs, GlideRecord } from "@servicenow/glide";

interface Finding {
  issue: string;
  issue_type: string;
  severity: string;
  fix_reference: string;
  screenshot: string;
}

const SAMPLE_FINDINGS: Finding[] = [
  {
    issue: "Images missing alt text",
    issue_type: "aria",
    severity: "critical",
    fix_reference: "https://www.w3.org/WAI/tutorials/images/",
    screenshot: "https://www.w3.org/WAI/tutorials/images/img-alt-decision-tree.png",
  },
  {
    issue: "Low color contrast ratio (2.5:1)",
    issue_type: "contrast",
    severity: "serious",
    fix_reference:
      "https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html",
    screenshot: "https://www.w3.org/WAI/WCAG21/Techniques/img/contrast-fail-example.png",
  },
  {
    issue: "Missing document language",
    issue_type: "structure",
    severity: "serious",
    fix_reference: "https://www.w3.org/WAI/WCAG21/Techniques/html/H57",
    screenshot: "https://www.w3.org/WAI/WCAG21/Techniques/img/language-attribute-example.png",
  },
  {
    issue: "Links missing descriptive text",
    issue_type: "navigation",
    severity: "moderate",
    fix_reference:
      "https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context.html",
    screenshot: "https://www.w3.org/WAI/WCAG21/Techniques/img/link-text-example.png",
  },
  {
    issue: "Form inputs without labels",
    issue_type: "aria",
    severity: "critical",
    fix_reference: "https://www.w3.org/WAI/tutorials/forms/labels/",
    screenshot: "https://www.w3.org/WAI/tutorials/forms/img/form-labels-example.png",
  },
  {
    issue: "Missing skip navigation link",
    issue_type: "navigation",
    severity: "minor",
    fix_reference:
      "https://www.w3.org/WAI/WCAG21/Techniques/general/G1",
    screenshot: "https://www.w3.org/WAI/WCAG21/Techniques/img/skip-nav-example.png",
  },
  {
    issue: "Heading levels not sequential",
    issue_type: "structure",
    severity: "moderate",
    fix_reference:
      "https://www.w3.org/WAI/tutorials/page-structure/headings/",
    screenshot: "https://www.w3.org/WAI/tutorials/page-structure/img/headings-structure.png",
  },
];

export function generateResults(current: any, previous: any): void {
  const testSysId: string = current.getUniqueValue();
  const testUrl: string = current.getValue("url") || "";
  const notes: string = current.getValue("notes") || "";

  // Determine test type from notes field
  const testType: string =
    notes.indexOf("Full website") !== -1 ? "site" : "page";

  // Update the parent test record status to "completed"
  const testGr = new GlideRecord("x_2191106_test_age_url_test");
  if (testGr.get(testSysId)) {
    testGr.setValue("status", "completed");
    testGr.update();
  }

  // Randomly select 5-8 findings
  const count: number = 5 + Math.floor(Math.random() * 4); // 5 to 8
  const shuffled: Finding[] = SAMPLE_FINDINGS.slice();

  // Simple Fisher-Yates shuffle
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  const selected: Finding[] = shuffled.slice(0, Math.min(count, shuffled.length));

  // Create result records
  for (let k = 0; k < selected.length; k++) {
    const finding = selected[k];
    const resultGr = new GlideRecord("x_2191106_test_age_test_result");
    resultGr.initialize();
    resultGr.setValue("test", testSysId);
    resultGr.setValue("test_url", testUrl);
    resultGr.setValue("test_type", testType);
    resultGr.setValue("issue", finding.issue);
    resultGr.setValue("issue_type", finding.issue_type);
    resultGr.setValue("fix_reference", finding.fix_reference);
    resultGr.setValue("severity", finding.severity);
    resultGr.setValue("screenshot", finding.screenshot);
    resultGr.insert();
  }

  gs.info(
    "Generated " + selected.length + " accessibility findings for test: " + testSysId
  );
}
