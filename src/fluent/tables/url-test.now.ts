import "@servicenow/sdk/global";
import {
  Table,
  UrlColumn,
  StringColumn,
  ChoiceColumn,
  DateTimeColumn,
  MultiLineTextColumn,
} from "@servicenow/sdk/core";

export const x_2191106_test_age_url_test = Table({
  name: "x_2191106_test_age_url_test",
  label: "Accessibility Test",
  display: "name",
  allowWebServiceAccess: true,
  schema: {
    url: UrlColumn({
      label: "URL",
      mandatory: true,
    }),
    name: StringColumn({
      label: "Name",
      maxLength: 200,
    }),
    browser: StringColumn({
      label: "Browser",
      maxLength: 500,
    }),
    wcag_standard: ChoiceColumn({
      label: "WCAG Standard",
      default: "wcag_2_1_aa",
      choices: {
        wcag_2_0_a: "WCAG 2.0 Level A",
        wcag_2_0_aa: "WCAG 2.0 Level AA",
        wcag_2_0_aaa: "WCAG 2.0 Level AAA",
        wcag_2_1_a: "WCAG 2.1 Level A",
        wcag_2_1_aa: "WCAG 2.1 Level AA",
        wcag_2_1_aaa: "WCAG 2.1 Level AAA",
        wcag_2_2_a: "WCAG 2.2 Level A",
        wcag_2_2_aa: "WCAG 2.2 Level AA",
        wcag_2_2_aaa: "WCAG 2.2 Level AAA",
      },
    }),
    status: ChoiceColumn({
      label: "Status",
      default: "pending",
      choices: {
        pending: "Pending",
        in_progress: "In Progress",
        completed: "Completed",
        failed: "Failed",
      },
    }),
    submitted_on: DateTimeColumn({
      label: "Submitted On",
    }),
    notes: MultiLineTextColumn({
      label: "Notes",
    }),
  },
});
