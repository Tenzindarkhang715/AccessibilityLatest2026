import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    '5d99f2369303c310e59ff2a0ed03d6fb': {
                        table: 'sys_scope_privilege'
                        id: '5d99f2369303c310e59ff2a0ed03d6fb'
                    }
                    '6ee5323e93cf8310e59ff2a0ed03d631': {
                        table: 'sys_scope_privilege'
                        id: '6ee5323e93cf8310e59ff2a0ed03d631'
                    }
                    '7ee53e3e93cf8310e59ff2a0ed03d620': {
                        table: 'sys_scope_privilege'
                        id: '7ee53e3e93cf8310e59ff2a0ed03d620'
                    }
                    a19936369303c310e59ff2a0ed03d603: {
                        table: 'sys_scope_privilege'
                        id: 'a19936369303c310e59ff2a0ed03d603'
                    }
                    'app.css': {
                        table: 'sys_ux_theme_asset'
                        id: 'a029433647bf4264adf91b44fec66c08'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: 'b5dae11c15bc492b99e48b8897bb2484'
                    }
                    'generate-results-br': {
                        table: 'sys_script'
                        id: 'c042e69e8df3495683ec5914166da0ce'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: 'eab5901dcc494ec08f41a6d286f18bc3'
                    }
                    'set-defaults-br': {
                        table: 'sys_script'
                        id: '3f573e3956b7454d81e596e9acf8c12f'
                    }
                    'src_server_business-rules_generate-results_ts': {
                        table: 'sys_module'
                        id: 'bc80cdcd6fab422abda7d09ac4e3dd72'
                    }
                    'src_server_business-rules_set-defaults_ts': {
                        table: 'sys_module'
                        id: '22d8c753ac594fd5ad7ad1662d483544'
                    }
                    'test-agent-menu': {
                        table: 'sys_app_application'
                        id: '4c85e8aa30454ef7ad8c54077c7c7349'
                    }
                    'test-agent-module-list': {
                        table: 'sys_app_module'
                        id: 'e766eee2f9cb4b8d8fc5b957d6e88762'
                    }
                    'test-agent-module-page': {
                        table: 'sys_app_module'
                        id: '1bd4c2f45d0a47518d29d4b2c7a5c388'
                    }
                    'test-result-create-acl': {
                        table: 'sys_security_acl'
                        id: '45680e7dde75465fb09f7ac0144f06cf'
                    }
                    'test-result-delete-acl': {
                        table: 'sys_security_acl'
                        id: '31d4d8f8ff6f4bafb126c400826f3b1f'
                    }
                    'test-result-read-acl': {
                        table: 'sys_security_acl'
                        id: 'bf964716e8d1424787adac180bc26ed9'
                    }
                    'test-result-write-acl': {
                        table: 'sys_security_acl'
                        id: 'e20024f004f34588a0938c12ee497e1a'
                    }
                    'url-test-create-acl': {
                        table: 'sys_security_acl'
                        id: 'ec5e0d9db0a34d3580781f6f53143bac'
                    }
                    'url-test-delete-acl': {
                        table: 'sys_security_acl'
                        id: 'e00136a0d6b04620a2f1238e55f347f8'
                    }
                    'url-test-read-acl': {
                        table: 'sys_security_acl'
                        id: '7244e06bc63241d09821739bf3532ea2'
                    }
                    'url-test-write-acl': {
                        table: 'sys_security_acl'
                        id: '35318aae1d794d0d84645523f9148dac'
                    }
                }
                composite: [
                    {
                        table: 'sys_documentation'
                        id: '0757af2cb7644d9f8cd5774d3b1a5d6c'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_ui_page'
                        id: '07777bcc7431437a9967ba4de68ccb06'
                        key: {
                            endpoint: 'x_2191106_test_age_accessibility.do'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '0e55bb31b1e54b54889ed8ced0d3c00f'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'status'
                            value: 'failed'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '0ee0ff4152ae4284ac57ffd4812c1a6a'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'status'
                            value: 'pending'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_user_role_contains'
                        id: '0f5680e539414c11a4dd646874bd8bf5'
                        key: {
                            role: {
                                id: '595290fcfbdd4a0a93c72f38b3f822ce'
                                key: {
                                    name: 'x_2191106_test_age.admin'
                                }
                            }
                            contains: {
                                id: '32c51b9dcd714401b3e53c6cd9cf311d'
                                key: {
                                    name: 'x_2191106_test_age.user'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '112b388bc65f4da1ab61cf38cb0e78be'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_1_a'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '11a9cc4344654c6fba490c0f38667bf9'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'url'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '11b39a29f38847cf9925f4193af92473'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'url'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '13b9b1657d5b4261897b516a65a13598'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'screenshot'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '190423816d7043dc8e112e13af4524a5'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'status'
                            language: 'en'
                        }
                    },
                    {
                        table: 'ua_table_licensing_config'
                        id: '19933cf67dd5470d913523f1bc632684'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '25c310b570d541699af758e11659a288'
                        key: {
                            application_file: '88caec4d3a364dc5b27fa929c22aac25'
                            source_artifact: 'b028497f77d04a019ecf6c98a372416a'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '2694767658b44238b00f1bf84ca720d3'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'fix_reference'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '302a96834eb84af6b415a5b7bd9d4614'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test_type'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '30836af22299414ab1c4c528ae9ebce9'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                            value: 'error'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '310aad82580e43d2b546e17e1139e757'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test_url'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_user_role'
                        id: '32c51b9dcd714401b3e53c6cd9cf311d'
                        key: {
                            name: 'x_2191106_test_age.user'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '34d8876fffd245b98f426ec55f887494'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_2_aaa'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: '37ec0d22f460421797375a2c04f6642a'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test_type'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: '39537c247d6d47a18aba5bef04d7bb35'
                        key: {
                            sys_security_acl: 'bf964716e8d1424787adac180bc26ed9'
                            sys_user_role: {
                                id: '32c51b9dcd714401b3e53c6cd9cf311d'
                                key: {
                                    name: 'x_2191106_test_age.user'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '3de505d26bea4483b1fc9e9d2473de85'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_0_aaa'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '3e0da75059534c1b89e79fd4fdaf6e46'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                            value: 'structure'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '4123f29cb79f4767984517a961154cce'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '41abb0160fe245a3b25a73ea0d690641'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'browser'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '42dce222c3df401181db12b106410dd7'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'NULL'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '4fb0a88201334749b07594726bbfdbdc'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                            value: 'contrast'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '51a9707ba3dd4eb083e4e10a2d8a2993'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_db_object'
                        id: '562f2a21376441268fde690d8735a579'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: '57c29ecf446646a880c66da490ffeb5f'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                        }
                    },
                    {
                        table: 'sys_user_role'
                        id: '595290fcfbdd4a0a93c72f38b3f822ce'
                        key: {
                            name: 'x_2191106_test_age.admin'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '59d73acb7d014a018656b448b544489f'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test_url'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: '5a410e26d0c54e6ea4b6cccce1970f2a'
                        key: {
                            sys_security_acl: 'e00136a0d6b04620a2f1238e55f347f8'
                            sys_user_role: {
                                id: '595290fcfbdd4a0a93c72f38b3f822ce'
                                key: {
                                    name: 'x_2191106_test_age.admin'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '5fb818dbd6bb44a7809dd7166cf95dce'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'severity'
                            value: 'serious'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '601207e7dea8401cbece2108114449ce'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: '62a52924d63c4bf88e13f456d5bbafcf'
                        key: {
                            sys_security_acl: 'ec5e0d9db0a34d3580781f6f53143bac'
                            sys_user_role: {
                                id: '32c51b9dcd714401b3e53c6cd9cf311d'
                                key: {
                                    name: 'x_2191106_test_age.user'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '64e0c3067ed44200bfa9c50131dbafd8'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'notes'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '668e4f3aaf594339b18c3397741da9b6'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'notes'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '66ba882fa93e4e3aaffac05a7e88b2ec'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test_type'
                            value: 'page'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '7034fc29d8ed41feac92423b6a0b9ced'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'NULL'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '72120b59a34848beb3bd2e3517942d67'
                        key: {
                            application_file: '07777bcc7431437a9967ba4de68ccb06'
                            source_artifact: 'b028497f77d04a019ecf6c98a372416a'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: '7572fe4443a145da8a26ce28b5a6f54a'
                        key: {
                            sys_security_acl: '31d4d8f8ff6f4bafb126c400826f3b1f'
                            sys_user_role: {
                                id: '595290fcfbdd4a0a93c72f38b3f822ce'
                                key: {
                                    name: 'x_2191106_test_age.admin'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '77a17029febc49cebbeb4f69adf2864f'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'status'
                            value: 'completed'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '81ed80e1a44b45e4b4af660ad199b8e5'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'screenshot'
                            language: 'en'
                        }
                    },
                    {
                        table: 'ua_table_licensing_config'
                        id: '864d26d66b284a76b089c08c6a1115e9'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: '88caec4d3a364dc5b27fa929c22aac25'
                        key: {
                            name: 'x_2191106_test_age/main.js.map'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '88d7c1b4ad964020b69516a10663c48b'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '8978511445eb411fb09d0ce82632a406'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '8ec45d5c44c64794815d82bad29d69fe'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_2_a'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: '90201eb13bd6483f8b5a56c62cde5506'
                        key: {
                            sys_security_acl: '35318aae1d794d0d84645523f9148dac'
                            sys_user_role: {
                                id: '595290fcfbdd4a0a93c72f38b3f822ce'
                                key: {
                                    name: 'x_2191106_test_age.admin'
                                }
                            }
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '91d46615a2444ab79af669f77689d2bd'
                        key: {
                            application_file: 'ac59ccd664ce4eaa99a3b6526a70e833'
                            source_artifact: 'b028497f77d04a019ecf6c98a372416a'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '94d17b8c9fc941fc8e2f0b4caded20c7'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'submitted_on'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '966c7c84f8e8457391a41cc45ab2d080'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'submitted_on'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '977d6726f6044e4983a364ddf820290e'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'severity'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '9a507b933c064771b9c60832dcf2291b'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                            value: 'warning'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '9b3a921381b949658012db6c5f6b84c9'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_2_aa'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '9c8d0e3419a04cecb615c6ac8c2f6df8'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test_type'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '9d016e305b8446ac9142f0670197ad88'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'browser'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '9f0477029ee94c0181b393e394190247'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'fix_reference'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'a2f62b349f134fedb643dbe4c467e936'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                            value: 'aria'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'a887dfd98ef24764bdba12fc11e629d5'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_0_aa'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: 'ab0ddbf63a5c43388b0cbab43633ae82'
                        key: {
                            sys_security_acl: '45680e7dde75465fb09f7ac0144f06cf'
                            sys_user_role: {
                                id: '32c51b9dcd714401b3e53c6cd9cf311d'
                                key: {
                                    name: 'x_2191106_test_age.user'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: 'ac59ccd664ce4eaa99a3b6526a70e833'
                        key: {
                            name: 'x_2191106_test_age/main'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'ad03721c8e2344deaa7cb22a4294e7ee'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'NULL'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact'
                        id: 'b028497f77d04a019ecf6c98a372416a'
                        key: {
                            name: 'x_2191106_test_age_accessibility.do - BYOUI Files'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: 'bc1a1a1072054c01a211545aa799aae8'
                        key: {
                            sys_security_acl: '7244e06bc63241d09821739bf3532ea2'
                            sys_user_role: {
                                id: '32c51b9dcd714401b3e53c6cd9cf311d'
                                key: {
                                    name: 'x_2191106_test_age.user'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'c1b07f7746e842029c9a605f2d7adf0b'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'status'
                            value: 'in_progress'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'c2cf37b8e5cb45ddbcc01ef42effda01'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_1_aa'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'd0e7a2bd3ccb42fe810d6e1feef8263c'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_0_a'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'd1460fc5f565457cbbf957e8b3ebf843'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'severity'
                            value: 'moderate'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'd1f63e11ba794ad3a35b3ca2b3cceade'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'NULL'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'd8bb1ceb775e4b74af7964eb0485d498'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                            value: 'notice'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'd9a09afff27f4113947416316016313e'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: 'da5494e12c994659b83d139eb612fa6e'
                        key: {
                            sys_security_acl: 'e20024f004f34588a0938c12ee497e1a'
                            sys_user_role: {
                                id: '595290fcfbdd4a0a93c72f38b3f822ce'
                                key: {
                                    name: 'x_2191106_test_age.admin'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'dc6c92500a594808a4a6be3dfe7ee38a'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'severity'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'e37407b207584da0bcb7bee8343aba7e'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'name'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: 'ea0413ed1cb84f9fa86797411656cf42'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'status'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'ea8ca48b1907485193edc23f1f9f9b96'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'name'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: 'f20b9bb17a52459a8bfd6a088846101f'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'f3c8f692b4eb4bf2834cb6f304a52816'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'status'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'f477649ba764489e8857bed12111c71d'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'issue_type'
                            value: 'navigation'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_db_object'
                        id: 'f6a9b65e74654ca8a3dd3e826f36cfe9'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'f88433cefb9f4111a04ca16175b81636'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'severity'
                            value: 'minor'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: 'f964dba0f6a7479a8f25988a26683fcb'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'severity'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'f9797bfd921848d4b53d34719730e238'
                        key: {
                            name: 'x_2191106_test_age_url_test'
                            element: 'wcag_standard'
                            value: 'wcag_2_1_aaa'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'fa651d1645e442b58e4b175c76534443'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'severity'
                            value: 'critical'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'fb88517cac0b452396ffbe94d06375cb'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'ff78ff470ee7428bbb7217190ed2a090'
                        key: {
                            name: 'x_2191106_test_age_test_result'
                            element: 'test_type'
                            value: 'site'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                ]
            }
        }
    }
}
