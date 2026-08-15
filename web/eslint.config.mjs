import next from "eslint-config-next"

// Flat config for ESLint 9 (REV-007). `next lint` was removed in Next 16,
// so linting runs through eslint directly with the Next flat preset.
export default [
  ...next,
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts", "*.config.*"],
  },
]
