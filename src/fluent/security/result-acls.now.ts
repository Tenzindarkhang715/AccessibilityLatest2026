import "@servicenow/sdk/global";
import { Acl } from "@servicenow/sdk/core";
import { userRole, adminRole } from "../security/roles-and-acls.now";

// READ: requires user role
Acl({
  $id: Now.ID["test-result-read-acl"],
  type: "record",
  table: "x_2191106_test_age_test_result",
  operation: "read",
  roles: [userRole],
  adminOverrides: true,
});

// CREATE: requires user role
Acl({
  $id: Now.ID["test-result-create-acl"],
  type: "record",
  table: "x_2191106_test_age_test_result",
  operation: "create",
  roles: [userRole],
  adminOverrides: true,
});

// WRITE: requires admin role
Acl({
  $id: Now.ID["test-result-write-acl"],
  type: "record",
  table: "x_2191106_test_age_test_result",
  operation: "write",
  roles: [adminRole],
  adminOverrides: true,
});

// DELETE: requires admin role
Acl({
  $id: Now.ID["test-result-delete-acl"],
  type: "record",
  table: "x_2191106_test_age_test_result",
  operation: "delete",
  roles: [adminRole],
  adminOverrides: true,
});
