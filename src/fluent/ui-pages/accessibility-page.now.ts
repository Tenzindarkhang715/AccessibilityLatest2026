import "@servicenow/sdk/global";
import { UiPage } from "@servicenow/sdk/core";
import page from "../../client/index.html";

export const accessibility_page = UiPage({
  $id: Now.ID["accessibility-page"],
  endpoint: "x_2191106_test_age_accessibility.do",
  html: page,
  direct: true,
});
