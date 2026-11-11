import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  prettierConfig,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "prisma/migrations/**",
      ".claude/**",
      "ops/**",
      "public/**",
      "next-env.d.ts",
    ],
  },
  {
    plugins: { prettier },
    rules: {
      "prettier/prettier": "error",

      // TypeScript discipline
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          minimumDescriptionLength: 8,
        },
      ],
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/prefer-as-const": "error",

      // React / hooks
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
      "react/jsx-key": "error",
      "react/no-array-index-key": "warn",
      "react/self-closing-comp": "error",
      "react/jsx-curly-brace-presence": ["error", { props: "never", children: "never" }],

      // General correctness
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-debugger": "error",
      "no-throw-literal": "error",
      "no-implicit-coercion": "error",
      "no-var": "error",
      "prefer-const": "error",
      "prefer-template": "error",
      "object-shorthand": ["error", "always"],
      "no-useless-rename": "error",
      "no-useless-return": "error",
      "no-useless-concat": "error",
      "no-duplicate-imports": "error",
      "no-return-await": "error",
      "no-console": "off",
      "no-unneeded-ternary": "error",
      "prefer-arrow-callback": "error",
      yoda: "error",
      curly: ["error", "multi-line"],
    },
  },
  {
    // Stubs in tests are intentionally empty.
    files: ["test/**"],
    rules: { "@typescript-eslint/no-empty-function": "off" },
  },
];

export default eslintConfig;
