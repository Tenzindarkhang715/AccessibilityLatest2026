import "@servicenow/sdk/global";
import { ApplicationMenu, Record } from "@servicenow/sdk/core";

const applicationMenu = ApplicationMenu({
  $id: Now.ID["test-agent-menu"],
  title: "Test Agent",
  hint: "Web Accessibility Tool",
  description: "Test accessibility of websites",
  roles: ["x_2191106_test_age.user"],
  active: true,
});

Record({
  $id: Now.ID["test-agent-module-list"],
  table: "sys_app_module",
  data: {
    title: "Accessibility Tests",
    application: applicationMenu,
    link_type: "LIST",
    name: "x_2191106_test_age_url_test",
    active: true,
    order: 100,
  },
});

Record({
  $id: Now.ID["test-agent-module-page"],
  table: "sys_app_module",
  data: {
    title: "Submit URL",
    application: applicationMenu,
    link_type: "DIRECT",
    query: "x_2191106_test_age_accessibility.do",
    active: true,
    order: 200,
  },
});
