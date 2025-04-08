/**
 * Component Mount Timing Analysis Script (Module 3)
 * 
 * This script helps identify components that are slow to mount or render
 * by injecting performance measurement code into React components.
 * 
 * Usage:
 *   node measure-component-timing.js [--analyze <component_directory>] [--inject] [--restore]
 *   
 *   --analyze: Only analyze the components without modifying them
 *   --inject: Add performance measurement code to components
 *   --restore: Remove previously injected measurement code
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Default directory for components 
const DEFAULT_COMPONENT_DIR = './client/src/components';

// Used to track which files were modified
const INJECTED_FILES_LOG = './.component-timing-modified.json';

// Backup directory
const BACKUP_DIR = './component-timing-backups';

// Default directory to analyze if not specified
let targetDir = DEFAULT_COMPONENT_DIR;

// Parse command line arguments
const args = process.argv.slice(2);
const shouldInject = args.includes('--inject');
const shouldRestore = args.includes('--restore');

// Check for analyze with directory
const analyzeIndex = args.indexOf('--analyze');
if (analyzeIndex !== -1 && args.length > analyzeIndex + 1) {
  targetDir = args[analyzeIndex + 1];
}

/**
 * Creates a backup of the file before modifying it
 */
function backupFile(filePath) {
  const backupPath = path.join(BACKUP_DIR, path.relative('.', filePath));
  
  // Create backup directory if it doesn't exist
  const backupDir = path.dirname(backupPath);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  // Copy the file
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backed up: ${filePath} -> ${backupPath}`);
  
  return backupPath;
}

/**
 * Finds all React components in the target directory
 */
async function findReactComponents(directory) {
  const pattern = path.join(directory, '**/*.{tsx,jsx}');
  const files = await glob(pattern);
  
  // Filter to only include files that export components
  const componentFiles = [];
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    
    // Simple heuristic to detect React components
    if (
      (content.includes('function') || content.includes('const')) &&
      (content.includes('return (') || content.includes('return ('))
    ) {
      componentFiles.push(file);
    }
  }
  
  return componentFiles;
}

/**
 * Injects performance measurement code into a component
 */
function injectTimingCode(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // Extract component names using a simple regex
  const componentRegex = /(?:export\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/g;
  const matches = [...content.matchAll(componentRegex)];
  
  if (matches.length === 0) {
    console.log(`No components found in ${filePath}`);
    return null;
  }
  
  // Keep track of modifications
  let modified = false;
  
  // Process each component
  for (const match of matches) {
    const componentName = match[1];
    
    // Skip if already instrumented
    if (content.includes(`// TIMING_INSTRUMENTATION: ${componentName}`)) {
      console.log(`${componentName} in ${filePath} already instrumented`);
      continue;
    }
    
    // Look for the component declaration and the opening of its body
    const componentPattern = new RegExp(`((?:export\\s+)?(?:function|const)\\s+${componentName}.*?\\{)`, 's');
    const componentMatch = content.match(componentPattern);
    
    if (!componentMatch) continue;
    
    const insertPos = componentMatch.index + componentMatch[0].length;
    
    // Inject performance measurement code
    const injectedCode = `
  // TIMING_INSTRUMENTATION: ${componentName}
  const startTime = performance.now();
  console.log(\`[PERF] ${componentName} mounting started\`);
  
  // Clean up and log timing when component unmounts
  React.useEffect(() => {
    const mountTime = performance.now() - startTime;
    console.log(\`[PERF] ${componentName} mounted in \${mountTime.toFixed(2)}ms\`);
    
    return () => {
      console.log(\`[PERF] ${componentName} unmounting\`);
    };
  }, []);
`;
    
    // Insert the code
    content = content.slice(0, insertPos) + injectedCode + content.slice(insertPos);
    modified = true;
  }
  
  if (modified) {
    // Add React import if needed
    if (!content.includes('import React') && !content.includes('import * as React')) {
      content = `import React from 'react';\n${content}`;
    }
    
    // Backup the file
    backupFile(filePath);
    
    // Write the modified content
    fs.writeFileSync(filePath, content);
    console.log(`Instrumented ${filePath}`);
    
    return filePath;
  }
  
  return null;
}

/**
 * Restores components from backups
 */
function restoreFromBackups() {
  if (!fs.existsSync(INJECTED_FILES_LOG)) {
    console.log('No instrumentation log found. Nothing to restore.');
    return;
  }
  
  // Read the log of modified files
  const modifiedFiles = JSON.parse(fs.readFileSync(INJECTED_FILES_LOG, 'utf-8'));
  
  for (const filePath of modifiedFiles) {
    const backupPath = path.join(BACKUP_DIR, path.relative('.', filePath));
    
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, filePath);
      console.log(`Restored ${filePath} from backup`);
    } else {
      console.log(`Warning: Backup not found for ${filePath}`);
    }
  }
  
  // Delete the log file
  fs.unlinkSync(INJECTED_FILES_LOG);
  console.log('Restoration complete');
}

/**
 * Main function
 */
async function main() {
  console.log('Component Timing Analysis Tool');
  console.log('------------------------------');
  
  // Handle restore command first
  if (shouldRestore) {
    restoreFromBackups();
    return;
  }
  
  // Find React components
  console.log(`Finding React components in ${targetDir}...`);
  const componentFiles = await findReactComponents(targetDir);
  console.log(`Found ${componentFiles.length} potential component files`);
  
  if (componentFiles.length === 0) {
    console.log('No components found to analyze');
    return;
  }
  
  // Just analyze if not injecting
  if (!shouldInject) {
    console.log('\nComponent Analysis:');
    console.log('------------------');
    for (const file of componentFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const componentNames = [...content.matchAll(/(?:export\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/g)]
        .map(match => match[1]);
      
      if (componentNames.length > 0) {
        console.log(`${file}:`);
        componentNames.forEach(name => console.log(`  - ${name}`));
      }
    }
    return;
  }
  
  // Inject the timing code
  console.log('\nInjecting performance measurement code...');
  
  // Create the backup directory if it doesn't exist
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  // Track which files were modified
  const modifiedFiles = [];
  
  for (const file of componentFiles) {
    const modifiedFile = injectTimingCode(file);
    if (modifiedFile) {
      modifiedFiles.push(modifiedFile);
    }
  }
  
  // Save the list of modified files
  fs.writeFileSync(INJECTED_FILES_LOG, JSON.stringify(modifiedFiles, null, 2));
  
  console.log(`\nInstrumented ${modifiedFiles.length} components`);
  console.log('To restore original files, run: node measure-component-timing.js --restore');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});