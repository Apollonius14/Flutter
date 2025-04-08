#!/usr/bin/env node

/**
 * This script calculates the total size of node_modules and identifies the largest packages.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodeModulesPath = path.join(__dirname, 'node_modules');

// Function to calculate the size of a directory
function calculateDirSize(dirPath) {
  let size = 0;
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      size += calculateDirSize(filePath);
    } else {
      size += stats.size;
    }
  }
  
  return size;
}

// Function to format size in a readable way
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

// Calculate the total size of node_modules
try {
  const totalSize = calculateDirSize(nodeModulesPath);
  console.log(`Total size of node_modules: ${formatSize(totalSize)}`);
  
  // Calculate the size of each top-level package
  const packages = fs.readdirSync(nodeModulesPath)
    .filter(pkg => !pkg.startsWith('.') && !pkg.startsWith('@'));
  
  // Also include scoped packages
  const scopedPackages = fs.readdirSync(nodeModulesPath)
    .filter(pkg => pkg.startsWith('@'))
    .flatMap(scope => {
      const scopePath = path.join(nodeModulesPath, scope);
      return fs.readdirSync(scopePath)
        .map(pkg => `${scope}/${pkg}`);
    });
  
  const allPackages = [...packages, ...scopedPackages];
  
  // Calculate the size of each package
  const packageSizes = allPackages.map(pkg => {
    const pkgPath = path.join(nodeModulesPath, pkg);
    const size = calculateDirSize(pkgPath);
    return { name: pkg, size };
  });
  
  // Sort packages by size (largest first)
  packageSizes.sort((a, b) => b.size - a.size);
  
  // Display the top 20 largest packages
  console.log('\nTop 20 largest packages:');
  packageSizes.slice(0, 20).forEach((pkg, index) => {
    console.log(`${index + 1}. ${pkg.name}: ${formatSize(pkg.size)}`);
  });
  
  // Calculate the total size of @types packages
  const typesPackages = packageSizes.filter(pkg => pkg.name.startsWith('@types/'));
  const typesSize = typesPackages.reduce((total, pkg) => total + pkg.size, 0);
  console.log(`\nTotal size of @types packages: ${formatSize(typesSize)}`);
  
  // Calculate the total size of build tools
  const buildTools = packageSizes.filter(pkg => 
    pkg.name.includes('webpack') || 
    pkg.name.includes('vite') || 
    pkg.name.includes('esbuild') || 
    pkg.name.includes('babel') ||
    pkg.name.includes('typescript') ||
    pkg.name.includes('tsc') ||
    pkg.name.includes('rollup')
  );
  const buildToolsSize = buildTools.reduce((total, pkg) => total + pkg.size, 0);
  console.log(`Total size of build tools: ${formatSize(buildToolsSize)}`);
  
  // Calculate how much could be saved if we move dev dependencies
  const potentialSavings = typesSize + buildToolsSize;
  const savingsPercentage = (potentialSavings / totalSize) * 100;
  console.log(`\nPotential savings by moving dev dependencies: ${formatSize(potentialSavings)} (${savingsPercentage.toFixed(2)}% of total)`);
  
} catch (error) {
  console.error(`Error: ${error.message}`);
}