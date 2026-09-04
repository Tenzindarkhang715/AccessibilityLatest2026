import "@servicenow/sdk/global";
import {
  Table,
  ReferenceColumn,
  StringColumn,
  ChoiceColumn,
  UrlColumn,
} from "@servicenow/sdk/core";

export const x_2191106_test_age_test_result = Table({
  name: "x_2191106_test_age_test_result",
  label: "Test Result",
  display: "issue",
  allowWebServiceAccess: true,
  schema: {
    test: ReferenceColumn({
      label: "Test",
      referenceTable: "x_2191106_test_age_url_test",
      mandatory: true,
      cascadeRule: "cascade",
    }),
    test_url: StringColumn({
      label: "Test URL",
      maxLength: 500,
    }),
    test_type: ChoiceColumn({
      label: "Type of Test",
      choices: {
        site: "Full Site Scan",
        page: "Single Page Test",
      },
    }),
    issue: StringColumn({
      label: "Issue",
      maxLength: 500,
    }),
    issue_type: ChoiceColumn({
      label: "Type of Issue",
      choices: {
        error: "Error",
        warning: "Warning",
        notice: "Notice",
        contrast: "Contrast",
        aria: "ARIA",
        structure: "Structure",
        navigation: "Navigation",
      },
    }),
    fix_reference: UrlColumn({
      label: "How to Fix Reference",
    }),
    severity: ChoiceColumn({
      label: "Severity",
      choices: {
        critical: "Critical",
        serious: "Serious",
        moderate: "Moderate",
        minor: "Minor",
      },
      default: "moderate",
    }),
    screenshot: UrlColumn({
      label: "Screenshot",
    }),
  },
});
