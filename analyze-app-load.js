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

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import util from 'util';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to format file sizes
function formatSize(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
  if (i === 0) return `${bytes} ${sizes[i]}`;
  return `${(bytes / (1024 ** i)).toFixed(2)} ${sizes[i]}`;
}

// Function to get directory size recursively
function getDirSize(dirPath, maxDepth = 2, currentDepth = 0) {
  if (!fs.existsSync(dirPath)) return { size: 0, fileCount: 0, subDirs: {} };
  
  const stats = fs.statSync(dirPath);
  if (!stats.isDirectory()) return { size: stats.size, fileCount: 1, subDirs: {} };
  
  let totalSize = 0;
  let fileCount = 0;
  const subDirs = {};
  
  try {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          const subResult = { size: 0, fileCount: 0, subDirs: {} };
          
          if (currentDepth < maxDepth) {
            const childResult = getDirSize(filePath, maxDepth, currentDepth + 1);
            subResult.size = childResult.size;
            subResult.fileCount = childResult.fileCount;
            if (currentDepth + 1 < maxDepth) {
              subResult.subDirs = childResult.subDirs;
            }
          } else {
            // Just get total size without recursing further
            const getSize = dirPath => {
              let size = 0;
              try {
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                  const filePath = path.join(dirPath, file);
                  const stat = fs.statSync(filePath);
                  if (stat.isDirectory()) {
                    size += getSize(filePath);
                  } else {
                    size += stat.size;
                    fileCount++;
                  }
                }
              } catch (err) {
                console.error(`Error reading ${dirPath}: ${err.message}`);
              }
              return size;
            };
            
            subResult.size = getSize(filePath);
          }
          
          subDirs[file] = subResult;
          totalSize += subResult.size;
          fileCount += subResult.fileCount;
        } else {
          totalSize += stat.size;
          fileCount++;
        }
      } catch (err) {
        console.error(`Error processing ${filePath}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}: ${err.message}`);
  }
  
  return { size: totalSize, fileCount, subDirs };
}

// Function to analyze dependency tree
function analyzeDependencyTree() {
  console.log('\n📦 DEPENDENCY TREE ANALYSIS');
  console.log('==========================');
  
  try {
    const npmList = execSync('npm list --depth=0').toString();
    console.log('Top-level dependencies:');
    console.log(npmList);
    
    // Get production dependencies only
    console.log('\nProduction dependencies only:');
    const prodDeps = execSync('npm list --prod --depth=0').toString();
    console.log(prodDeps);
    
    // Get dev dependencies only
    console.log('\nDev dependencies only:');
    const devDeps = execSync('npm list --dev --depth=0').toString();
    console.log(devDeps);
  } catch (err) {
    console.log('Dependency tree information (with some errors):');
    console.log(err.stdout ? err.stdout.toString() : 'No output');
  }
}

