import "@servicenow/sdk/global";
import { BusinessRule } from "@servicenow/sdk/core";
import { generateResults } from "../../server/business-rules/generate-results";

BusinessRule({
  $id: Now.ID["generate-results-br"],
  name: "Generate Sample Results",
  table: "x_2191106_test_age_url_test",
  when: "after",
  action: ["insert"],
  order: 200,
  script: generateResults,
});
