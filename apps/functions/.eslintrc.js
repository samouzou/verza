module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "indent": ["error", 2],
    "max-len": ["error", {"code": 130}],
    "no-trailing-spaces": "warn",
  },

  overrides: [
    {
      files: ["*.js"], // Target all JavaScript files
      rules: {
        // Disable or modify TypeScript-specific rules for JS files
        "@typescript-eslint/no-unused-vars": "off", // Example: turn off unused var rule for JS
        "@typescript-eslint/explicit-function-return-type": "off", // Example: turn off explicit return type rule for JS
        // ... other rules you want to disable or change for JS files
      },
    },
    {
      files: [".eslintrc.js"], // Specifically target .eslintrc.js
      parserOptions: {
        project: null, // Remove the project option for .eslintrc.js
      },
      rules: {
        // Any specific rules for .eslintrc.js
      },
    },
  ],
};
