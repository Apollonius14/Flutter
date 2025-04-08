#!/usr/bin/env node

/**
 * This script analyzes package.json to identify:
 * 1. Type definitions (@types/*) in dependencies that should be in devDependencies
 * 2. Development tools in dependencies that should be in devDependencies
 * 3. Build-related packages in dependencies that should be in devDependencies
 */

import fs from 'fs';

// Read the package.json file
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

// Lists to store misplaced dependencies
const typeDefinitions = [];
const devTools = [];
const buildTools = [];
const testingTools = [];
const replicationTools = [];
const vitePlugins = [];

// Keywords that indicate a package is likely a development dependency
const devKeywords = ['dev', 'lint', 'test', 'debug', 'format', 'prettier', 'eslint'];
const buildKeywords = ['build', 'esbuild', 'bundle', 'vite', 'webpack', 'rollup', 'tsx', 'typescript'];
const testKeywords = ['jest', 'mocha', 'chai', 'test', 'testing', 'storybook', 'cypress'];
const replitKeywords = ['replit', 'cartographer'];

// Analyze dependencies
const dependencies = packageJson.dependencies || {};
for (const pkg in dependencies) {
  // Check for type definitions
  if (pkg.startsWith('@types/')) {
    typeDefinitions.push(pkg);
    continue;
  }
  
  // Check for Vite plugins
  if (pkg.includes('vite-plugin')) {
    vitePlugins.push(pkg);
    continue;
  }
  
  // Check for development tools
  for (const keyword of devKeywords) {
    if (pkg.toLowerCase().includes(keyword)) {
      devTools.push(pkg);
      break;
    }
  }
  
  // Check for build tools
  for (const keyword of buildKeywords) {
    if (pkg.toLowerCase().includes(keyword)) {
      buildTools.push(pkg);
      break;
    }
  }
  
  // Check for testing tools
  for (const keyword of testKeywords) {
    if (pkg.toLowerCase().includes(keyword)) {
      testingTools.push(pkg);
      break;
    }
  }
  
  // Check for Replit-specific tools
  for (const keyword of replitKeywords) {
    if (pkg.toLowerCase().includes(keyword)) {
      replicationTools.push(pkg);
      break;
    }
  }
}

// Print the results
console.log('# Dependency Analysis\n');

console.log('## Type Definitions (@types/*) found in dependencies:');
if (typeDefinitions.length > 0) {
  typeDefinitions.forEach(pkg => console.log(`- ${pkg}`));
} else {
  console.log('None found.');
}

console.log('\n## Development Tools found in dependencies:');
if (devTools.length > 0) {
  devTools.forEach(pkg => console.log(`- ${pkg}`));
} else {
  console.log('None found.');
}

console.log('\n## Build Tools found in dependencies:');
if (buildTools.length > 0) {
  buildTools.forEach(pkg => console.log(`- ${pkg}`));
} else {
  console.log('None found.');
}

console.log('\n## Testing Tools found in dependencies:');
if (testingTools.length > 0) {
  testingTools.forEach(pkg => console.log(`- ${pkg}`));
} else {
  console.log('None found.');
}

console.log('\n## Vite Plugins found in dependencies:');
if (vitePlugins.length > 0) {
  vitePlugins.forEach(pkg => console.log(`- ${pkg}`));
} else {
  console.log('None found.');
}

console.log('\n## Replit-specific Tools found in dependencies:');
if (replicationTools.length > 0) {
  replicationTools.forEach(pkg => console.log(`- ${pkg}`));
} else {
  console.log('None found.');
}

// Calculate potential savings
const allMisplacedDeps = [
  ...typeDefinitions,
  ...devTools,
  ...buildTools,
  ...testingTools,
  ...vitePlugins,
  ...replicationTools
];

// Remove duplicates
const uniqueMisplacedDeps = [...new Set(allMisplacedDeps)];

console.log('\n## Summary:');
console.log(`Total packages identified for moving to devDependencies: ${uniqueMisplacedDeps.length}`);

// Create a formatted package.json with corrected dependencies
const newPackageJson = JSON.parse(JSON.stringify(packageJson));
newPackageJson.devDependencies = newPackageJson.devDependencies || {};

for (const pkg of uniqueMisplacedDeps) {
  // Move from dependencies to devDependencies
  if (newPackageJson.dependencies[pkg]) {
    newPackageJson.devDependencies[pkg] = newPackageJson.dependencies[pkg];
    delete newPackageJson.dependencies[pkg];
  }
}

// Write the suggested package.json to a new file
fs.writeFileSync(
  'package.json.suggested',
  JSON.stringify(newPackageJson, null, 2)
);

console.log('\nA suggested package.json file has been created at package.json.suggested');
console.log('Review the changes before applying them to your actual package.json file.');