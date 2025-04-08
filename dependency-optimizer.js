#!/usr/bin/env node

/**
 * Dependency Optimizer Script
 * 
 * This script analyzes the package.json to identify:
 * 1. Dependencies that should be moved to devDependencies
 * 2. Potential size savings from proper dependency categorization
 * 3. Creates a new optimized package.json for reference
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the current package.json
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// List of known dev dependencies by category
const devDependencyPatterns = {
  // Type definitions
  types: [
    '@types/',
  ],
  
  // Specific packages that should be in devDependencies
  specificDevDeps: [
    '@replit/vite-plugin-shadcn-theme-json',
    '@replit/vite-plugin-cartographer',
    '@replit/vite-plugin-runtime-error-modal',
  ],
  
  // Build tools
  buildTools: [
    'typescript',
    'esbuild',
    'vite',
    'rollup',
    'webpack',
    'babel',
    'tsc',
    'postcss',
    'tailwindcss',
    'autoprefixer',
    'eslint',
    'prettier',
    'tsx',
  ],
  
  // Testing tools
  testingTools: [
    'jest',
    'mocha',
    'chai',
    'testing-library',
    'vitest',
    'cypress',
    'playwright',
    'puppeteer',
    'karma',
  ],
  
  // Development plugins
  devPlugins: [
    'vite-plugin',
    'webpack-plugin',
    'eslint-plugin',
    'babel-plugin',
    'postcss-plugin',
  ],
  
  // Development utilities
  devUtilities: [
    'drizzle-kit',
    'nodemon',
    'ts-node',
    'concurrently',
    'dotenv',
    'debug',
  ],
};

// Categorize dependencies
const categorizedDeps = {
  types: [],
  specificDevDeps: [],
  buildTools: [],
  testingTools: [],
  devPlugins: [],
  devUtilities: [],
  unknown: [],
};

// List of runtime dependencies that should NOT be moved
const runtimeDependencies = [
  'react',
  'react-dom',
  'express',
  'node-fetch',
  'axios',
  'lodash',
  'zod',
  'drizzle-orm',
  '@radix-ui/',
  'wouter',
  'framer-motion',
  'lucide-react',
  'matter-js',
  'tailwind-merge',
  'tailwindcss-animate',
  'class-variance-authority',
  'clsx',
  'vaul',
];

// Check if a dependency name matches any of the runtime patterns
function isRuntimeDependency(depName) {
  return runtimeDependencies.some(pattern => {
    if (pattern.endsWith('/')) {
      return depName.startsWith(pattern);
    }
    return depName === pattern || depName.startsWith(`${pattern}/`);
  });
}

// Analyze dependencies
const dependencies = packageJson.dependencies || {};
const devDependencies = packageJson.devDependencies || {};

// Categorize current dependencies
for (const depName in dependencies) {
  // Skip if it's a known runtime dependency
  if (isRuntimeDependency(depName)) {
    continue;
  }
  
  let categorized = false;
  
  // Check each category
  for (const category in devDependencyPatterns) {
    for (const pattern of devDependencyPatterns[category]) {
      if (depName.includes(pattern)) {
        categorizedDeps[category].push({
          name: depName,
          version: dependencies[depName],
        });
        categorized = true;
        break;
      }
    }
    if (categorized) break;
  }
  
  // If not categorized, add to unknown
  if (!categorized) {
    categorizedDeps.unknown.push({
      name: depName,
      version: dependencies[depName],
    });
  }
}

// Create an optimized package.json
const optimizedPackageJson = JSON.parse(JSON.stringify(packageJson));
optimizedPackageJson.dependencies = { ...dependencies };
optimizedPackageJson.devDependencies = { ...devDependencies };

// Move categorized dependencies to devDependencies
let totalMoved = 0;
for (const category in categorizedDeps) {
  if (category === 'unknown') continue;
  
  for (const dep of categorizedDeps[category]) {
    if (optimizedPackageJson.dependencies[dep.name]) {
      // Add to devDependencies
      optimizedPackageJson.devDependencies[dep.name] = dep.version;
      // Remove from dependencies
      delete optimizedPackageJson.dependencies[dep.name];
      totalMoved++;
    }
  }
}

// Sort the dependencies alphabetically
function sortObjectByKeys(obj) {
  return Object.keys(obj).sort().reduce((sorted, key) => {
    sorted[key] = obj[key];
    return sorted;
  }, {});
}

optimizedPackageJson.dependencies = sortObjectByKeys(optimizedPackageJson.dependencies);
optimizedPackageJson.devDependencies = sortObjectByKeys(optimizedPackageJson.devDependencies);

// Write the optimized package.json
fs.writeFileSync(
  path.join(__dirname, 'package.json.optimized'),
  JSON.stringify(optimizedPackageJson, null, 2)
);

// Print the analysis results
console.log('# Dependency Optimization Analysis\n');

// Print dependencies by category
for (const category in categorizedDeps) {
  if (category === 'unknown') continue;
  
  const deps = categorizedDeps[category];
  if (deps.length > 0) {
    console.log(`## ${category} (${deps.length} found):`);
    deps.forEach(dep => console.log(`- ${dep.name}`));
    console.log();
  }
}

// Print unknown dependencies
const unknownDeps = categorizedDeps.unknown;
if (unknownDeps.length > 0) {
  console.log(`## Dependencies that could not be categorized (${unknownDeps.length} found):`);
  unknownDeps.forEach(dep => console.log(`- ${dep.name}`));
  console.log();
}

// Summary
console.log('## Summary:');
console.log(`Total dependencies moved to devDependencies: ${totalMoved}`);
console.log(`Optimized package.json created at: package.json.optimized`);
console.log('\nReview the optimized package.json before applying the changes.');