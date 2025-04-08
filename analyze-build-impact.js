#!/usr/bin/env node
/**
 * Build Impact Analysis Script (Module 3)
 * 
 * This script analyzes which dependencies are most likely to impact
 * the final bundle size based on:
 * 1. Size of the dependency in node_modules
 * 2. Whether it's a runtime dependency vs dev dependency
 * 3. Whether it supports tree-shaking
 * 
 * Usage:
 *   node analyze-build-impact.js
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TREE_SHAKEABLE_PACKAGES = [
  'react',
  'react-dom',
  'framer-motion',
  'lucide-react',
  'recharts',
  '@radix-ui/react-*', // Radix UI components are generally tree-shakeable
  'tailwind-merge',
  'clsx',
  'class-variance-authority',
  'zod'
];

const RUNTIME_ONLY_PACKAGES = [
  'express',
  'drizzle-orm',
  'passport',
  'ws',
];

// Get package sizes
function getPackageSizes() {
  const nodeModulesPath = path.resolve('./node_modules');
  const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
  
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };
  
  const results = [];
  
  for (const packageName in allDependencies) {
    try {
      const packagePath = path.resolve('./node_modules', packageName);
      if (!fs.existsSync(packagePath)) continue;
      
      // Get package size
      const size = getDirSize(packagePath);
      
      // Determine if it's a dev dependency
      const isDev = packageJson.devDependencies && packageName in packageJson.devDependencies;
      
      // Check if it's likely tree-shakeable
      const isTreeShakeable = TREE_SHAKEABLE_PACKAGES.some(pattern => {
        if (pattern.endsWith('*')) {
          return packageName.startsWith(pattern.slice(0, -1));
        }
        return packageName === pattern;
      });
      
      // Check if it's a runtime-only package
      const isRuntimeOnly = RUNTIME_ONLY_PACKAGES.includes(packageName);
      
      // Get package metadata
      const packageMetadata = JSON.parse(
        fs.readFileSync(path.join(packagePath, 'package.json'), 'utf-8')
      );
      
      // Check for sideEffects flag (indicates tree-shakeability)
      const hasSideEffects = packageMetadata.sideEffects !== false;
      
      // Check for module field (indicates ESM support)
      const hasEsmSupport = !!packageMetadata.module;
      
      results.push({
        name: packageName,
        size,
        isDev,
        isTreeShakeable,
        isRuntimeOnly,
        hasSideEffects,
        hasEsmSupport,
        impactScore: calculateImpactScore({
          size, 
          isDev, 
          isTreeShakeable, 
          isRuntimeOnly,
          hasSideEffects,
          hasEsmSupport
        }),
        version: packageMetadata.version
      });
    } catch (err) {
      console.error(`Error processing ${packageName}:`, err.message);
    }
  }
  
  return results.sort((a, b) => b.impactScore - a.impactScore);
}

function calculateImpactScore({
  size, 
  isDev, 
  isTreeShakeable, 
  isRuntimeOnly,
  hasSideEffects,
  hasEsmSupport
}) {
  // Base score is proportional to size
  let score = Math.log10(size) * 10;
  
  // Heavily reduce score if it's a dev dependency
  if (isDev) {
    score *= 0.2;
  }
  
  // Reduce score if it's tree-shakeable
  if (isTreeShakeable) {
    score *= 0.5;
  }
  
  // Increase score if it has side effects (harder to tree-shake)
  if (hasSideEffects) {
    score *= 1.5;
  }
  
  // Decrease score if it has ESM support (better for tree-shaking)
  if (hasEsmSupport) {
    score *= 0.8;
  }
  
  // Increase score if it's a runtime-only package
  if (isRuntimeOnly) {
    score *= 1.2;
  }
  
  return Math.round(score);
}

function getDirSize(dirPath) {
  try {
    const result = execSync(`du -sk "${dirPath}"`, { encoding: 'utf-8' });
    return parseInt(result.split('\t')[0]) * 1024; // Convert from KB to bytes
  } catch (err) {
    return 0;
  }
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function suggestOptimizations(results) {
  const suggestions = [];
  
  // Look for large dependencies that can be optimized
  for (const pkg of results.slice(0, 20)) {
    if (!pkg.isDev && pkg.size > 5 * 1024 * 1024) {
      if (pkg.isTreeShakeable && !pkg.hasSideEffects) {
        suggestions.push(`✓ ${pkg.name} (${formatSize(pkg.size)}) is tree-shakeable. Import specific components when possible.`);
      } else if (pkg.name.includes('/react-')) {
        suggestions.push(`! ${pkg.name} (${formatSize(pkg.size)}) could be imported selectively to reduce bundle size.`);
      } else if (!pkg.isTreeShakeable && !pkg.isRuntimeOnly) {
        suggestions.push(`! ${pkg.name} (${formatSize(pkg.size)}) is not tree-shakeable and might impact bundle size significantly.`);
      }
    }
    
    // Suggest moving large dev dependencies to on-demand scripts
    if (pkg.isDev && pkg.size > 20 * 1024 * 1024) {
      suggestions.push(`? Consider using ${pkg.name} (${formatSize(pkg.size)}) through on-demand scripts to reduce node_modules size.`);
    }
  }
  
  return suggestions;
}

function analyzeDependencyChains() {
  console.log("Analyzing dependency chains:");
  try {
    const output = execSync('npm ls --production --depth=1', { encoding: 'utf-8' });
    const lines = output.split('\n');
    
    // Find chains with many dependencies
    const depsCount = lines.filter(line => line.includes('└──') || line.includes('├──')).length;
    
    console.log(`Total direct production dependencies: ${depsCount}`);
    
    // Look for problematic patterns
    const circularWarnings = lines.filter(line => line.includes('deduped') && line.includes('(circular)'));
    if (circularWarnings.length > 0) {
      console.log("\nDetected potential circular dependencies:");
      circularWarnings.forEach(line => console.log(`- ${line.trim()}`));
    }
    
  } catch (err) {
    console.error("Error analyzing dependency chains:", err.message);
  }
}

// Main function
function main() {
  console.log("===== Build Impact Analysis =====");
  
  // Get and display package sizes with impact score
  const packageSizes = getPackageSizes();
  
  console.log("\nTop 20 packages by potential build impact:");
  console.log("----------------------------------------");
  packageSizes.slice(0, 20).forEach((pkg, i) => {
    const status = pkg.isDev ? "DEV" : "PROD";
    const treeShake = pkg.isTreeShakeable ? "✓" : "✗";
    console.log(`${i+1}. ${pkg.name} v${pkg.version}`);
    console.log(`   Size: ${formatSize(pkg.size)} | ${status} | Tree-shake: ${treeShake} | Impact: ${pkg.impactScore}`);
  });
  
  // Analyze dependency chains
  analyzeDependencyChains();
  
  // Suggest optimizations
  const suggestions = suggestOptimizations(packageSizes);
  if (suggestions.length > 0) {
    console.log("\nOptimization Suggestions:");
    console.log("-----------------------");
    suggestions.forEach(suggestion => console.log(suggestion));
  }
  
  // Calculate total sizes
  const totalSize = packageSizes.reduce((sum, pkg) => sum + pkg.size, 0);
  const prodSize = packageSizes
    .filter(pkg => !pkg.isDev)
    .reduce((sum, pkg) => sum + pkg.size, 0);
  const devSize = packageSizes
    .filter(pkg => pkg.isDev)
    .reduce((sum, pkg) => sum + pkg.size, 0);
  
  console.log("\nSummary:");
  console.log("--------");
  console.log(`Total node_modules size: ${formatSize(totalSize)}`);
  console.log(`Production dependencies: ${formatSize(prodSize)} (${Math.round(prodSize/totalSize*100)}%)`);
  console.log(`Development dependencies: ${formatSize(devSize)} (${Math.round(devSize/totalSize*100)}%)`);
}

main();