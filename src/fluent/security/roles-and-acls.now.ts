import "@servicenow/sdk/global";
import { Role, Acl } from "@servicenow/sdk/core";

// User role: submit/view tests
export const userRole = Role({
  name: "x_2191106_test_age.user",
  description: "Submit and view accessibility tests",
});

// Admin role: full access, contains user role
export const adminRole = Role({
  name: "x_2191106_test_age.admin",
  description: "Full administrative access to accessibility tests",
  containsRoles: [userRole],
});

// READ: requires user role
Acl({
  $id: Now.ID["url-test-read-acl"],
  type: "record",
  table: "x_2191106_test_age_url_test",
  operation: "read",
  roles: [userRole],
  adminOverrides: true,
});

// CREATE: requires user role
Acl({
  $id: Now.ID["url-test-create-acl"],
  type: "record",
  table: "x_2191106_test_age_url_test",
  operation: "create",
  roles: [userRole],
  adminOverrides: true,
});

// WRITE: requires admin role
Acl({
  $id: Now.ID["url-test-write-acl"],
  type: "record",
  table: "x_2191106_test_age_url_test",
  operation: "write",
  roles: [adminRole],
  adminOverrides: true,
});

// DELETE: requires admin role
Acl({
  $id: Now.ID["url-test-delete-acl"],
  type: "record",
  table: "x_2191106_test_age_url_test",
  operation: "delete",
  roles: [adminRole],
  adminOverrides: true,
});
