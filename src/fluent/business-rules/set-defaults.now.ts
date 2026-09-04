import "@servicenow/sdk/global";
import { BusinessRule } from "@servicenow/sdk/core";
import { setDefaults } from "../../server/business-rules/set-defaults";

BusinessRule({
  $id: Now.ID["set-defaults-br"],
  name: "Set Defaults on URL Test",
  table: "x_2191106_test_age_url_test",
  when: "before",
  action: ["insert"],
  order: 100,
  script: setDefaults,
});
