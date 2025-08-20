// @ts-check
// Using @ecom-co/eslint library for clean and maintainable configuration
import { createNestJSConfig } from '@ecom-co/eslint/nestjs';

export default createNestJSConfig({
  tsconfigRootDir: import.meta.dirname,
  project: './tsconfig.json',
  
  // Custom perfectionist configuration
  perfectionist: {
    enabled: true,
    type: 'recommended-natural', // or 'recommended-natural', 'recommended-line-length', 'recommended-custom'
    partitionByComment: true, // Enable comment-based partitioning
  },
  
  // Additional ignore patterns for this project
  ignores: [
    'dist/**',
    'build/**',
    'coverage/**',
    '*.min.js',
    'node_modules/**',
  ],
  
  // Custom project-specific rules
  rules: {
    // Allow console.log in development
    'no-console': 'warn',
    
    // Relax some strict rules for development
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    
    // Adjust complexity limits for development
    'complexity': ['warn', 15],
    'max-lines': ['warn', 800],
    'max-lines-per-function': ['warn', 150],
    
    // Relax JSDoc requirements for development
    'jsdoc/require-jsdoc': 'off',
    'jsdoc/require-param': 'off',
    'jsdoc/require-returns': 'off',
    'lodash/prefer-lodash-method':'off'
  },
  
  // Custom import groups for this project
  importGroups: {
    groups: [
      // Built-in Node.js modules
      'builtin',
      
      // External packages (npm packages)
      'external',
      
      // Internal modules with specific patterns
      'internal',
      
      // Parent directory imports
      'parent',
      
      // Sibling directory imports
      'sibling',
      
      // Index files
      'index',
      
      // Type imports
      'type',
      
      // Unknown imports
      'unknown',
    ],
    pathGroups: [
      // NestJS core modules (highest priority)
      {
        pattern: '@nestjs/core',
        group: 'external',
        position: 'before',
      },
      {
        pattern: '@nestjs/common',
        group: 'external',
        position: 'before',
      },
      {
        pattern: '@nestjs/config',
        group: 'external',
        position: 'before',
      },
      {
        pattern: '@nestjs/typeorm',
        group: 'external',
        position: 'before',
      },
      {
        pattern: '@nestjs/jwt',
        group: 'external',
        position: 'before',
      },
      {
        pattern: '@nestjs/passport',
        group: 'external',
        position: 'before',
      },
      {
        pattern: '@nestjs/swagger',
        group: 'external',
        position: 'before',
      },
      
      // Database and ORM related
      {
        pattern: '@prisma/client',
        group: 'external',
        position: 'before',
      },
      {
        pattern: 'typeorm',
        group: 'external',
        position: 'before',
      },
      {
        pattern: 'prisma',
        group: 'external',
        position: 'before',
      },
      
      // Validation and transformation
      {
        pattern: 'class-validator',
        group: 'external',
        position: 'before',
      },
      {
        pattern: 'class-transformer',
        group: 'external',
        position: 'before',
      },
      {
        pattern: 'zod',
        group: 'external',
        position: 'before',
      },
      
      // Testing libraries
      {
        pattern: '@nestjs/testing',
        group: 'external',
        position: 'before',
      },
      {
        pattern: 'jest',
        group: 'external',
        position: 'before',
      },
      {
        pattern: 'supertest',
        group: 'external',
        position: 'before',
      },
      
      // Utility libraries
      {
        pattern: 'lodash',
        group: 'external',
        position: 'before',
      },
      {
        pattern: 'moment',
        group: 'external',
        position: 'before',
      },
      {
        pattern: 'dayjs',
        group: 'external',
        position: 'before',
      },
      
      // Company-specific internal modules
      {
        pattern: '@ecom/**',
        group: 'internal',
        position: 'before',
      },
      {
        pattern: '@company/**',
        group: 'internal',
        position: 'before',
      },
      {
        pattern: '@shared/**',
        group: 'internal',
        position: 'before',
      },
      
      // Project-specific internal modules
      {
        pattern: '@/*',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: '~/',
        group: 'internal',
        position: 'after',
      },
      
      // Relative imports for specific directories
      {
        pattern: './**/dto/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/entities/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/services/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/controllers/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/guards/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/decorators/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/enums/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/interfaces/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/types/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/utils/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/constants/**',
        group: 'internal',
        position: 'after',
      },
      {
        pattern: './**/config/**',
        group: 'internal',
        position: 'after',
      },
      
      // Type imports (should come after regular imports)
      {
        pattern: '**/*.types',
        group: 'type',
        position: 'after',
      },
      {
        pattern: '**/*.interface',
        group: 'type',
        position: 'after',
      },
      {
        pattern: '**/*.enum',
        group: 'type',
        position: 'after',
      },
    ],
  },
});
