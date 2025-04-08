#!/usr/bin/env node

/**
 * App Load Time Analysis Script
 * 
 * This script analyzes the factors contributing to application load time:
 * 1. Node modules size and structure
 * 2. Dependency tree analysis
 * 3. Module resolution time
 * 4. Bundle size analysis
 * 5. Startup performance metrics
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Formatting utilities
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  else return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Recursively get directory size with an option to output top contributors
function getDirSize(dirPath, maxDepth = 2, currentDepth = 0) {
  let totalSize = 0;
  let sizeMap = {};
  
  try {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        const { size, subDirs } = getDirSize(filePath, maxDepth, currentDepth + 1);
        totalSize += size;
        
        if (currentDepth < maxDepth) {
          sizeMap[file] = { size, percentage: 0, subDirs };
        }
      } else {
        totalSize += stats.size;
      }
    }
    
    // Calculate percentages for subdirectories
    if (currentDepth < maxDepth && totalSize > 0) {
      for (const dir in sizeMap) {
        sizeMap[dir].percentage = ((sizeMap[dir].size / totalSize) * 100).toFixed(2) + '%';
      }
      
      // Sort by size descending
      const sortedSizeMap = {};
      Object.keys(sizeMap)
        .sort((a, b) => sizeMap[b].size - sizeMap[a].size)
        .forEach(key => {
          sortedSizeMap[key] = {
            size: formatSize(sizeMap[key].size),
            percentage: sizeMap[key].percentage,
            ...(sizeMap[key].subDirs && Object.keys(sizeMap[key].subDirs).length > 0 ? { subDirs: sizeMap[key].subDirs } : {})
          };
        });
      
      return { size: totalSize, subDirs: sortedSizeMap };
    }
    
    return { size: totalSize, subDirs: {} };
  } catch (error) {
    console.error(`Error analyzing ${dirPath}:`, error.message);
    return { size: 0, subDirs: {} };
  }
}

// Analyze the dependency tree from package.json
function analyzeDependencyTree() {
  console.log('\n📊 DEPENDENCY STRUCTURE ANALYSIS');
  console.log('===============================');
  
  try {
    // Analyze node_modules directory
    console.log('📦 Node Modules Analysis:');
    const nmPath = path.join(process.cwd(), 'node_modules');
    
    if (fs.existsSync(nmPath)) {
      const { size, subDirs } = getDirSize(nmPath, 2);
      console.log(`Total node_modules size: ${formatSize(size)}`);
      console.log('\nTop-level dependencies by size:');
      console.log(JSON.stringify(subDirs, null, 2));
    } else {
      console.log('node_modules directory not found');
    }
  } catch (error) {
    console.error('Error analyzing dependency tree:', error.message);
  }
}

// Analyze package.json for dev dependencies vs regular dependencies
async function analyzePackageJson() {
  console.log('\n📄 PACKAGE.JSON ANALYSIS');
  console.log('======================');
  
  try {
    if (fs.existsSync('package.json')) {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      
      const deps = Object.keys(packageJson.dependencies || {}).length;
      const devDeps = Object.keys(packageJson.devDependencies || {}).length;
      
      console.log(`Dependencies: ${deps}`);
      console.log(`DevDependencies: ${devDeps}`);
      
      // Check for potential misplaced dev dependencies
      const devDepsInProd = [];
      const typeDefs = [];
      
      for (const dep in packageJson.dependencies || {}) {
        if (dep.startsWith('@types/')) {
          typeDefs.push(dep);
        } else if (
          dep.includes('test') || 
          dep.includes('dev') || 
          dep.includes('build') || 
          dep.includes('lint') ||
          dep.includes('prettier') ||
          dep.includes('eslint') ||
          dep.includes('typescript') ||
          dep.includes('vite')
        ) {
          devDepsInProd.push(dep);
        }
      }
      
      if (typeDefs.length > 0) {
        console.log('\nPotential type definitions in dependencies (should be in devDependencies):');
        console.log(typeDefs.join(', '));
      }
      
      if (devDepsInProd.length > 0) {
        console.log('\nPotential development packages in dependencies:');
        console.log(devDepsInProd.join(', '));
      }
    } else {
      console.log('package.json not found');
    }
  } catch (error) {
    console.error('Error analyzing package.json:', error.message);
  }
}

// Analyze module resolution performance
function analyzeModuleResolution() {
  console.log('\n⏱️ MODULE RESOLUTION TIME ANALYSIS');
  console.log('================================');
  
  try {
    // Measure Node.js module resolution time
    console.log('Running a simple Node.js script with --trace-module-resolution flag...');
    const startTime = Date.now();
    
    const testScript = `
    const fs = require('fs');
    const path = require('path');
    const React = require('react');
    const ReactDOM = require('react-dom');
    console.log('Modules loaded successfully');
    `;
    
    fs.writeFileSync('temp-module-test.js', testScript, 'utf8');
    
    try {
      execSync('node --trace-module-resolution temp-module-test.js > module-resolution.log 2>&1', {
        timeout: 10000
      });
    } catch (error) {
      console.log('Error running module resolution test, but this might be expected.');
    }
    
    const endTime = Date.now();
    console.log(`Module resolution time: ${endTime - startTime}ms`);
    
    // Clean up
    if (fs.existsSync('temp-module-test.js')) {
      fs.unlinkSync('temp-module-test.js');
    }
    
    // Report on module resolution log size
    if (fs.existsSync('module-resolution.log')) {
      const stats = fs.statSync('module-resolution.log');
      console.log(`Module resolution log size: ${formatSize(stats.size)}`);
      
      // Count resolution steps
      const logContent = fs.readFileSync('module-resolution.log', 'utf8');
      const resolutionSteps = logContent.split('\n').filter(line => line.includes('looking for')).length;
      console.log(`Number of module resolution steps: ${resolutionSteps}`);
      
      // Cleanup log
      fs.unlinkSync('module-resolution.log');
    }
  } catch (error) {
    console.error('Error analyzing module resolution:', error.message);
  }
}

// Analyze Vite and other build tools
function analyzeBuildTools() {
  console.log('\n🛠️ BUILD TOOLS ANALYSIS');
  console.log('=====================');
  
  try {
    // Check Vite config
    if (fs.existsSync('vite.config.ts') || fs.existsSync('vite.config.js')) {
      console.log('Vite configuration found.');
      
      // Estimate the impact of Vite plugins
      const config = fs.existsSync('vite.config.ts') 
        ? fs.readFileSync('vite.config.ts', 'utf8')
        : fs.readFileSync('vite.config.js', 'utf8');
      
      const pluginCount = (config.match(/plugin/g) || []).length;
      console.log(`Estimated Vite plugins: ~${pluginCount}`);
      
      // Check for optimizations
      const hasOptimize = config.includes('optimizeDeps');
      console.log(`Has dependency optimization: ${hasOptimize ? 'Yes' : 'No'}`);
      
      const hasBuild = config.includes('build:');
      console.log(`Has build configuration: ${hasBuild ? 'Yes' : 'No'}`);
    } else {
      console.log('No Vite configuration found');
    }
  } catch (error) {
    console.error('Error analyzing build tools:', error.message);
  }
}

// Main function
async function main() {
  console.log('🔍 APPLICATION LOAD TIME ANALYSIS');
  console.log('==============================');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Node.js version: ${process.version}`);
  
  // Analyze dependency structure
  analyzeDependencyTree();
  
  // Analyze package.json
  await analyzePackageJson();
  
  // Analyze module resolution
  analyzeModuleResolution();
  
  // Analyze build tools
  analyzeBuildTools();
  
  console.log('\n✅ Analysis complete!');
}

// Run the analysis
main().catch(err => {
  console.error('Analysis failed:', err);
});