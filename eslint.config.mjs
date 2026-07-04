import js from "@eslint/js";

/* Lint for a no-build, classic-<script> app: all module files share one global scope,
   so cross-file references are expected. We therefore keep the architecture-independent,
   bug-catching rules ON (they need no globals list) and turn OFF style/undef noise that
   would only produce false positives here. Once the app moves to ES modules, turn
   "no-undef" and "no-unused-vars" back on — they become valuable then. */
export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script" },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-cond-assign": "off",
      "no-constant-condition": "off",
      "no-prototype-builtins": "off",
      "no-fallthrough": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-dupe-else-if": "error",
      "no-unreachable": "error",
      "no-func-assign": "error",
      "no-self-assign": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-unsafe-negation": "error",
      "no-obj-calls": "error",
      "no-sparse-arrays": "error",
      "no-unexpected-multiline": "error"
    }
  }
];
