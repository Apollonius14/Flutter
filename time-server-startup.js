#!/usr/bin/env node

/**
 * This script measures the time it takes for the Express server to initialize
 */

import { execSync } from 'child_process';
import fs from 'fs';

const startTime = Date.now();
console.log(`Starting server at ${new Date(startTime).toISOString()}`);

try {
  // Execute the server with a timeout to ensure it doesn't run indefinitely
  const output = execSync('NODE_ENV=development tsx server/index.ts', { 
    timeout: 5000, // 5 second timeout 
    encoding: 'utf8',
    killSignal: 'SIGTERM'
  });
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  console.log(`Server startup took ${duration}ms (${(duration/1000).toFixed(2)} seconds)`);
  console.log('Server output:');
  console.log(output);
  
  // Write results to a file
  fs.writeFileSync('server-startup-time.log', 
    `Server startup time: ${duration}ms (${(duration/1000).toFixed(2)} seconds)\n` +
    `Started at: ${new Date(startTime).toISOString()}\n` +
    `Finished at: ${new Date(endTime).toISOString()}\n\n` +
    `Server output:\n${output}\n`
  );
} catch (error) {
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  console.log(`Server startup took ${duration}ms (${(duration/1000).toFixed(2)} seconds) before timeout/error`);
  
  if (error.stdout) console.log(`Output: ${error.stdout}`);
  if (error.stderr) console.log(`Error: ${error.stderr}`);
  
  // Write error results to file
  fs.writeFileSync('server-startup-time.log', 
    `Server startup time: ${duration}ms (${(duration/1000).toFixed(2)} seconds) - ERRORED/TIMED OUT\n` +
    `Started at: ${new Date(startTime).toISOString()}\n` +
    `Error at: ${new Date(endTime).toISOString()}\n\n` +
    `Server output:\n${error.stdout || 'No output'}\n` +
    `Server error:\n${error.stderr || 'No error output'}\n`
  );
}