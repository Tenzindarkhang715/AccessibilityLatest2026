import { gs, GlideDateTime } from "@servicenow/glide";

const VALID_STATUSES = ["pending", "in_progress", "completed", "failed"];
const VALID_WCAG_STANDARDS = [
  "wcag_2_0_a",
  "wcag_2_0_aa",
  "wcag_2_0_aaa",
  "wcag_2_1_a",
  "wcag_2_1_aa",
  "wcag_2_1_aaa",
  "wcag_2_2_a",
  "wcag_2_2_aa",
  "wcag_2_2_aaa",
];

export function setDefaults(current: any, previous: any): void {
  // Auto-set submitted_on to current date/time
  const now = new GlideDateTime();
  current.setValue("submitted_on", now);

  // Validate status — default to "pending" if invalid
  const status = current.getValue("status");
  if (!status || VALID_STATUSES.indexOf(status) === -1) {
    current.setValue("status", "pending");
  }

  // Validate wcag_standard — default to "wcag_2_1_aa" if invalid
  const wcagStandard = current.getValue("wcag_standard");
  if (!wcagStandard || VALID_WCAG_STANDARDS.indexOf(wcagStandard) === -1) {
    current.setValue("wcag_standard", "wcag_2_1_aa");
  }
}
