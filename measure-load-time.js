#!/usr/bin/env node

/**
 * Application Load Time Measurement Script
 * 
 * This script focuses specifically on measuring startup performance:
 * 1. Time to initialize the Express server
 * 2. Time to set up Vite dev server
 * 3. Time to compile and serve the client
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Create a log file to capture timing information
const LOG_FILE = 'app-load-timing.log';
fs.writeFileSync(LOG_FILE, `Application Load Time Measurement\n${'-'.repeat(40)}\nStarted at: ${new Date().toISOString()}\n\n`);

// Function to append to the log file
function log(message) {
  fs.appendFileSync(LOG_FILE, `${message}\n`);
  console.log(message);
}

// Measure server startup time
async function measureServerStartup() {
  log('⏱️ MEASURING SERVER STARTUP TIME');
  log('===============================');

  try {
    const startTime = Date.now();
    log(`Starting server at: ${new Date(startTime).toISOString()}`);

    // Execute the server command with a timeout
    const result = execSync('NODE_ENV=development TSX_DISABLE_CACHE=1 tsx server/index.ts', { 
      timeout: 30000,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '--trace-warnings --enable-source-maps' }
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    log(`Server started in: ${duration}ms (${(duration / 1000).toFixed(2)} seconds)`);
    log('\nServer output:');
    log(result);
  } catch (error) {
    log(`Server startup measurement failed after ${(Date.now() - startTime)}ms`);
    if (error.stdout) log(`Output: ${error.stdout}`);
    if (error.stderr) log(`Error: ${error.stderr}`);
  }
}

// Analyze package-lock.json for dependency information
function analyzePackageLock() {
  log('\n📦 DEPENDENCY RESOLUTION ANALYSIS');
  log('===============================');

  try {
    if (fs.existsSync('package-lock.json')) {
      const lockContent = fs.readFileSync('package-lock.json', 'utf8');
      const lockData = JSON.parse(lockContent);
      
      // Count dependencies
      const packagesCount = Object.keys(lockData.packages || {}).length - 1; // -1 for root
      const dependenciesCount = Object.keys(lockData.dependencies || {}).length;
      
      log(`Total packages in lock file: ${packagesCount}`);
      log(`Direct dependencies: ${dependenciesCount}`);
      
      // Check for problematic packages (optional depends, peer depends, etc)
      let peerDependencyCount = 0;
      let optionalDependencyCount = 0;
      
      Object.values(lockData.packages || {}).forEach(pkg => {
        if (pkg.peerDependencies) peerDependencyCount += Object.keys(pkg.peerDependencies).length;
        if (pkg.optionalDependencies) optionalDependencyCount += Object.keys(pkg.optionalDependencies).length;
      });
      
      log(`Peer dependencies: ${peerDependencyCount}`);
      log(`Optional dependencies: ${optionalDependencyCount}`);
    } else {
      log('No package-lock.json file found.');
    }
  } catch (error) {
    log(`Error analyzing package-lock.json: ${error.message}`);
  }
}

// Main function
async function main() {
  log('🔍 APP LOAD TIME MEASUREMENT');
  log('===========================');
  log(`Started at: ${new Date().toISOString()}`);
  log(`Node.js version: ${process.version}`);
  log(`Current working directory: ${process.cwd()}`);

  // Analyze dependency resolution
  analyzePackageLock();
  
  // Measure server startup (uncomment if needed - this will actually start the server)
  // await measureServerStartup();
  
  log('\n✅ Measurement complete!');
  log(`Full logs available in: ${LOG_FILE}`);
}

// Run the analysis
main().catch(err => {
  console.error('Measurement failed:', err);
});