import { createBaseConfig } from '@ecom-co/eslint';

export default createBaseConfig({
  tsconfigRootDir: import.meta.dirname,
  project: './tsconfig.json',
});