// Function to analyze npm package.json
async function analyzePackageJson() {
  console.log('\n📄 PACKAGE.JSON ANALYSIS');
  console.log('=======================');
  
  try {
    const packageJsonContent = fs.readFileSync('./package.json', 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    
    const depCount = Object.keys(packageJson.dependencies || {}).length;
    const devDepCount = Object.keys(packageJson.devDependencies || {}).length;
    
    console.log(`Total dependencies: ${depCount + devDepCount}`);
    console.log(`- Regular dependencies: ${depCount}`);
    console.log(`- Dev dependencies: ${devDepCount}`);
    
    // List the main engines and their versions
    if (packageJson.engines) {
      console.log('\nEngines:');
      Object.entries(packageJson.engines).forEach(([engine, version]) => {
        console.log(`- ${engine}: ${version}`);
      });
    }
    
    // List scripts that might affect load time
    if (packageJson.scripts) {
      console.log('\nRelevant scripts:');
      const relevantScripts = ['start', 'dev', 'build', 'prebuild', 'postbuild'];
      relevantScripts.forEach(script => {
        if (packageJson.scripts[script]) {
          console.log(`- ${script}: ${packageJson.scripts[script]}`);
        }
      });
    }
  } catch (err) {
    console.error(`Error analyzing package.json: ${err.message}`);
  }
}

// Function to perform module resolution analysis
function analyzeModuleResolution() {
  console.log('\n🔍 MODULE RESOLUTION ANALYSIS');
  console.log('===========================');
  
  const testModules = [
    'react', 
    'react-dom', 
    'matter-js', 
    'express', 
    'tailwindcss',
    'vite',
    'drizzle-orm',
    'lucide-react'
  ];
  
  console.log('Module resolution paths:');
  testModules.forEach(moduleName => {
    try {
      // Using file system checks instead of require.resolve
      const nodeModulesPath = path.join(process.cwd(), 'node_modules', moduleName);
      if (fs.existsSync(nodeModulesPath)) {
        console.log(`- ${moduleName}: ${nodeModulesPath}`);
        
        // Get module package.json
        const packageJsonPath = path.join(nodeModulesPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
          const modulePackage = JSON.parse(packageJsonContent);
          console.log(`  Version: ${modulePackage.version}`);
          console.log(`  Main: ${modulePackage.main || 'not specified'}`);
          console.log(`  Module type: ${modulePackage.type || 'commonjs (default)'}`);
        } else {
          console.log(`  No package.json accessible`);
        }
      } else {
        console.log(`- ${moduleName}: Not found in node_modules`);
      }
    } catch (err) {
      console.log(`- ${moduleName}: Error analyzing (${err.message})`);
    }
  });
}

// Function to analyze build/transpile tools
function analyzeBuildTools() {
  console.log('\n🔧 BUILD TOOLS ANALYSIS');
  console.log('=====================');
  
  // Check for common build tools configuration files
  const configFiles = [
    'vite.config.ts',
    'vite.config.js',
    'webpack.config.js',
    'babel.config.js',
    '.babelrc',
    'tsconfig.json',
    'tailwind.config.js',
    'postcss.config.js'
  ];
  
  console.log('Build configuration files:');
  configFiles.forEach(file => {
    if (fs.existsSync(file)) {
      console.log(`- ${file} (exists)`);
      
      // For some configs, we can provide more detail
      if (file === 'tsconfig.json') {
        try {
          const tsconfigContent = fs.readFileSync('./tsconfig.json', 'utf8');
          const tsconfig = JSON.parse(tsconfigContent);
          console.log(`  Target: ${tsconfig.compilerOptions?.target || 'not specified'}`);
          console.log(`  Module: ${tsconfig.compilerOptions?.module || 'not specified'}`);
          console.log(`  Strict mode: ${tsconfig.compilerOptions?.strict || false}`);
        } catch (e) {
          console.log('  Could not parse tsconfig.json');
        }
      }
    } else {
      console.log(`- ${file} (not found)`);
    }
  });
}

// Main function to run all analyses
async function main() {
  console.log('🔍 APP LOAD TIME ANALYSIS');
  console.log('========================');
  console.log(`Analysis started at: ${new Date().toISOString()}`);
  console.log(`Current working directory: ${process.cwd()}`);
  
  // Analyze the filesystem
  console.log('\n📂 FILE SYSTEM ANALYSIS');
  console.log('======================');
  console.log('Analyzing file sizes, please wait...');
  
  // Analyze node_modules
  const nodeModulesPath = path.join(process.cwd(), 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    console.log('\nNode Modules Analysis:');
    
    try {
      // Get overall size
      const { size, fileCount } = getDirSize(nodeModulesPath, 0);
      console.log(`Total node_modules size: ${formatSize(size)} (${fileCount} files)`);
      
      // Get top-level packages by size
      console.log('\nTop node_modules by size:');
      const topDirs = fs.readdirSync(nodeModulesPath)
        .filter(dir => !dir.startsWith('.'))
        .map(dir => {
          const dirPath = path.join(nodeModulesPath, dir);
          if (fs.statSync(dirPath).isDirectory()) {
            const { size } = getDirSize(dirPath, 0);
            return { name: dir, size };
          }
          return { name: dir, size: 0 };
        })
        .sort((a, b) => b.size - a.size)
        .slice(0, 20);
      
      topDirs.forEach(dir => {
        console.log(`- ${dir.name}: ${formatSize(dir.size)}`);
      });
    } catch (err) {
      console.error(`Error analyzing node_modules: ${err.message}`);
    }
  } else {
    console.log('No node_modules directory found.');
  }
  
  // Analyze project source files
  const sourceAnalysis = {
    client: getDirSize('./client', 1),
    server: getDirSize('./server', 1),
    shared: getDirSize('./shared', 1)
  };
  
  console.log('\nProject Source Files Analysis:');
  Object.entries(sourceAnalysis).forEach(([dir, analysis]) => {
    console.log(`- ${dir}: ${formatSize(analysis.size)} (${analysis.fileCount} files)`);
  });
  
  // Analyze package.json
  analyzePackageJson();
  
  // Analyze dependency tree
  analyzeDependencyTree();
  
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